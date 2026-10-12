import { InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../../redis/redis.service';
import { GATEWAY_AUTH_RATE_LIMIT_SCRIPT, GatewayAuthRateLimitService } from './gateway-auth-rate-limit.service';

describe('GatewayAuthRateLimitService', () => {
  let evalMock: jest.Mock;
  const create = (settings: Record<string, unknown> = {}) => new GatewayAuthRateLimitService(
    { redis: { eval: evalMock } } as unknown as RedisService,
    { get: (name: string) => settings[name] } as ConfigService,
  );

  beforeEach(() => { evalMock = jest.fn().mockResolvedValue([1, 1, 120, 1, 60_000, 1_060_000]); });

  it('uses separate hashed token/socket and socket buckets with wide defaults', async () => {
    const result = await create().consumeFailure('token-fingerprint', 'socket-source');
    expect(result).toEqual({
      allowed: true, rule: 'gateway-auth', dimension: 'token/socket',
      limit: 120, count: 1, windowMs: 60_000, retryAfterSeconds: 60, resetAt: 1_060_000,
    });
    expect(evalMock).toHaveBeenCalledWith(
      GATEWAY_AUTH_RATE_LIMIT_SCRIPT, 2,
      expect.stringMatching(/^sep:gateway:auth:v1:\{gateway-auth\}:token:[a-f0-9]{64}$/),
      expect.stringMatching(/^sep:gateway:auth:v1:\{gateway-auth\}:source:[a-f0-9]{64}$/),
      120, 1200, 60_000,
    );
    expect(JSON.stringify(evalMock.mock.calls)).not.toContain('token-fingerprint');
    expect(JSON.stringify(evalMock.mock.calls)).not.toContain('socket-source');
  });

  it('isolates token/source pairs and shares only the independent failure source bucket', async () => {
    const service = create();
    await service.consumeFailure('token-1', 'source-1');
    await service.consumeFailure('token-2', 'source-1');
    await service.consumeFailure('token-1', 'source-2');
    const calls = evalMock.mock.calls;
    expect(calls[0][2]).not.toBe(calls[1][2]);
    expect(calls[0][3]).toBe(calls[1][3]);
    expect(calls[0][2]).not.toBe(calls[2][2]);
    expect(calls[0][3]).not.toBe(calls[2][3]);
  });

  it('reports a decreasing source cooldown and supports configured thresholds', async () => {
    evalMock.mockResolvedValue([0, 2, 10, 10, 57_001, 1_060_000]);
    expect(await create({
      GATEWAY_AUTH_FAILURE_TOKEN_LIMIT: '3', GATEWAY_AUTH_FAILURE_SOURCE_LIMIT: 10,
      GATEWAY_AUTH_FAILURE_WINDOW_MS: '60000',
    }).consumeFailure('fingerprint', 'source')).toMatchObject({
      allowed: false, dimension: 'socket', limit: 10, count: 10,
      retryAfterSeconds: 58, resetAt: 1_060_000,
    });
    expect(evalMock.mock.calls[0].slice(4)).toEqual([3, 10, 60_000]);
  });

  it.each([null, [], [1, 1, 120, 1, -1, 1000], [2, 1, 120, 1, 60, 1000],
    [1, 3, 120, 1, 60, 1000], [1, 1, 120, 1.5, 60, 1000]].map((result) => ({ result })))(
    'fails closed on malformed Redis result $result', async ({ result }) => {
      evalMock.mockResolvedValue(result);
      await expect(create().consumeFailure('fingerprint', 'source')).rejects.toBeInstanceOf(ServiceUnavailableException);
    },
  );

  it('sanitizes Redis errors and never fails open', async () => {
    evalMock.mockRejectedValue(new Error('private Redis error'));
    const error = await create().consumeFailure('fingerprint', 'source').catch((cause) => cause);
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toMatchObject({ error: { code: 'GATEWAY_AUTH_RATE_LIMIT_UNAVAILABLE' } });
    expect(JSON.stringify(error.getResponse())).not.toContain('private Redis error');
  });

  it.each([0, -1, '1.5', 'invalid', 2_147_483_648])('rejects invalid limits: %s', (limit) => {
    expect(() => create({ GATEWAY_AUTH_FAILURE_TOKEN_LIMIT: limit })).toThrow(InternalServerErrorException);
  });
});

// Opt-in isolated Redis only; keys expire and belong exclusively to this test.
const integration = process.env.GATEWAY_AUTH_REDIS_TEST_URL ? describe : describe.skip;
integration('Gateway authentication Lua on real Redis', () => {
  let redis: Redis;
  const keys: string[] = [];
  const pair = () => {
    const prefix = `sep:test:gateway-auth:{${randomUUID()}}`;
    const result = [`${prefix}:token`, `${prefix}:source`];
    keys.push(...result);
    return result;
  };
  const consume = (client: Redis, names: string[], tokenLimit = 3, sourceLimit = 10, window = 10_000) =>
    client.eval(GATEWAY_AUTH_RATE_LIMIT_SCRIPT, 2, ...names, tokenLimit, sourceLimit, window) as Promise<number[]>;

  beforeAll(() => { redis = new Redis(process.env.GATEWAY_AUTH_REDIS_TEST_URL!, { maxRetriesPerRequest: 1 }); });
  afterAll(async () => {
    try { if (keys.length) await redis.del(...keys); } finally { await redis.quit(); }
  });

  it('atomically admits exactly the token limit from two clients', async () => {
    const names = pair();
    const other = redis.duplicate();
    try {
      const results = await Promise.all(Array.from({ length: 30 }, (_, i) => consume(i % 2 ? other : redis, names)));
      expect(results.filter(([allowed]) => allowed === 1)).toHaveLength(3);
      expect(await redis.mget(...names)).toEqual(['3', '3']);
    } finally { await other.quit(); }
  });

  it('limits random tokens by source without creating new keys once blocked', async () => {
    const names = pair();
    const tokens = Array.from({ length: 5 }, (_, i) => `${names[0]}:${i}`);
    keys.push(...tokens);
    const results = await Promise.all(tokens.map((token) => consume(redis, [token, names[1]], 3, 2)));
    expect(results.filter(([allowed]) => allowed === 1)).toHaveLength(2);
    expect(results.filter(([allowed]) => !allowed).every(([, dimension]) => dimension === 2)).toBe(true);
    expect((await redis.mget(...tokens)).filter((value) => value === null)).toHaveLength(3);
  });

  it('does not prolong rejected windows and recovers after expiry', async () => {
    const names = pair();
    const first = await consume(redis, names, 1, 10, 250);
    const retry = await consume(redis, names, 1, 10, 250);
    expect(retry[0]).toBe(0);
    expect(retry[3]).toBe(1);
    expect(retry[5]).toBe(first[5]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await consume(redis, names, 1, 10, 250)).slice(0, 5)).toEqual([1, 1, 1, 1, 250]);
  });
});
