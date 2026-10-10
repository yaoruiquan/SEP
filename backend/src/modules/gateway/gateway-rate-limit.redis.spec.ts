import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { GATEWAY_RATE_LIMIT_SCRIPT } from './gateway-rate-limit.service';

// Opt-in local Redis integration; only touches uniquely named expiring test keys.
const integration = process.env.GATEWAY_REDIS_TEST_URL ? describe : describe.skip;
integration('Gateway limiter Lua on real Redis', () => {
  let redis: Redis;
  const keys: string[] = [];
  const newKey = () => { const key = `sep:test:gateway-rate:${randomUUID()}`; keys.push(key); return key; };
  const consume = (client: Redis, key: string, limit: number, windowMs: number) =>
    client.eval(GATEWAY_RATE_LIMIT_SCRIPT, 1, key, limit, windowMs) as Promise<number[]>;
  beforeAll(() => { redis = new Redis(process.env.GATEWAY_REDIS_TEST_URL!, { maxRetriesPerRequest: 1 }); });
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
});
