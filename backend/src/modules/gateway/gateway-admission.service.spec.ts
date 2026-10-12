import { ConfigService } from '@nestjs/config';
import { ArgumentsHost, HttpException, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { RedisService } from '../../redis/redis.service';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import {
  GATEWAY_ADMISSION_RELEASE_SCRIPT, GATEWAY_ADMISSION_SCRIPT, GatewayAdmissionRequest, GatewayAdmissionService,
} from './gateway-admission.service';

const claims: ClientEmploymentClaims = {
  sub: 'private-user', enterpriseId: 'private-enterprise', memberId: 'private-member', subscriptionId: 'private-subscription',
  type: 'client-employment', sid: 'private-session', iat: 1, exp: 2,
};
const dto: GatewayAdmissionRequest = {
  model: 'model', messages: [{ role: 'user', content: 'private-prompt' }], max_tokens: 100, requestId: 'request-1',
};

describe('GatewayAdmissionService', () => {
  const evalMock = jest.fn();
  const create = (values: Record<string, unknown> = {}) => new GatewayAdmissionService(
    { redis: { eval: evalMock } } as unknown as RedisService, new ConfigService(values),
  );
  beforeEach(() => {
    evalMock.mockReset().mockResolvedValue([1, 0, 0, 720_000, 1_720_000]);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses default budgets, server execution ID and hashed cluster-safe keys', async () => {
    await create().acquire(claims, 'server-execution', dto);
    const [script, keyCount, ...args] = evalMock.mock.calls[0];
    expect(script).toBe(GATEWAY_ADMISSION_SCRIPT);
    expect(keyCount).toBe(5);
    const keys = args.slice(0, 5) as string[];
    expect(keys.every((key) => key.startsWith('sep:gateway:admission:v1:'))).toBe(true);
    expect(new Set(keys.map((key) => key.match(/\{([a-f0-9]{64})\}/)?.[1])).size).toBe(1);
    expect(keys[1]).toMatch(/:member:[a-f0-9]{64}$/);
    expect(JSON.stringify(keys)).not.toContain('private');
    expect(args.slice(5)).toEqual(['server-execution', 720_000, 60_000, 4, 32, 120, 600, 0, 0]);
  });

  it('aggregates across subscriptions, models and users while isolating enterprises/members', async () => {
    const service = create();
    await service.acquire(claims, 'a', dto);
    await service.acquire({ ...claims, sub: 'other', subscriptionId: 'other' }, 'b', { ...dto, model: 'other' });
    await service.acquire({ ...claims, memberId: 'other-member' }, 'c', dto);
    await service.acquire({ ...claims, enterpriseId: 'other-enterprise' }, 'd', dto);
    const keys = evalMock.mock.calls.map((call) => call.slice(2, 7));
    expect(keys[0]).toEqual(keys[1]);
    expect(keys[0][0]).toBe(keys[2][0]);
    expect(keys[0][1]).not.toBe(keys[2][1]);
    expect(keys[0][2]).not.toBe(keys[2][2]);
    expect(keys[0][3]).toBe(keys[2][3]);
    expect(keys[0].every((key, i) => key !== keys[3][i])).toBe(true);
  });

  it.each([
    [{ GATEWAY_STREAM_TOTAL_TIMEOUT_MS: 900_000 }, 1_020_000],
    [{ GATEWAY_NON_STREAM_TIMEOUT_MS: 1_200_000 }, 1_320_000],
    [{ GATEWAY_STREAM_TOTAL_TIMEOUT_MS: 10, GATEWAY_NON_STREAM_TIMEOUT_MS: 20 }, 120_020],
  ])('covers the larger configured request budget with cleanup margin %p', async (config, leaseMs) => {
    evalMock.mockResolvedValue([1, 0, 0, leaseMs, 10_000_000]);
    await create(config).acquire(claims, 'exec', dto);
    expect(evalMock.mock.calls[0][8]).toBe(leaseMs);
  });

  it('uses configured limits and reserves UTF-8 serialized bytes including tools plus max_tokens', async () => {
    const input: GatewayAdmissionRequest = {
      ...dto, messages: [{ role: 'user', content: '\u4e2d\u6587' }],
      tools: [{ type: 'function', function: { name: 'tool', parameters: { type: 'object' } } }],
    };
    await create({
      GATEWAY_MEMBER_CONCURRENCY: '7', GATEWAY_ENTERPRISE_CONCURRENCY: 50,
      GATEWAY_MEMBER_RPM: '140', GATEWAY_ENTERPRISE_RPM: 800, GATEWAY_ENTERPRISE_TOKEN_BUDGET: '100000',
    }).acquire(claims, 'exec', input);
    const { requestId: _requestId, ...serialized } = input;
    expect(evalMock.mock.calls[0].slice(10)).toEqual([
      7, 50, 140, 800, 100000, Buffer.byteLength(JSON.stringify(serialized), 'utf8') + 100,
    ]);
  });

  it('uses the configured conservative output reservation when max_tokens was not injected', async () => {
    const { max_tokens: _maxTokens, requestId: _requestId, ...input } = dto;
    await create({ GATEWAY_ENTERPRISE_TOKEN_BUDGET: 10000, GATEWAY_DEFAULT_MAX_TOKENS: 512 }).acquire(claims, 'exec', input);
    expect(evalMock.mock.calls[0].at(-1)).toBe(Buffer.byteLength(JSON.stringify(input)) + 512);
  });

  it.each([
    [1, 'PLATFORM_CONCURRENCY_LIMIT_EXCEEDED', 'gateway-member-concurrency', 'enterprise/member', 4, 720000],
    [2, 'PLATFORM_CONCURRENCY_LIMIT_EXCEEDED', 'gateway-enterprise-concurrency', 'enterprise', 32, 720000],
    [3, 'PLATFORM_RATE_LIMIT_EXCEEDED', 'gateway-member-rpm', 'enterprise/member', 120, 60000],
    [4, 'PLATFORM_RATE_LIMIT_EXCEEDED', 'gateway-enterprise-rpm', 'enterprise', 600, 60000],
    [5, 'PLATFORM_TOKEN_BUDGET_EXCEEDED', 'gateway-enterprise-token-budget', 'enterprise', 10000, 60000],
  ])('returns filter-compatible 429 for rule %i', async (ruleId, code, rule, dimension, limit, windowMs) => {
    evalMock.mockResolvedValue([0, ruleId, 4, 44_001, 1_044_001]);
    const failure = await create({ GATEWAY_ENTERPRISE_TOKEN_BUDGET: 10000 }).acquire(claims, 'exec', dto).catch((error) => error);
    expect(failure).toBeInstanceOf(HttpException);
    expect(failure.getStatus()).toBe(429);
    const metadata = { rule, dimension, limit, count: 4, windowMs, resetAt: 1_044_001, retryAfterSeconds: 45 };
    expect(failure.getResponse()).toMatchObject({ error: { code, source: 'platform', rateLimit: metadata }, retryAfterSeconds: 45 });
    const response = {
      getHeader: jest.fn(), getHeaders: jest.fn().mockReturnValue({}), setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(), json: jest.fn(),
    };
    const host = { switchToHttp: () => ({
      getResponse: () => response, getRequest: () => ({ originalUrl: '/api/gateway/v1/chat/completions', requestId: 'request-1' }),
    }) } as ArgumentsHost;
    new HttpExceptionFilter().catch(failure, host);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '45');
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code, source: 'platform', rateLimit: metadata }) }));
    expect(evalMock).toHaveBeenCalledTimes(1);
  });

  const positiveConfigs = [
    'GATEWAY_MEMBER_CONCURRENCY', 'GATEWAY_ENTERPRISE_CONCURRENCY', 'GATEWAY_MEMBER_RPM', 'GATEWAY_ENTERPRISE_RPM',
    'GATEWAY_DEFAULT_MAX_TOKENS', 'GATEWAY_STREAM_TOTAL_TIMEOUT_MS', 'GATEWAY_NON_STREAM_TIMEOUT_MS',
  ];
  it.each(['', 'invalid', '1.5', '1e3', ' 4 ', true, {}, 0, -1, Infinity, 2_147_483_648])('rejects invalid positive configuration %p', (value) => {
    for (const name of positiveConfigs) {
      expect(() => create({ [name]: value })).toThrow(InternalServerErrorException);
      expect(() => create({ [name]: value })).toThrow(name);
    }
  });
  it.each(['', 'invalid', '1.5', true, -1, Infinity, 2_147_483_648])('rejects invalid optional token configuration %p', (value) => {
    expect(() => create({ GATEWAY_ENTERPRISE_TOKEN_BUDGET: value })).toThrow('GATEWAY_ENTERPRISE_TOKEN_BUDGET');
  });
  it('allows explicit zero token budget', () => {
    expect(() => create({ GATEWAY_ENTERPRISE_TOKEN_BUDGET: '0' })).not.toThrow();
  });

  it('fails closed on Redis errors without logging secrets, prompt or raw identities', async () => {
    evalMock.mockRejectedValue(new Error('private Redis credentials and URL'));
    const failure = await create().acquire(claims, 'exec-1', dto).catch((error) => error);
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(failure.getResponse()).toMatchObject({ error: { code: 'PLATFORM_ADMISSION_UNAVAILABLE', source: 'platform' } });
    const log = JSON.parse((Logger.prototype.error as jest.Mock).mock.calls[0][0]);
    expect(log).toMatchObject({ event: 'gateway_admission_unavailable', executionId: 'exec-1', requestId: 'request-1' });
    expect(JSON.stringify(log)).not.toContain('private');
    expect(JSON.stringify(failure.getResponse())).not.toContain('private');
  });

  it.each([
    null, [], [1, 0, 0, 720000], ['1', 0, 0, 720000, 1720000], [2, 0, 0, 720000, 1720000],
    [1, 0, 0, -1, 1720000], [1, 0, 0, 1, 1720000], [1, 1, 0, 720000, 1720000],
    [0, 0, 1, 1000, 1000000], [0, 6, 1, 1000, 1000000], [0, 1, -1, 1000, 1000000],
    [0, 1, 1, 1000, NaN], [0, 1, 1, 1000, 1], [0, 5, 0, 1000, 1000000], [-1, 0, 0, 0, 0],
  ].map((result) => ({ result })))('fails closed on malformed responses or duplicate execution IDs $result', async ({ result }) => {
    evalMock.mockResolvedValue(result);
    await expect(create().acquire(claims, 'exec', dto)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it.each(['', '   ', undefined])('rejects invalid server execution ID %p before Redis', async (executionId) => {
    await expect(create().acquire(claims, executionId as string, dto)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(evalMock).not.toHaveBeenCalled();
  });

  it('releases only the owned execution and deadline once, even for concurrent callers', async () => {
    const lease = await create().acquire(claims, 'server-exec', dto);
    const keys = evalMock.mock.calls[0].slice(2, 4);
    evalMock.mockResolvedValue(2);
    await Promise.all([lease.release(), lease.release(), lease.release()]);
    await lease.release();
    expect(evalMock).toHaveBeenCalledTimes(2);
    expect(evalMock).toHaveBeenLastCalledWith(GATEWAY_ADMISSION_RELEASE_SCRIPT, 2, ...keys, 'server-exec', 1_720_000);
  });

  it('logs failed release without secrets or masking the upstream result', async () => {
    const lease = await create().acquire(claims, 'exec', dto);
    evalMock.mockRejectedValue(new Error('private Redis credentials'));
    await expect(lease.release()).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('gateway_admission_release_failed'));
    const log = (Logger.prototype.error as jest.Mock).mock.calls[0][0];
    expect(log).toContain('"executionId":"exec"');
    expect(log).toContain('"requestId":"request-1"');
    expect(log).not.toContain('private');
  });
});
