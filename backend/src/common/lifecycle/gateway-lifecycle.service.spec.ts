import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import * as fs from 'node:fs';
import { GatewayLifecycleService } from './gateway-lifecycle.service';

jest.mock('node:fs', () => ({
  readFileSync: jest.fn(), mkdirSync: jest.fn(), lstatSync: jest.fn(), chmodSync: jest.fn(),
}));

describe('GatewayLifecycleService', () => {
  const read = fs.readFileSync as jest.Mock;
  let service: GatewayLifecycleService;
  beforeEach(() => {
    jest.clearAllMocks();
    read.mockImplementation(() => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); });
    service = new GatewayLifecycleService(new ConfigService());
  });
  afterEach(() => jest.useRealTimers());

  it('counts the entire lease and releases it only once', () => {
    const releaseA = service.beginRequest();
    const releaseB = service.beginRequest();
    expect(service.snapshot().activeGatewayRequests).toBe(2);
    releaseA();
    releaseA();
    expect(service.snapshot().activeGatewayRequests).toBe(1);
    releaseB();
    expect(service.snapshot().activeGatewayRequests).toBe(0);
  });

  it('rejects new requests synchronously but retains admitted work during drain', async () => {
    const release = service.beginRequest();
    read.mockReturnValue(JSON.stringify({ bootId: service.bootId, token: 'release-1' }));
    expect(service.snapshot()).toMatchObject({ draining: true, gatewayState: 'draining', activeGatewayRequests: 1 });
    try {
      service.beginRequest();
      throw new Error('expected drain rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
        error: { code: 'SERVER_DRAINING', source: 'platform' },
      });
    }
    const idle = service.waitForIdle(1000);
    release();
    await expect(idle).resolves.toBe(true);
    expect(service.snapshot()).toMatchObject({ draining: true, activeGatewayRequests: 0 });
  });

  it('allows deleting the marker to resume, but cannot resume stopping', () => {
    read.mockReturnValue(JSON.stringify({ bootId: service.bootId, token: 'release-1' }));
    expect(() => service.beginRequest()).toThrow();
    read.mockImplementation(() => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); });
    service.beginRequest()();
    service.beginShutdown();
    expect(service.snapshot()).toMatchObject({ gatewayState: 'stopping', draining: true });
    expect(() => service.beginRequest()).toThrow();
  });

  it('ignores a valid marker from a previous process boot', () => {
    read.mockReturnValue(JSON.stringify({ bootId: 'previous-boot', token: 'release-1' }));
    expect(service.snapshot().draining).toBe(false);
    service.beginRequest()();
  });

  it.each(['broken json', '{}', 'null'])('fails closed for malformed marker %s', (value) => {
    read.mockReturnValue(value);
    expect(service.snapshot()).toMatchObject({ gatewayState: 'control_error', draining: true });
    expect(() => service.beginRequest()).toThrow();
  });

  it('fails closed on a marker read error', () => {
    read.mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); });
    expect(service.snapshot().gatewayState).toBe('control_error');
  });

  it('does not fake a zero count or terminate work at the wait deadline', async () => {
    jest.useFakeTimers();
    const release = service.beginRequest();
    service.beginShutdown();
    const idle = service.waitForIdle(50);
    jest.advanceTimersByTime(50);
    await expect(idle).resolves.toBe(false);
    expect(service.snapshot().activeGatewayRequests).toBe(1);
    release();
    await expect(service.waitForIdle()).resolves.toBe(true);
  });

  it('validates a configurable maximum request budget plus grace', () => {
    const configured = new GatewayLifecycleService(new ConfigService({
      GATEWAY_STREAM_TOTAL_TIMEOUT_MS: '900000', GATEWAY_NON_STREAM_TIMEOUT_MS: '1200000',
      SEP_GATEWAY_DRAIN_GRACE_MS: '45000', SEP_GATEWAY_DRAIN_TIMEOUT_MS: '',
    }));
    expect(configured.snapshot()).toMatchObject({ requestBudgetMs: 1200000, drainTimeoutMs: 1245000 });
    expect(() => new GatewayLifecycleService(new ConfigService({
      GATEWAY_STREAM_TOTAL_TIMEOUT_MS: '900000', SEP_GATEWAY_DRAIN_TIMEOUT_MS: '600000',
    }))).toThrow('must cover request budget plus grace');
  });

  it('covers editable timeout increases even when process environment starts with a shorter budget', () => {
    const configured = new GatewayLifecycleService(new ConfigService({
      GATEWAY_STREAM_TOTAL_TIMEOUT_MS: '120000', GATEWAY_NON_STREAM_TIMEOUT_MS: '60000',
    }));
    expect(configured.snapshot()).toMatchObject({ requestBudgetMs: 600000, drainTimeoutMs: 630000 });
    expect(() => new GatewayLifecycleService(new ConfigService({
      GATEWAY_STREAM_TOTAL_TIMEOUT_MS: '120000', SEP_GATEWAY_DRAIN_TIMEOUT_MS: '150000',
    }))).toThrow('must cover request budget plus grace');
  });

  it.each(['0', '-1', '1.5', 'NaN', '2147483648'])('rejects invalid budget %s', (value) => {
    expect(() => new GatewayLifecycleService(new ConfigService({ GATEWAY_STREAM_TOTAL_TIMEOUT_MS: value }))).toThrow();
  });

  it('creates a private directory and rejects symlink directories', () => {
    (fs.lstatSync as jest.Mock).mockReturnValue({ isDirectory: () => true, isSymbolicLink: () => false });
    service.onModuleInit();
    expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/sep-runtime', { recursive: true, mode: 0o700 });
    expect(fs.chmodSync).toHaveBeenCalledWith('/tmp/sep-runtime', 0o700);
    (fs.lstatSync as jest.Mock).mockReturnValue({ isDirectory: () => true, isSymbolicLink: () => true });
    expect(() => service.onModuleInit()).toThrow('unsafe');
  });
});
