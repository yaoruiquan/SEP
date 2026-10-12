import Redis from 'ioredis';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { GatewayAdmissionService, gatewayAdmissionKeys, GATEWAY_ADMISSION_LEASE_MS,
  GATEWAY_ADMISSION_SCRIPT, GATEWAY_ADMISSION_RELEASE_SCRIPT, GATEWAY_RESOURCE_RESERVE_SCRIPT } from './gateway-admission.service';
import { policySnapshot } from './gateway-policy.test-fixtures';

const url = process.env.GATEWAY_RATE_LIMIT_TEST_REDIS_URL || process.env.GATEWAY_REDIS_TEST_URL;
const integration = url ? describe : describe.skip;

integration('Gateway shared admission Lua on isolated Redis', () => {
  let redis: Redis;
  let other: Redis;
  let a: GatewayAdmissionService;
  let b: GatewayAdmissionService;
  const keys = new Set<string>();
  function identity(memberId = 'member') {
    const id = { enterpriseId: `test-${randomUUID()}`, memberId };
    track(id);
    return id;
  }
  function track(id: { enterpriseId: string; memberId: string }) {
    const result = gatewayAdmissionKeys(id);
    [...result.admission, result.reserve].forEach(key => keys.add(key));
    return result;
  }
  beforeAll(() => {
    redis = new Redis(url!, { maxRetriesPerRequest: 1 });
    other = redis.duplicate();
    a = new GatewayAdmissionService({ redis } as never);
    b = new GatewayAdmissionService({ redis: other } as never);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterAll(async () => {
    try { if (keys.size) await redis.del(...keys); } finally { await Promise.all([redis.quit(), other.quit()]); }
    jest.restoreAllMocks();
  });

  it('admits exactly four under two-instance races and keeps RPM after idempotent release', async () => {
    const id = identity();
    const results = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => (i % 2 ? a : b).acquire(id, policySnapshot())));
    const accepted = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    expect(accepted).toHaveLength(4);
    const k = track(id);
    expect(await redis.get(k.admission[0])).toBe('4');
    expect(await redis.get(k.admission[1])).toBe('4');
    expect(await redis.zcard(k.admission[2])).toBe(4);
    expect(await redis.zcard(k.admission[3])).toBe(4);
    expect(await redis.pttl(k.admission[3])).toBeGreaterThan(GATEWAY_ADMISSION_LEASE_MS - 5000);
    await Promise.all(accepted.map(lease => Promise.all([lease.release(), lease.release()])));
    expect(await redis.exists(k.admission[2], k.admission[3])).toBe(0);
    expect(await redis.get(k.admission[1])).toBe('4');
  });

  it('shares enterprise concurrency across members, declines atomically and permits after release', async () => {
    const id = identity();
    const next = { ...id, memberId: 'other' };
    track(next);
    const policy = policySnapshot({ GATEWAY_MEMBER_CONCURRENCY: 1, GATEWAY_ENTERPRISE_CONCURRENCY: 1 });
    const first = await a.acquire(id, policy);
    await expect(b.acquire(next, policy)).rejects.toMatchObject({ response: { error: { rule: 'enterprise-concurrency' } } });
    expect(await redis.exists(track(next).admission[0])).toBe(0);
    await first.release();
    const second = await b.acquire(next, policy);
    await second.release();
  });

  it('preserves current RPM TTL and counts when policy limits change', async () => {
    const id = identity();
    const first = await a.acquire(id, policySnapshot());
    await first.release();
    const k = track(id).admission;
    await redis.pexpire(k[0], 250);
    const resetAt = Date.now() + await redis.pttl(k[0]);
    const error = await b.acquire(id, policySnapshot({ GATEWAY_MEMBER_RPM: 1 }, 8)).catch(error => error);
    expect(error.response.error).toMatchObject({ rule: 'member-rpm', count: 1, policyVersion: 8 });
    expect(Math.abs(error.response.error.resetAt - resetAt)).toBeLessThan(30);
    expect(await redis.pttl(k[0])).toBeLessThanOrEqual(250);
    expect(await redis.get(k[1])).toBe('1');
    await new Promise(resolve => setTimeout(resolve, 300));
    const recovered = await a.acquire(id, policySnapshot({ GATEWAY_MEMBER_RPM: 1 }));
    await recovered.release();
  });

  it('does not kill in-flight leases on a lower concurrency limit and expires crashed leases', async () => {
    const id = identity();
    const first = await a.acquire(id, policySnapshot());
    const second = await b.acquire(id, policySnapshot());
    const lowered = policySnapshot({ GATEWAY_MEMBER_CONCURRENCY: 1 }, 8);
    await expect(a.acquire(id, lowered)).rejects.toMatchObject({ response: { error: { count: 2 } } });
    const k = track(id).admission;
    expect(await redis.zcard(k[2])).toBe(2);
    for (const key of k.slice(2)) {
      const leases = await redis.zrange(key, 0, -1);
      await redis.zadd(key, ...leases.flatMap(lease => [Date.now() - 1, lease]));
    }
    const recovered = await b.acquire(id, lowered);
    await first.release();
    await second.release();
    expect(await redis.zcard(k[2])).toBe(1);
    await recovered.release();
  });

  it('shares RPM across instances and members at the enterprise threshold', async () => {
    const id = identity();
    const policy = policySnapshot({ GATEWAY_MEMBER_RPM: 2, GATEWAY_ENTERPRISE_RPM: 2 });
    for (const memberId of ['client', 'web']) {
      const candidate = { ...id, memberId };
      track(candidate);
      await (await a.acquire(candidate, policy)).release();
    }
    const planner = { ...id, memberId: 'planner' };
    track(planner);
    await expect(b.acquire(planner, policy)).rejects.toMatchObject({ response: { error: {
      rule: 'enterprise-rpm', limit: 2, count: 2,
    } } });
    expect(await redis.exists(track(planner).admission[0])).toBe(0);
  });

  it('reserves atomically across chains, does not refund on release, and resumes at expiry', async () => {
    const id = identity();
    const request = { messages: [{ content: '系统' }], tools: [{ name: 'test' }] };
    const amount = Buffer.byteLength(JSON.stringify(request), 'utf8') + 10;
    const policy = policySnapshot({ GATEWAY_ENTERPRISE_TOKEN_BUDGET: amount * 3 });
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) =>
      (i % 2 ? a : b).reserve({ ...id, memberId: `member-${i}` }, policy, request, 10)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(3);
    const key = track(id).reserve;
    expect(await redis.get(key)).toBe(String(amount * 3));
    const lease = await a.acquire(id, policy);
    await lease.release();
    expect(await redis.get(key)).toBe(String(amount * 3));
    await redis.pexpire(key, 200);
    await expect(b.reserve(id, policy, request, 10)).rejects.toMatchObject({ response: { error: { count: amount * 3 } } });
    expect(await redis.pttl(key)).toBeLessThanOrEqual(200);
    await a.reserve(id, policySnapshot(), request, 10);
    expect(await redis.get(key)).toBe(String(amount * 3));
    await new Promise(resolve => setTimeout(resolve, 250));
    await a.reserve(id, policy, request, 10);
    expect(await redis.get(key)).toBe(String(amount));
  });

  const rawAcquire = (id: { enterpriseId: string; memberId: string }, execution: string, lease = 5000) =>
    redis.eval(GATEWAY_ADMISSION_SCRIPT, 4, ...track(id).admission, 120, 600, 4, 32, 60000, lease, execution) as Promise<number[]>;
  const rawRelease = (id: { enterpriseId: string; memberId: string }, execution: string, deadline: number) =>
    redis.eval(GATEWAY_ADMISSION_RELEASE_SCRIPT, 2, ...track(id).admission.slice(2), execution, deadline);

  it('rejects duplicate server IDs without refreshing the lease or consuming RPM', async () => {
    const id = identity();
    const first = await rawAcquire(id, 'same');
    expect(await rawAcquire(id, 'same')).toEqual([-1, 0, 0, 0, 0]);
    const k = track(id).admission;
    expect(await redis.zscore(k[2], 'same')).toBe(String(first[4]));
    expect(await redis.mget(k[0], k[1])).toEqual(['1', '1']);
  });

  it('protects replacement leases against old owners and never refunds RPM or reservations', async () => {
    const id = identity();
    const old = await rawAcquire(id, 'same', 50);
    await new Promise(resolve => setTimeout(resolve, 80));
    const replacement = await rawAcquire(id, 'same');
    expect(await rawRelease(id, 'same', old[4])).toBe(0);
    const k = track(id);
    expect(await redis.zscore(k.admission[2], 'same')).toBe(String(replacement[4]));
    expect(await redis.zscore(k.admission[3], 'same')).toBe(String(replacement[4]));
    await a.reserve(id, policySnapshot({ GATEWAY_ENTERPRISE_TOKEN_BUDGET: 1000 }), {}, 10);
    expect(await rawRelease(id, 'same', replacement[4])).toBe(2);
    expect(await rawRelease(id, 'same', replacement[4])).toBe(0);
    expect(await redis.mget(k.admission[0], k.admission[1], k.reserve)).toEqual(['2', '2', '12']);
  });

  it('keeps the longest owned deadline when a subsequent raw caller has a shorter lease', async () => {
    const id = identity();
    const long = await rawAcquire(id, 'long', 1000);
    await rawAcquire(id, 'short', 100);
    const k = track(id).admission;
    expect(await redis.pttl(k[3])).toBeGreaterThan(800);
    await new Promise(resolve => setTimeout(resolve, 150));
    await expect(a.acquire(id, policySnapshot({ GATEWAY_MEMBER_CONCURRENCY: 1 })))
      .rejects.toMatchObject({ response: { error: { rule: 'member-concurrency', count: 1, resetAt: long[4] } } });
  });

  it.each(['not-a-number', '-1', '1.5', '1e3', '01', ' 1 ', '9007199254740992', 'persistent']) (
    'fails closed on corrupt or persistent counters %s without consuming other budgets', async value => {
      const id = identity();
      const k = track(id);
      const raw = value === 'persistent' ? '1' : value;
      for (const key of [k.admission[0], k.admission[1]]) {
        if (value === 'persistent') await redis.set(key, raw);
        else await redis.set(key, raw, 'PX', 2000);
        await expect(a.acquire(id, policySnapshot())).rejects.toMatchObject({ status: 503 });
        expect(await redis.zcard(k.admission[2])).toBe(0);
        expect(await redis.zcard(k.admission[3])).toBe(0);
        expect(await redis.get(k.admission[key === k.admission[0] ? 1 : 0])).toBeNull();
        expect(await redis.get(key)).toBe(raw);
        await redis.del(key);
      }
      if (value === 'persistent') await redis.set(k.reserve, raw);
      else await redis.set(k.reserve, raw, 'PX', 2000);
      await expect(a.reserve(id, policySnapshot({ GATEWAY_ENTERPRISE_TOKEN_BUDGET: 1000 }), {}, 10))
        .rejects.toMatchObject({ status: 503 });
      expect(await redis.get(k.reserve)).toBe(raw);
      expect(await redis.exists(...k.admission)).toBe(0);
    },
  );

  it('validates both RPM counters before writing any increments even when a prior counter is over limit', async () => {
    const id = identity();
    const k = track(id).admission;
    await redis.set(k[0], '120', 'PX', 2000);
    await redis.set(k[1], 'corrupt', 'PX', 2000);
    await expect(a.acquire(id, policySnapshot())).rejects.toMatchObject({ status: 503 });
    expect(await redis.mget(k[0], k[1])).toEqual(['120', 'corrupt']);
    expect(await redis.exists(k[2], k[3])).toBe(0);
  });

  it('does not create a token window when a reservation exceeds the entire budget', async () => {
    const id = identity();
    await expect(a.reserve(id, policySnapshot({ GATEWAY_ENTERPRISE_TOKEN_BUDGET: 1 }), {}, 10))
      .rejects.toMatchObject({ status: 429, response: { error: { count: 0, rateLimit: { windowMs: 60000 } } } });
    expect(await redis.exists(track(id).reserve)).toBe(0);
  });

  it('retains business RPM after a separate failed reservation and owner release', async () => {
    const id = identity();
    const snapshot = policySnapshot({ GATEWAY_ENTERPRISE_TOKEN_BUDGET: 1 });
    const lease = await a.acquire(id, snapshot);
    await expect(a.reserve(id, snapshot, {}, 10)).rejects.toMatchObject({ status: 429 });
    await lease.release();
    const k = track(id);
    expect(await redis.mget(k.admission[0], k.admission[1], k.reserve)).toEqual(['1', '1', null]);
    expect(await redis.exists(k.admission[2], k.admission[3])).toBe(0);
  });

  it('uses Redis TTL/reset time rather than extending the active reservation window', async () => {
    const id = identity();
    const key = track(id).reserve;
    await redis.set(key, '10', 'PX', 500);
    const result = await redis.eval(GATEWAY_RESOURCE_RESERVE_SCRIPT, 1, key, 1000, 10, 60000) as number[];
    expect(result.slice(0, 3)).toEqual([1, 0, 20]);
    expect(result[3]).toBeLessThanOrEqual(500);
    expect(await redis.pttl(key)).toBeLessThanOrEqual(500);
  });

  it('returns the earliest lease deadline without extending any window on denied retries', async () => {
    const id = identity();
    const first = await rawAcquire(id, 'first', 1000);
    await rawAcquire(id, 'second', 2000);
    const k = track(id).admission;
    const before = await Promise.all(k.map(key => redis.pttl(key)));
    const policy = policySnapshot({ GATEWAY_MEMBER_CONCURRENCY: 2 });
    const denied = await a.acquire(id, policy).catch(error => error);
    await new Promise(resolve => setTimeout(resolve, 30));
    const retry = await b.acquire(id, policy).catch(error => error);
    expect(denied.response.error).toMatchObject({ rule: 'member-concurrency', count: 2, resetAt: first[4] });
    expect(retry.response.error.resetAt).toBe(first[4]);
    const after = await Promise.all(k.map(key => redis.pttl(key)));
    after.forEach((ttl, i) => expect(ttl).toBeLessThan(before[i]));
    expect(await redis.mget(k[0], k[1])).toEqual(['2', '2']);
  });

  it('only removes expired leases when an RPM rejection leaves an active owner in place', async () => {
    const id = identity();
    await rawAcquire(id, 'live');
    const k = track(id).admission;
    for (const key of k.slice(2)) await redis.zadd(key, 1, 'expired');
    const before = await redis.pttl(k[3]);
    await expect(a.acquire(id, policySnapshot({ GATEWAY_MEMBER_RPM: 1 })))
      .rejects.toMatchObject({ response: { error: { rule: 'member-rpm', count: 1 } } });
    expect(await redis.zrange(k[2], 0, -1)).toEqual(['live']);
    expect(await redis.zrange(k[3], 0, -1)).toEqual(['live']);
    expect(await redis.pttl(k[3])).toBeLessThanOrEqual(before);
    expect(await redis.mget(k[0], k[1])).toEqual(['1', '1']);
  });

  it('releases only its own execution while preserving other active executions', async () => {
    const id = identity();
    const first = await rawAcquire(id, 'first');
    await rawAcquire(id, 'second');
    expect(await rawRelease(id, 'first', first[4])).toBe(2);
    expect(await rawRelease(id, 'first', first[4])).toBe(0);
    const k = track(id).admission;
    expect(await redis.zrange(k[2], 0, -1)).toEqual(['second']);
    expect(await redis.zrange(k[3], 0, -1)).toEqual(['second']);
    expect(await redis.mget(k[0], k[1])).toEqual(['2', '2']);
  });

  it.each(['member', 'enterprise'])('enforces the %s RPM threshold atomically across two clients', async dimension => {
    const id = identity();
    const policy = policySnapshot({ GATEWAY_MEMBER_RPM: 3, GATEWAY_ENTERPRISE_RPM: dimension === 'enterprise' ? 3 : 600 });
    const candidates = Array.from({ length: 25 }, (_, i) => dimension === 'member' ? id : { ...id, memberId: `m-${i}` });
    candidates.forEach(track);
    const results = await Promise.allSettled(candidates.map((candidate, i) => (i % 2 ? a : b).acquire(candidate, policy)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(3);
    const rejected = results.filter(result => result.status === 'rejected');
    for (const result of rejected) {
      if (result.status === 'rejected') expect(result.reason.response.error).toMatchObject({ rule: `${dimension}-rpm`, count: 3 });
    }
    const k = track(id).admission;
    expect(await redis.get(k[1])).toBe('3');
    expect(await redis.zcard(k[3])).toBe(3);
    await Promise.all(results.flatMap(result => result.status === 'fulfilled' ? [result.value.release()] : []));
  });
});
