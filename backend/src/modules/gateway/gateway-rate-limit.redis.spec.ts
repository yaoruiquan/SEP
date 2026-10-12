import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { GATEWAY_RATE_LIMIT_SCRIPT } from './gateway-rate-limit.service';

// Opt-in local Redis integration; only touches uniquely named expiring test keys.
const url = process.env.GATEWAY_RATE_LIMIT_TEST_REDIS_URL || process.env.GATEWAY_REDIS_TEST_URL;
const integration = url ? describe : describe.skip;
integration('Gateway limiter Lua on real Redis', () => {
  let redis: Redis;
  const keys: string[] = [];
  const newKey = () => { const key = `sep:test:gateway-rate:${randomUUID()}`; keys.push(key, `{${key}}:window`); return key; };
  const consume = (client: Redis, key: string, limit: number, windowMs: number) =>
    client.eval(GATEWAY_RATE_LIMIT_SCRIPT, 2, key, `{${key}}:window`, limit, windowMs) as Promise<number[]>;
  beforeAll(() => { redis = new Redis(url!, { maxRetriesPerRequest: 1 }); });
  afterAll(async () => {
    try { if (keys.length) await redis.del(...keys); } finally { await redis.quit(); }
  });

  it('admits exactly the limit under concurrent requests from two clients', async () => {
    const key = newKey();
    const other = redis.duplicate();
    try {
      const results = await Promise.all(Array.from({ length: 30 }, (_, i) => consume(i % 2 ? redis : other, key, 3, 10_000)));
      expect(results.filter(([allowed]) => allowed === 1)).toHaveLength(3);
      expect(await redis.get(key)).toBe('3');
      expect(results.filter(([allowed]) => !allowed).every(([, count]) => count === 3)).toBe(true);
    } finally { await other.quit(); }
  });

  it('does not prolong rejected windows and recovers at expiry', async () => {
    const key = newKey();
    const first = await consume(redis, key, 1, 250);
    const retry = await consume(redis, key, 1, 250);
    expect(retry[0]).toBe(0);
    expect(retry[1]).toBe(1);
    expect(retry[3]).toBe(first[3]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const restored = await consume(redis, key, 1, 250);
    expect(restored.slice(0, 3)).toEqual([1, 1, 250]);
    expect(restored[3]).toBeGreaterThan(first[3]);
  });

  it('preserves legacy bucket TTL across window and threshold changes until expiry', async () => {
    const key = newKey();
    await redis.set(key, 5, 'PX', 250);
    const initialTtl = await redis.pttl(key);
    const denied = await consume(redis, key, 3, 60000);
    expect(denied.slice(0, 2)).toEqual([0, 5]);
    expect(denied[4]).toBe(0);
    expect(denied[2]).toBeLessThanOrEqual(initialTtl);
    const allowed = await consume(redis, key, 10, 60000);
    expect(allowed.slice(0, 2)).toEqual([1, 6]);
    expect(allowed[2]).toBeLessThanOrEqual(initialTtl);
    await new Promise(resolve => setTimeout(resolve, 300));
    const recovered = await consume(redis, key, 10, 1000);
    expect(recovered.slice(0, 3)).toEqual([1, 1, 1000]);
    expect(recovered[4]).toBe(1000);
  });

  it('reports the original window while changes only affect new windows and current thresholds', async () => {
    const key = newKey();
    const first = await consume(redis, key, 10, 250);
    const changed = await consume(redis, key, 1, 60000);
    expect(changed[0]).toBe(0);
    expect(changed[3]).toBe(first[3]);
    expect(changed[4]).toBe(250);
    await new Promise(resolve => setTimeout(resolve, 300));
    const next = await consume(redis, key, 1, 1000);
    expect(next.slice(0, 3)).toEqual([1, 1, 1000]);
    expect(next[4]).toBe(1000);
  });
});
