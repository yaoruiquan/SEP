import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { RedisService } from '../../redis/redis.service';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import { GATEWAY_RATE_LIMIT_SCRIPT, GatewayRateLimitService } from './gateway-rate-limit.service';
import { policySnapshot } from './gateway-policy.test-fixtures';

const claims: ClientEmploymentClaims = {
  sub: 'user', enterpriseId: 'enterprise', memberId: 'member', subscriptionId: 'subscription',
  sid: 'auth-session', type: 'client-employment', iat: 1, exp: 2,
};

describe('GatewayRateLimitService', () => {
  const evalMock = jest.fn();
  const create = () => new GatewayRateLimitService(
    { redis: { eval: evalMock } } as unknown as RedisService,
  );

  beforeEach(() => {
    evalMock.mockReset().mockResolvedValue([1, 1, 60_000, 1_060_000, 60_000]);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses defaults and an opaque structured identity key', async () => {
    const result = await create().consume(claims, policySnapshot(), 'req-1');
    expect(result).toMatchObject({ allowed: true, rule: 'gateway-model', limit: 60, windowMs: 60_000, count: 1 });
    const key = `sep:gateway:rate:v1:${result.keyHash}`;
    expect(evalMock).toHaveBeenCalledWith(GATEWAY_RATE_LIMIT_SCRIPT, 2, key, `{${key}}:window`, 60, 60_000);
    expect(result.keyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rounds remaining time up without inventing an extra block window', async () => {
    evalMock.mockResolvedValue([0, 60, 44_001, 1_060_000, 60_000]);
    const result = await create().consume(claims, policySnapshot(), 'req-2');
    expect(result).toMatchObject({ allowed: false, count: 60, retryAfterSeconds: 45, resetAt: 1_060_000 });
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('req-2'));
    expect(Logger.prototype.warn).not.toHaveBeenCalledWith(expect.stringContaining('"enterpriseId"'));
  });

  it.each(['enterpriseId', 'memberId', 'subscriptionId'] as const)('isolates %s but not user or request id', async (field) => {
    const service = create();
    const a = await service.consume(claims, policySnapshot(), 'req-a');
    const b = await service.consume({ ...claims, [field]: 'other' }, policySnapshot(), 'req-b');
    const same = await service.consume({ ...claims, sub: 'other-user' }, policySnapshot(), 'req-c');
    expect(a.keyHash).not.toBe(b.keyHash);
    expect(a.keyHash).toBe(same.keyHash);
  });

  it('uses configurable limits and windows', async () => {
    const service = create();
    await service.consume(claims, policySnapshot({ GATEWAY_MODEL_RATE_LIMIT: 80, GATEWAY_MODEL_RATE_WINDOW_MS: 20_000 }));
    expect(evalMock.mock.calls[0].slice(-2)).toEqual([80, 20_000]);
  });

  it('uses each request snapshot instead of caching configuration at construction', async () => {
    const service = create();
    await service.consume(claims, policySnapshot());
    await service.consume(claims, policySnapshot({ GATEWAY_MODEL_RATE_LIMIT: 12, GATEWAY_MODEL_RATE_WINDOW_MS: 5000 }, 8));
    expect(evalMock.mock.calls[0].slice(-2)).toEqual([60, 60_000]);
    expect(evalMock.mock.calls[1].slice(-2)).toEqual([12, 5000]);
  });

  it('reports the immutable original bucket window and does not invent legacy metadata', async () => {
    evalMock.mockResolvedValueOnce([0, 1, 1000, 1001000, 5000]).mockResolvedValueOnce([0, 1, 1000, 1001000, 0]);
    const service = create();
    const changed = policySnapshot({ GATEWAY_MODEL_RATE_WINDOW_MS: 60000 }, 8);
    expect(await service.consume(claims, changed)).toMatchObject({ windowMs: 5000, policyVersion: 8 });
    expect(await service.consume(claims, changed)).not.toHaveProperty('windowMs');
  });

  it('fails closed with a safe 503 when Redis fails', async () => {
    evalMock.mockRejectedValue(new Error('private connection credentials'));
    const failure = await create().consume(claims, policySnapshot()).catch((error) => error);
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(failure.getResponse()).toMatchObject({ error: { code: 'PLATFORM_RATE_LIMIT_UNAVAILABLE', source: 'platform' } });
    expect(JSON.stringify(failure.getResponse())).not.toContain('private');
  });

  it.each([null, [], [1, 1, -1, 1], [1, 1, 1, NaN], ['1', 1, 1, 1], [2, 1, 1, 1]].map((result) => ({ result })))('fails closed on malformed Redis response $result', async ({ result }) => {
    evalMock.mockResolvedValue(result);
    await expect(create().consume(claims, policySnapshot())).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
