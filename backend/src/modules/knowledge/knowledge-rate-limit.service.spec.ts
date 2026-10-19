import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../../redis/redis.service';
import { KNOWLEDGE_RATE_LIMIT_SCRIPT, KnowledgeRateLimitService } from './knowledge-rate-limit.service';

describe('KnowledgeRateLimitService', () => {
  let evalScript: jest.Mock;
  let client: { status: string; eval: jest.Mock };
  const identity = { enterpriseId: 'private-enterprise', memberId: 'private-member' };
  const makeService = (values: Record<string, unknown> = {}) => new KnowledgeRateLimitService(
    { get redis() { return client; } } as unknown as RedisService,
    { get: (key: string) => values[key] } as ConfigService,
  );

  beforeEach(() => {
    evalScript = jest.fn().mockResolvedValue([1, 1, 1, 60_000, 60_000]);
    client = { status: 'ready', eval: evalScript };
  });

  afterEach(() => { jest.useRealTimers(); });

  it('starts a lazy shared Redis connection without queuing quota commands', () => {
    client.status = 'wait';
    const connect = jest.fn().mockResolvedValue(undefined);
    Object.assign(client, { connect });
    makeService().onModuleInit();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(evalScript).not.toHaveBeenCalled();
  });

  it.each([['search', 60, 600], ['source', 120, 1200]] as const)(
    'uses defaults for %s and consumes both dimensions atomically', async (operation, member, enterprise) => {
      const service = makeService();
      const result = await service.consume(identity, operation);
      expect(evalScript).toHaveBeenCalledWith(
        KNOWLEDGE_RATE_LIMIT_SCRIPT, 2, expect.any(String), expect.any(String), member, enterprise, 60_000,
      );
      expect(result).toMatchObject({ allowed: true, operation, retryAfterSeconds: 0, exceeded: [] });
      expect(result.member).toEqual({ limit: member, count: 1, remaining: member - 1 });
      expect(result.enterprise).toEqual({ limit: enterprise, count: 1, remaining: enterprise - 1 });
    },
  );

  it('hashes identities, uses one enterprise hash slot, and isolates operations and members', async () => {
    const service = makeService();
    await service.consume(identity, 'search');
    await service.consume({ ...identity, memberId: 'another-member' }, 'search');
    await service.consume(identity, 'source');
    await service.consume({ ...identity, enterpriseId: 'another-enterprise' }, 'search');
    const keys = evalScript.mock.calls.map(call => call.slice(2, 4) as string[]);
    for (const pair of keys) {
      expect(pair[0].match(/\{[^}]+\}/)?.[0]).toBe(pair[1].match(/\{[^}]+\}/)?.[0]);
      for (const key of pair) {
        expect(key).toMatch(/^sep:knowledge:rate:v1:\{[a-f0-9]{64}\}:(search|source):(member:[a-f0-9]{64}|enterprise)$/);
        expect(key).not.toContain(identity.enterpriseId);
        expect(key).not.toContain(identity.memberId);
      }
    }
    expect(keys[0][1]).toBe(keys[1][1]);
    expect(keys[0][0]).not.toBe(keys[1][0]);
    expect(keys[0][1]).not.toBe(keys[2][1]);
    expect(keys[0][1]).not.toBe(keys[3][1]);
  });

  it('accepts numeric/string configuration for both operations and window', async () => {
    const service = makeService({
      KNOWLEDGE_SEARCH_MEMBER_RATE_LIMIT: '3', KNOWLEDGE_SEARCH_ENTERPRISE_RATE_LIMIT: 30,
      KNOWLEDGE_SOURCE_MEMBER_RATE_LIMIT: '6', KNOWLEDGE_SOURCE_ENTERPRISE_RATE_LIMIT: 60,
      KNOWLEDGE_RATE_LIMIT_WINDOW_MS: '2000', KNOWLEDGE_RATE_LIMIT_TIMEOUT_MS: '50',
    });
    evalScript.mockResolvedValue([1, 1, 1, 2000, 2000]);
    await service.consume(identity, 'search');
    await service.consume(identity, 'source');
    expect(evalScript.mock.calls[0].slice(4)).toEqual([3, 30, 2000]);
    expect(evalScript.mock.calls[1].slice(4)).toEqual([6, 60, 2000]);
  });

  it.each([
    ['KNOWLEDGE_SEARCH_MEMBER_RATE_LIMIT', 0], ['KNOWLEDGE_SEARCH_ENTERPRISE_RATE_LIMIT', '-1'],
    ['KNOWLEDGE_SOURCE_MEMBER_RATE_LIMIT', '1.5'], ['KNOWLEDGE_SOURCE_ENTERPRISE_RATE_LIMIT', 'garbage'],
    ['KNOWLEDGE_RATE_LIMIT_WINDOW_MS', 2_147_483_648], ['KNOWLEDGE_RATE_LIMIT_TIMEOUT_MS', 30_001],
    ['KNOWLEDGE_RATE_LIMIT_TIMEOUT_MS', false], ['KNOWLEDGE_RATE_LIMIT_TIMEOUT_MS', ''],
  ])('rejects invalid configuration %s without silently disabling protection', (key, value) => {
    expect(() => makeService({ [key]: value })).toThrow(InternalServerErrorException);
  });

  it.each([
    [[0, 60, 30, 1, 3000], ['member'], 1],
    [[0, 20, 600, 2000, 2001], ['enterprise'], 3],
    [[0, 60, 600, 1001, 5001], ['member', 'enterprise'], 6],
    [[0, 0, 600, 0, 900], ['enterprise'], 1],
  ])('reports blocked dimensions and rounds up the longest blocked TTL', async (reply, exceeded, retry) => {
    evalScript.mockResolvedValue(reply);
    await expect(makeService().consume(identity, 'search')).resolves.toMatchObject({
      allowed: false, exceeded, retryAfterSeconds: retry,
    });
  });

  it.each([
    null, [], [2, 1, 1, 1000, 1000], [1, 1, 1, -1, 1000], [1, 0, 1, 1000, 1000],
    [1, 61, 1, 1000, 1000], [0, 59, 599, 1000, 1000], [0, 60, 600, 0, 1000],
    [1, '1', 1, 1000, 1000], [1, 1, 1, NaN, 1000], [1, 1, 1, 0.5, 1000],
    [0, 0, 600, 1000, 1000],
  ].map(reply => ({ reply })))('fails closed on malformed Redis replies: %j', async ({ reply }) => {
    evalScript.mockResolvedValue(reply);
    await expect(makeService().consume(identity, 'search')).rejects.toMatchObject({
      response: { code: 'KNOWLEDGE_RATE_LIMIT_UNAVAILABLE' }, status: 503,
    });
  });

  it('does not expose Redis errors and records failures separately from denial', async () => {
    evalScript.mockRejectedValue(new Error('redis://private:secret@host query token'));
    const service = makeService();
    const error = await service.consume(identity, 'search').catch(error => error);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(JSON.stringify(error.getResponse())).not.toMatch(/private|secret|query|token/);
    expect(service.getStats().search).toEqual({ allowed: 0, limited: 0, unavailable: 1 });
  });

  it.each(['wait', 'connecting', 'reconnecting', 'end'])('does not enqueue commands while Redis is %s', async status => {
    client.status = status;
    await expect(makeService().consume(identity, 'search')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(evalScript).not.toHaveBeenCalled();
  });

  it('times out a hanging Redis command and safely handles a late rejection', async () => {
    jest.useFakeTimers();
    let reject!: (reason: Error) => void;
    evalScript.mockReturnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const service = makeService({ KNOWLEDGE_RATE_LIMIT_TIMEOUT_MS: 25 });
    const outcome = service.consume(identity, 'search').catch(error => error);
    await jest.advanceTimersByTimeAsync(24);
    expect(service.getStats().search.unavailable).toBe(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({ status: 503, response: { code: 'KNOWLEDGE_RATE_LIMIT_UNAVAILABLE' } });
    reject(new Error('late private Redis error'));
    await Promise.resolve();
    expect(service.getStats().search.unavailable).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears timeout timers on success and immediate failure', async () => {
    jest.useFakeTimers();
    const service = makeService();
    await service.consume(identity, 'search');
    expect(jest.getTimerCount()).toBe(0);
    evalScript.mockRejectedValue(new Error('unavailable'));
    await expect(service.consume(identity, 'source')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('returns detached per-operation monitoring counters without sensitive or high-cardinality labels', async () => {
    const service = makeService();
    await service.consume(identity, 'search');
    evalScript.mockResolvedValue([0, 120, 1200, 1000, 1000]);
    await service.consume(identity, 'source');
    const stats = service.getStats();
    expect(stats).toEqual({
      search: { allowed: 1, limited: 0, unavailable: 0 }, source: { allowed: 0, limited: 1, unavailable: 0 },
    });
    stats.search.allowed = 99;
    expect(service.getStats().search.allowed).toBe(1);
  });
});

// Opt-in Redis integration: only unique, expiring test keys are touched.
const redisUrl = process.env.KNOWLEDGE_RATE_LIMIT_TEST_REDIS_URL;
(redisUrl ? describe : describe.skip)('Knowledge limiter Lua on real Redis', () => {
  let redis: Redis;
  let other: Redis;
  const keys: string[] = [];
  const newKeys = () => {
    const prefix = `sep:test:knowledge-rate:{${randomUUID()}}`;
    const pair = [`${prefix}:member`, `${prefix}:enterprise`];
    keys.push(...pair);
    return pair;
  };
  const consume = (pair: string[], member: number, enterprise: number, window = 1000, client = redis) =>
    client.eval(KNOWLEDGE_RATE_LIMIT_SCRIPT, 2, ...pair, member, enterprise, window) as Promise<number[]>;

  beforeAll(() => { redis = new Redis(redisUrl!, { maxRetriesPerRequest: 1 }); other = redis.duplicate(); });
  afterAll(async () => {
    try { for (const key of keys) await redis.del(key); }
    finally { await Promise.all([redis.quit(), other.quit()]); }
  });

  it('admits exactly the member limit across concurrent connections', async () => {
    const pair = newKeys();
    const replies = await Promise.all(Array.from({ length: 30 }, (_, index) => consume(pair, 3, 20, 10_000, index % 2 ? redis : other)));
    expect(replies.filter(([allowed]) => allowed)).toHaveLength(3);
    expect(await redis.mget(...pair)).toEqual(['3', '3']);
  });

  it('enforces enterprise quota across different members without creating denied-member buckets', async () => {
    const pair = newKeys();
    const members = Array.from({ length: 20 }, (_, index) => `${pair[0]}:${index}`);
    keys.push(...members);
    const replies = await Promise.all(members.map((key, index) => consume([key, pair[1]], 5, 4, 10_000, index % 2 ? redis : other)));
    expect(replies.filter(([allowed]) => allowed)).toHaveLength(4);
    expect(await redis.get(pair[1])).toBe('4');
    expect((await redis.mget(...members)).filter(Boolean)).toHaveLength(4);
  });

  it('does not consume the other dimension or extend TTL on denial and recovers after expiry', async () => {
    const pair = newKeys();
    await consume(pair, 1, 10, 250);
    const ttl = await redis.pttl(pair[1]);
    expect((await consume(pair, 1, 10, 250))[0]).toBe(0);
    expect(await redis.mget(...pair)).toEqual(['1', '1']);
    expect(await redis.pttl(pair[1])).toBeLessThanOrEqual(ttl);
    await new Promise(resolve => setTimeout(resolve, 300));
    expect((await consume(pair, 1, 10, 250)).slice(0, 3)).toEqual([1, 1, 1]);
  });

  it('preserves active TTL when configuration changes and detects corrupt non-expiring counters', async () => {
    const pair = newKeys();
    await consume(pair, 10, 10, 1000);
    const ttl = await redis.pttl(pair[0]);
    const next = await consume(pair, 10, 10, 60_000);
    expect(next[3]).toBeLessThanOrEqual(ttl);
    await redis.set(pair[0], 'invalid', 'PX', 10_000);
    await expect(consume(pair, 10, 10)).rejects.toThrow();
    await redis.set(pair[0], '1');
    await expect(consume(pair, 10, 10)).rejects.toThrow();
    expect(await redis.get(pair[1])).toBe('2');
  });
});
