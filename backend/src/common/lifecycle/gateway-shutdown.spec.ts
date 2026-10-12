import { EventEmitter } from 'node:events';
import { installGatewayShutdown } from './gateway-shutdown';
import { GatewayLifecycleService } from './gateway-lifecycle.service';

describe('Gateway shutdown coordinator', () => {
  let signals: EventEmitter;
  let close: jest.Mock;
  let lifecycle: { beginShutdown: jest.Mock; waitForIdle: jest.Mock };
  let logger: { error: jest.Mock; log: jest.Mock };
  beforeEach(() => {
    signals = new EventEmitter();
    close = jest.fn().mockResolvedValue(undefined);
    lifecycle = { beginShutdown: jest.fn(), waitForIdle: jest.fn() };
    logger = { error: jest.fn(), log: jest.fn() };
  });
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

  it('waits before Nest closes dependencies and coalesces repeated signals', async () => {
    let finish: (idle: boolean) => void;
    lifecycle.waitForIdle.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    installGatewayShutdown({ close }, lifecycle as unknown as GatewayLifecycleService, signals as never, logger);
    signals.emit('SIGTERM');
    signals.emit('SIGINT');
    expect(lifecycle.beginShutdown).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    finish(true);
    await flush();
    expect(close).toHaveBeenCalledTimes(1);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
    expect(signals.listenerCount('SIGINT')).toBe(0);
  });

  it('retains the process on timeout and supports a later signal retry', async () => {
    lifecycle.waitForIdle.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const cleanup = installGatewayShutdown({ close }, lifecycle as unknown as GatewayLifecycleService, signals as never, logger);
    signals.emit('SIGTERM');
    await flush();
    expect(close).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('no forced termination'));
    expect(signals.listenerCount('SIGTERM')).toBe(1);
    signals.emit('SIGTERM');
    await flush();
    expect(close).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('retains listeners and reports an app.close failure without forcing exit', async () => {
    lifecycle.waitForIdle.mockResolvedValue(true);
    close.mockRejectedValue(new Error('synthetic close failure'));
    const cleanup = installGatewayShutdown({ close }, lifecycle as unknown as GatewayLifecycleService, signals as never, logger);
    signals.emit('SIGTERM');
    await flush();
    expect(logger.error).toHaveBeenCalledWith('Application shutdown failed; no forced termination');
    expect(signals.listenerCount('SIGTERM')).toBe(1);
    cleanup();
  });
});
