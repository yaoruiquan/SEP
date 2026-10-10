import { ConfigService } from '@nestjs/config';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { RedisService } from '../../redis/redis.service';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import { GATEWAY_RATE_LIMIT_SCRIPT, GatewayRateLimitService } from './gateway-rate-limit.service';

const claims: ClientEmploymentClaims = {
  sub: 'user', enterpriseId: 'enterprise', memberId: 'member', subscriptionId: 'subscription',
  type: 'client-employment', iat: 1, exp: 2,
};

describe('GatewayRateLimitService', () => {
  const evalMock = jest.fn();
  const config = (values: Record<string, unknown> = {}) => ({ get: (name: string) => values[name] }) as ConfigService;
  const create = (values?: Record<string, unknown>) => new GatewayRateLimitService(
    { redis: { eval: evalMock } } as unknown as RedisService, config(values),
  );

  beforeEach(() => {
    evalMock.mockReset().mockResolvedValue([1, 1, 60_000, 1_060_000]);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses defaults and an opaque structured identity key', async () => {
    const result = await create().consume(claims, 'req-1');
    expect(result).toMatchObject({ allowed: true, rule: 'gateway-model', limit: 60, windowMs: 60_000, count: 1 });
    expect(evalMock).toHaveBeenCalledWith(GATEWAY_RATE_LIMIT_SCRIPT, 1, `sep:gateway:rate:v1:${result.keyHash}`, 60, 60_000);
    expect(result.keyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rounds remaining time up without inventing an extra block window', async () => {
    evalMock.mockResolvedValue([0, 60, 44_001, 1_060_000]);
    const result = await create().consume(claims, 'req-2');
    expect(result).toMatchObject({ allowed: false, count: 60, retryAfterSeconds: 45, resetAt: 1_060_000 });
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('req-2'));
    expect(Logger.prototype.warn).not.toHaveBeenCalledWith(expect.stringContaining('"enterpriseId"'));
  });

  it.each(['enterpriseId', 'memberId', 'subscriptionId'] as const)('isolates %s but not user or request id', async (field) => {
    const service = create();
    const a = await service.consume(claims, 'req-a');
    const b = await service.consume({ ...claims, [field]: 'other' }, 'req-b');
    const same = await service.consume({ ...claims, sub: 'other-user' }, 'req-c');
    expect(a.keyHash).not.toBe(b.keyHash);
    expect(a.keyHash).toBe(same.keyHash);
  });

  it('uses configurable limits and windows', async () => {
    const service = create({ GATEWAY_MODEL_RATE_LIMIT: '80', GATEWAY_MODEL_RATE_WINDOW_MS: 20_000 });
    await service.consume(claims);
    expect(evalMock.mock.calls[0].slice(-2)).toEqual([80, 20_000]);
  });

  it.each(['', 'bad', '1.5', '1e3', 0, -1, Infinity, 2_147_483_648])('rejects invalid configuration %p at construction', (value) => {
    expect(() => create({ GATEWAY_MODEL_RATE_LIMIT: value })).toThrow('GATEWAY_MODEL_RATE_LIMIT');
    expect(() => create({ GATEWAY_MODEL_RATE_WINDOW_MS: value })).toThrow('GATEWAY_MODEL_RATE_WINDOW_MS');
  });

  it('fails closed with a safe 503 when Redis fails', async () => {
    evalMock.mockRejectedValue(new Error('private connection credentials'));
    const failure = await create().consume(claims).catch((error) => error);
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(failure.getResponse()).toMatchObject({ error: { code: 'PLATFORM_RATE_LIMIT_UNAVAILABLE', source: 'platform' } });
    expect(JSON.stringify(failure.getResponse())).not.toContain('private');
  });

  it.each([null, [], [1, 1, -1, 1], [1, 1, 1, NaN], ['1', 1, 1, 1], [2, 1, 1, 1]].map((result) => ({ result })))('fails closed on malformed Redis response $result', async ({ result }) => {
    evalMock.mockResolvedValue(result);
    await expect(create().consume(claims)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
