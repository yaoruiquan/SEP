import { ConfigService } from '@nestjs/config';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { RedisService } from '../../redis/redis.service';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import { GATEWAY_ADMISSION_RELEASE_SCRIPT, GATEWAY_ADMISSION_SCRIPT, GatewayAdmissionService } from './gateway-admission.service';

// Opt-in against isolated local Redis only; unique expiring keys, never FLUSHDB.
const integration = process.env.GATEWAY_REDIS_TEST_URL ? describe : describe.skip;
integration('Gateway admission Lua on real Redis', () => {
  let redis: Redis;
  const ownedKeys = new Set<string>();
  const newKeys = (enterprise = randomUUID(), member = randomUUID()) => {
    const prefix = `sep:test:gateway-admission:{${enterprise}}`;
    const keys = [
      `${prefix}:concurrency:enterprise`, `${prefix}:concurrency:member:${member}`,
      `${prefix}:rpm:member:${member}`, `${prefix}:rpm:enterprise`, `${prefix}:tokens:enterprise`,
    ];
    keys.forEach((key) => ownedKeys.add(key));
    return keys;
  };
  const acquire = (keys: string[], options: {
    client?: Redis; execution?: string; lease?: number; window?: number;
    memberConcurrency?: number; enterpriseConcurrency?: number; memberRpm?: number; enterpriseRpm?: number;
    tokenLimit?: number; reservation?: number;
  } = {}) => (options.client ?? redis).eval(
    GATEWAY_ADMISSION_SCRIPT, 5, ...keys, options.execution ?? randomUUID(), options.lease ?? 5000,
    options.window ?? 2000, options.memberConcurrency ?? 50, options.enterpriseConcurrency ?? 100,
    options.memberRpm ?? 100, options.enterpriseRpm ?? 200, options.tokenLimit ?? 0, options.reservation ?? 0,
  ) as Promise<number[]>;
  const release = (keys: string[], execution: string, deadline: number) => redis.eval(
    GATEWAY_ADMISSION_RELEASE_SCRIPT, 2, ...keys.slice(0, 2), execution, deadline,
  );
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  beforeAll(() => {
    redis = new Redis(process.env.GATEWAY_REDIS_TEST_URL!, { maxRetriesPerRequest: 1 });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterAll(async () => {
    try { if (ownedKeys.size) await redis.del(...ownedKeys); } finally { await redis.quit(); jest.restoreAllMocks(); }
  });

  it('admits exactly the member concurrency limit atomically across two clients', async () => {
    const keys = newKeys();
    const other = redis.duplicate();
    try {
      const results = await Promise.all(Array.from({ length: 30 }, (_, i) => acquire(keys, {
        client: i % 2 ? other : redis, memberConcurrency: 4,
      })));
      expect(results.filter(([allowed]) => allowed === 1)).toHaveLength(4);
      expect(results.filter(([allowed]) => !allowed).every(([, rule, count]) => rule === 1 && count === 4)).toBe(true);
      expect(await redis.zcard(keys[0])).toBe(4);
      expect(await redis.zcard(keys[1])).toBe(4);
      expect(await redis.mget(keys[2], keys[3], keys[4])).toEqual(['4', '4', null]);
    } finally { await other.quit(); }
  });

  it('enforces enterprise concurrency across members without writing rejected member keys', async () => {
    const enterprise = randomUUID();
    const sets = Array.from({ length: 20 }, () => newKeys(enterprise));
    const results = await Promise.all(sets.map((keys) => acquire(keys, { enterpriseConcurrency: 3 })));
    expect(results.filter(([allowed]) => allowed === 1)).toHaveLength(3);
    expect(await redis.zcard(sets[0][0])).toBe(3);
    expect(await redis.get(sets[0][3])).toBe('3');
    for (const [i, result] of results.entries()) {
      if (result[0]) continue;
      expect(result.slice(0, 3)).toEqual([0, 2, 3]);
      expect(await redis.exists(sets[i][1], sets[i][2])).toBe(0);
    }
  });

  it.each([
    ['member', { memberRpm: 3 }, 3], ['enterprise', { enterpriseRpm: 3 }, 4],
    ['token', { tokenLimit: 30, reservation: 10 }, 5],
  ] as const)('checks all %s budgets before writing any quota or lease', async (_name, limits, rule) => {
    const keys = newKeys();
    const other = redis.duplicate();
    try {
      const results = await Promise.all(Array.from({ length: 25 }, (_, i) => acquire(keys, {
        ...limits, client: i % 2 ? other : redis,
      })));
      expect(results.filter(([allowed]) => allowed === 1)).toHaveLength(3);
      expect(results.filter(([allowed]) => !allowed).every(([, deniedRule]) => deniedRule === rule)).toBe(true);
      expect(await redis.zcard(keys[0])).toBe(3);
      expect(await redis.zcard(keys[1])).toBe(3);
      expect(await redis.mget(keys[2], keys[3], keys[4])).toEqual(['3', '3', rule === 5 ? '30' : null]);
    } finally { await other.quit(); }
  });

  it('aggregates enterprise RPM and token reservations across members', async () => {
    const enterprise = randomUUID();
    const a = newKeys(enterprise);
    const b = newKeys(enterprise);
    const c = newKeys(enterprise);
    await acquire(a, { enterpriseRpm: 2, tokenLimit: 100, reservation: 30 });
    await acquire(b, { enterpriseRpm: 2, tokenLimit: 100, reservation: 30 });
    const denied = await acquire(c, { enterpriseRpm: 2, tokenLimit: 100, reservation: 30 });
    expect(denied.slice(0, 3)).toEqual([0, 4, 2]);
    expect(await redis.mget(a[2], b[2], c[2], a[3], a[4])).toEqual(['1', '1', null, '2', '60']);
    expect(await redis.exists(c[1])).toBe(0);
  });

  it('does not prolong concurrency TTLs or write quotas on denied retries; returns earliest lease deadline', async () => {
    const keys = newKeys();
    const first = await acquire(keys, { memberConcurrency: 2, lease: 1000 });
    await sleep(25);
    await acquire(keys, { memberConcurrency: 2, lease: 2000 });
    const before = await Promise.all(keys.map((key) => redis.pttl(key)));
    const denied = await acquire(keys, { memberConcurrency: 2, lease: 10000 });
    await sleep(30);
    const retry = await acquire(keys, { memberConcurrency: 2, lease: 10000 });
    const after = await Promise.all(keys.map((key) => redis.pttl(key)));
    expect(denied.slice(0, 3)).toEqual([0, 1, 2]);
    expect(denied[4]).toBe(first[4]);
    expect(retry[4]).toBe(first[4]);
    expect(retry[3]).toBeLessThan(denied[3]);
    for (let i = 0; i < 4; i++) expect(after[i]).toBeLessThan(before[i]);
    expect(await redis.mget(keys[2], keys[3], keys[4])).toEqual(['2', '2', null]);
  });

  it('does not extend an aggregate RPM window and recovers at expiry', async () => {
    const keys = newKeys();
    const first = await acquire(keys, { memberRpm: 1, window: 150 });
    const denied = await acquire(keys, { memberRpm: 1, window: 150 });
    expect(denied.slice(0, 3)).toEqual([0, 3, 1]);
    await sleep(25);
    const retry = await acquire(keys, { memberRpm: 1, window: 150 });
    expect(retry[4]).toBe(denied[4]);
    await sleep(160);
    const next = await acquire(keys, { memberRpm: 1, window: 150 });
    expect(next[0]).toBe(1);
    expect(next[4]).toBeGreaterThan(first[4]);
    expect(await redis.get(keys[2])).toBe('1');
  });

  it('rejects an oversized token reservation without creating any keys', async () => {
    const keys = newKeys();
    const denied = await acquire(keys, { tokenLimit: 10, reservation: 11 });
    expect(denied.slice(0, 3)).toEqual([0, 5, 0]);
    expect(await redis.exists(...keys)).toBe(0);
  });

  it('only cleans expired leases on rejection without extending remaining leases', async () => {
    const keys = newKeys();
    await acquire(keys, { execution: 'live', memberRpm: 1 });
    await redis.zadd(keys[0], 1, 'expired');
    await redis.zadd(keys[1], 1, 'expired');
    const before = await redis.pttl(keys[0]);
    const denied = await acquire(keys, { memberRpm: 1 });
    expect(denied.slice(0, 3)).toEqual([0, 3, 1]);
    expect(await redis.zrange(keys[0], 0, -1)).toEqual(['live']);
    expect(await redis.zrange(keys[1], 0, -1)).toEqual(['live']);
    expect(await redis.pttl(keys[0])).toBeLessThanOrEqual(before);
    expect(await redis.mget(keys[2], keys[3])).toEqual(['1', '1']);
  });

  it('recovers crashed executions by expiring leases without a release call', async () => {
    const keys = newKeys();
    await acquire(keys, { execution: 'crashed', memberConcurrency: 1, lease: 100 });
    expect((await acquire(keys, { memberConcurrency: 1, lease: 100 }))[0]).toBe(0);
    await sleep(150);
    expect((await acquire(keys, { execution: 'replacement', memberConcurrency: 1, lease: 100 }))[0]).toBe(1);
    expect(await redis.zrange(keys[0], 0, -1)).toEqual(['replacement']);
    expect(await redis.zrange(keys[1], 0, -1)).toEqual(['replacement']);
    expect(await redis.mget(keys[2], keys[3])).toEqual(['2', '2']);
  });

  it('uses the last deadline for TTL, not a later request with a shorter lease', async () => {
    const keys = newKeys();
    const long = await acquire(keys, { execution: 'long', lease: 1000 });
    await acquire(keys, { execution: 'short', lease: 100 });
    expect(await redis.pttl(keys[0])).toBeGreaterThan(800);
    await sleep(150);
    const denied = await acquire(keys, { memberConcurrency: 1 });
    expect(denied.slice(0, 3)).toEqual([0, 1, 1]);
    expect(denied[4]).toBe(long[4]);
  });

  it('releases idempotently without removing other executions or refunding RPM/tokens', async () => {
    const keys = newKeys();
    const a = await acquire(keys, { execution: 'a', tokenLimit: 100, reservation: 20 });
    await acquire(keys, { execution: 'b', tokenLimit: 100, reservation: 20 });
    expect(await release(keys, 'a', a[4])).toBe(2);
    expect(await release(keys, 'a', a[4])).toBe(0);
    expect(await redis.zrange(keys[0], 0, -1)).toEqual(['b']);
    expect(await redis.zrange(keys[1], 0, -1)).toEqual(['b']);
    expect(await redis.mget(keys[2], keys[3], keys[4])).toEqual(['2', '2', '40']);
  });

  it('rejects duplicate active server IDs without refreshing or consuming quotas', async () => {
    const keys = newKeys();
    const first = await acquire(keys, { execution: 'same' });
    const duplicate = await acquire(keys, { execution: 'same' });
    expect(duplicate).toEqual([-1, 0, 0, 0, 0]);
    expect(await redis.zscore(keys[0], 'same')).toBe(String(first[4]));
    expect(await redis.mget(keys[2], keys[3])).toEqual(['1', '1']);
  });

  it('does not let an old release delete a newer lease with the same execution ID', async () => {
    const keys = newKeys();
    const old = await acquire(keys, { execution: 'same', lease: 50 });
    await sleep(80);
    const replacement = await acquire(keys, { execution: 'same' });
    expect(await release(keys, 'same', old[4])).toBe(0);
    expect(await redis.zscore(keys[0], 'same')).toBe(String(replacement[4]));
    expect(await redis.zscore(keys[1], 'same')).toBe(String(replacement[4]));
  });

  it('fails closed on corrupt counters without adding a lease or changing other quotas', async () => {
    const keys = newKeys();
    await redis.set(keys[3], 'not-a-number', 'PX', 2000);
    await expect(acquire(keys)).rejects.toThrow('Invalid gateway admission counter');
    expect(await redis.exists(keys[0], keys[1], keys[2], keys[4])).toBe(0);
    expect(await redis.get(keys[3])).toBe('not-a-number');
  });

  it('runs the public service API on real Redis with conservative reservations and safe 503 duplicate handling', async () => {
    const enterpriseId = randomUUID();
    const claims: ClientEmploymentClaims = {
      sub: 'user', enterpriseId, memberId: 'member', subscriptionId: 'subscription',
      type: 'client-employment', sid: 'session', iat: 1, exp: 2,
    };
    const trackedRedis = { eval: async (script: string, count: number, ...args: (string | number)[]) => {
      args.slice(0, count).forEach((key) => ownedKeys.add(String(key)));
      return redis.eval(script, count, ...args);
    } };
    const service = new GatewayAdmissionService(
      { redis: trackedRedis } as unknown as RedisService,
      new ConfigService({ GATEWAY_ENTERPRISE_TOKEN_BUDGET: 10000, GATEWAY_MEMBER_CONCURRENCY: 1 }),
    );
    const dto = { model: 'model', messages: [{ role: 'user' as const, content: 'input' }], max_tokens: 100 };
    const lease = await service.acquire(claims, 'exec-a', dto);
    await expect(service.acquire(claims, 'exec-a', dto)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.acquire(claims, 'exec-b', dto)).rejects.toMatchObject({ status: 429 });
    await Promise.all([lease.release(), lease.release()]);
    const next = await service.acquire(claims, 'exec-b', dto);
    await next.release();
    const tokenKey = [...ownedKeys].find((key) => key.startsWith('sep:gateway:admission:') && key.endsWith(':tokens:enterprise'))!;
    expect(await redis.get(tokenKey)).toBe(String(2 * (Buffer.byteLength(JSON.stringify(dto)) + 100)));
    const prefix = tokenKey.replace(':tokens:enterprise', '');
    expect(await redis.zcard(`${prefix}:concurrency:enterprise`)).toBe(0);
    expect(await redis.get(`${prefix}:rpm:enterprise`)).toBe('2');
  });
});
