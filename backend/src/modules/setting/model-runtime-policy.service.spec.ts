import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  MODEL_RUNTIME_POLICY_AUDIT_ACTION, MODEL_RUNTIME_POLICY_KEYS, MODEL_RUNTIME_POLICY_REVISION,
  type UpdateModelRuntimePolicyDto,
} from 'shared';
import { ModelRuntimePolicyService } from './model-runtime-policy.service';

type AuditRow = { id: string; actorId: string; createdAt: Date; metadata: any; action: string; resourceType: string; result: string };

function fixture(env: Record<string, unknown> = {}, initial: Record<string, string> = {}) {
  const state = new Map(Object.entries(initial));
  const logs: AuditRow[] = [];
  const controls = { failAudit: false, failUpsertKey: '', failRead: false };
  const transactions: any[] = [];
  let tail: Promise<unknown> = Promise.resolve();
  function client(data: Map<string, string>, audit: AuditRow[]) {
    const matches = (row: AuditRow, where: Record<string, string>) => Object.entries(where).every(([key, value]) => row[key] === value);
    return {
      systemSetting: {
        findMany: jest.fn(async ({ where }: any) => {
          if (controls.failRead) throw new Error('private database credentials must not escape');
          return [...data].filter(([key]) => where.key.in.includes(key)).map(([key, value]) => ({ key, value }));
        }),
        createMany: jest.fn(async ({ data: rows }: any) => {
          for (const row of rows) if (!data.has(row.key)) data.set(row.key, row.value);
          return { count: rows.length };
        }),
        updateMany: jest.fn(async ({ where, data: updated }: any) => {
          if (data.get(where.key) !== where.value) return { count: 0 };
          data.set(where.key, updated.value);
          return { count: 1 };
        }),
        upsert: jest.fn(async ({ where, create }: any) => {
          if (controls.failUpsertKey === where.key) throw new Error('storage unavailable');
          data.set(where.key, create.value);
          return create;
        }),
        deleteMany: jest.fn(async ({ where }: any) => ({ count: data.delete(where.key) ? 1 : 0 })),
      },
      auditLog: {
        create: jest.fn(async ({ data: row }: any) => {
          if (controls.failAudit) throw new Error('audit unavailable');
          const result = { ...row, id: `history-${audit.length + 1}`, createdAt: new Date(1791792000000 + audit.length) };
          audit.push(result);
          return result;
        }),
        findFirst: jest.fn(async ({ where }: any) => audit.find((row) => matches(row, where)) ?? null),
        findMany: jest.fn(async ({ where, take, cursor, skip }: any) => {
          const rows = audit.filter((row) => matches(row, where)).slice().reverse();
          const start = cursor ? rows.findIndex((row) => row.id === cursor.id) + skip : 0;
          return rows.slice(start, start + take);
        }),
      },
    };
  }
  const prisma: any = client(state, logs);
  // The mock commits cloned state only on success and serializes writers like the revision row lock.
  prisma.$transaction = jest.fn((action: (tx: any) => Promise<unknown>) => {
    const run = tail.then(async () => {
      const nextState = new Map(state);
      const nextLogs = logs.slice();
      const tx = client(nextState, nextLogs);
      transactions.push(tx);
      const result = await action(tx);
      state.clear();
      for (const [key, value] of nextState) state.set(key, value);
      logs.splice(0, logs.length, ...nextLogs);
      return result;
    });
    tail = run.catch(() => undefined);
    return run;
  });
  const config: any = { get: jest.fn((key: string) => env[key]) };
  const service = new ModelRuntimePolicyService(prisma, config);
  async function writable() {
    const preflight = (await service.getForAdmin()).preflight;
    return new ModelRuntimePolicyService(prisma, {
      get: jest.fn((key: string) => ({
        ...env, MODEL_RUNTIME_POLICY_WRITE_ENABLED: 'true',
        MODEL_RUNTIME_POLICY_ENV_FINGERPRINT: preflight.environmentFingerprint,
      })[key]),
    } as any);
  }
  return { service, prisma, state, logs, transactions, controls, config, writable };
}

function update(updates: Record<string, string>, expectedVersion = 0): UpdateModelRuntimePolicyDto {
  return { expectedVersion, updates, reason: '  capacity verification  ' };
}

describe('ModelRuntimePolicyService', () => {
  it('reads one database snapshot with database > environment > default precedence and freezes it', async () => {
    const { service, prisma } = fixture({ GATEWAY_MEMBER_RPM: '150' }, {
      GATEWAY_MEMBER_RPM: '180', GATEWAY_ENTERPRISE_RPM: '', MODEL_RUNTIME_POLICY_REVISION: '7', SUB2API_API_KEY: 'private-key',
    });
    const snapshot = await service.getSnapshot();
    expect(snapshot.version).toBe(7);
    expect(snapshot.values.GATEWAY_MEMBER_RPM).toBe(180);
    expect(snapshot.values.GATEWAY_ENTERPRISE_RPM).toBe(600);
    expect(Object.keys(snapshot.values)).toEqual([...MODEL_RUNTIME_POLICY_KEYS]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.values)).toBe(true);
    expect(prisma.systemSetting.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.systemSetting.findMany.mock.calls[0][0].where.key.in).not.toContain('SUB2API_API_KEY');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(JSON.stringify(snapshot)).not.toContain('private-key');
  });

  it('does not cache database policy and keeps existing snapshots immutable after saves', async () => {
    const f = fixture();
    const service = await f.writable();
    const old = await service.getSnapshot();
    await service.update(update({ GATEWAY_MEMBER_RPM: '160' }), 'admin-1');
    expect(old.version).toBe(0);
    expect(old.values.GATEWAY_MEMBER_RPM).toBe(120);
    expect((await service.getSnapshot()).values.GATEWAY_MEMBER_RPM).toBe(160);
  });

  it('captures deployment environment at construction and fingerprints only non-secret fallback policy', async () => {
    const env = { GATEWAY_MEMBER_RPM: '150', SUB2API_API_KEY: 'secret-a' };
    const a = fixture(env);
    const first = await a.service.getForAdmin();
    env.GATEWAY_MEMBER_RPM = '200';
    expect((await a.service.getSnapshot()).values.GATEWAY_MEMBER_RPM).toBe(150);
    const same = await fixture({ GATEWAY_MEMBER_RPM: '150', SUB2API_API_KEY: 'secret-b' }).service.getForAdmin();
    const different = await fixture(env).service.getForAdmin();
    expect(first.preflight.environmentFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(same.preflight.environmentFingerprint).toBe(first.preflight.environmentFingerprint);
    expect(different.preflight.environmentFingerprint).not.toBe(first.preflight.environmentFingerprint);
    expect(JSON.stringify(first)).not.toContain('secret-a');
  });

  it.each(['0', '-1', 'NaN', 'Infinity', '1.5', '   ', '99999999'])('fails closed on invalid environment %s and reports the field to admins', async (bad) => {
    const { service } = fixture({ GATEWAY_MEMBER_RPM: bad });
    await expect(service.getSnapshot()).rejects.toBeInstanceOf(ServiceUnavailableException);
    const admin = await service.getForAdmin();
    expect(admin.effectivePolicy).toBeNull();
    expect(admin.errors).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'GATEWAY_MEMBER_RPM' })]));
    expect(admin.preflight.environmentValid).toBe(false);
    expect(admin.writeEnabled).toBe(false);
  });

  it('fails closed on database errors without including raw dependency errors', async () => {
    const f = fixture();
    f.controls.failRead = true;
    await expect(f.service.getSnapshot()).rejects.toThrow('模型运行策略依赖不可用');
    await expect(f.service.getForAdmin()).rejects.toThrow('模型运行策略依赖不可用');
  });

  it('exposes runtime invalid-policy failures in a platform error envelope with a known version', async () => {
    const f = fixture({ GATEWAY_MEMBER_RPM: 'bad' }, { MODEL_RUNTIME_POLICY_REVISION: '7' });
    const error = await f.service.getSnapshot().catch((error) => error);
    expect(error.getStatus()).toBe(503);
    const payload = error.getResponse();
    expect(payload).toMatchObject({
      code: 'MODEL_RUNTIME_POLICY_INVALID', message: expect.stringContaining('GATEWAY_MEMBER_RPM'),
      error: {
        source: 'platform', type: 'server_error', code: 'MODEL_RUNTIME_POLICY_INVALID',
        message: expect.stringContaining('GATEWAY_MEMBER_RPM'), policyVersion: 7,
      },
    });
    expect(payload.error.message).toBe(payload.message);
    expect((await f.service.getForAdmin()).errors).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'GATEWAY_MEMBER_RPM' })]));
  });

  it('exposes runtime database failures without fabricating a version or changing admin error envelopes', async () => {
    const f = fixture();
    f.controls.failRead = true;
    const runtime = await f.service.getSnapshot().catch((error) => error);
    const payload = runtime.getResponse();
    expect(payload).toMatchObject({
      code: 'MODEL_RUNTIME_POLICY_UNAVAILABLE', message: '模型运行策略依赖不可用，请稍后重试',
      error: { source: 'platform', type: 'server_error', code: 'MODEL_RUNTIME_POLICY_UNAVAILABLE', message: '模型运行策略依赖不可用，请稍后重试' },
    });
    expect(payload.error).not.toHaveProperty('policyVersion');
    expect(JSON.stringify(payload)).not.toContain('private database credentials');
    const admin = await f.service.getForAdmin().catch((error) => error);
    expect(admin.getResponse()).toEqual({ code: 'MODEL_RUNTIME_POLICY_UNAVAILABLE', message: '模型运行策略依赖不可用，请稍后重试' });
  });

  it('classifies corrupt runtime revisions as invalid configuration without claiming a policy version', async () => {
    const f = fixture({}, { MODEL_RUNTIME_POLICY_REVISION: 'corrupt' });
    const error = await f.service.getSnapshot().catch((error) => error);
    const payload = error.getResponse();
    expect(payload.error).toEqual({
      source: 'platform', type: 'server_error', code: 'MODEL_RUNTIME_POLICY_INVALID', message: '模型运行策略内部版本无效，请检查配置',
    });
    const admin = await f.service.getForAdmin().catch((error) => error);
    expect(admin.getResponse()).toEqual({
      statusCode: 503, message: '模型运行策略内部版本无效，请检查配置', error: 'Service Unavailable',
    });
  });

  it.each(['-1', '1.5', 'bad', '9007199254740992'])('rejects corrupt internal revision %s', async (revision) => {
    const { service } = fixture({}, { MODEL_RUNTIME_POLICY_REVISION: revision });
    await expect(service.getSnapshot()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('defaults to read-only, with legacy overrides visible but never propagated to effective policy', async () => {
    const f = fixture({}, { MODEL_RESPONSE_TIMEOUT: '9999', MAX_CONCURRENT_SESSIONS: '0', MAX_TOKENS_PER_CONVERSATION: '999999' });
    const admin = await f.service.getForAdmin();
    expect(admin.writeEnabled).toBe(false);
    expect(admin.fields.every((field) => !field.editable && field.value === '')).toBe(true);
    expect(admin.preflight.legacyOverrides).toHaveLength(3);
    expect(admin.effectivePolicy.GATEWAY_STREAM_HEADER_TIMEOUT_MS).toBe(120000);
    expect(admin.effectivePolicy.GATEWAY_ENTERPRISE_CONCURRENCY).toBe(32);
    await expect(f.service.update(update({ GATEWAY_MEMBER_RPM: '150' }), 'admin')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires both the release switch and verified matching environment fingerprint', async () => {
    const switched = fixture({ MODEL_RUNTIME_POLICY_WRITE_ENABLED: 'true' });
    expect((await switched.service.getForAdmin()).writeEnabled).toBe(false);
    await expect(switched.service.update(update({ GATEWAY_MEMBER_RPM: '150' }), 'admin')).rejects.toBeInstanceOf(ServiceUnavailableException);
    const f = fixture();
    expect((await (await f.writable()).getForAdmin()).writeEnabled).toBe(true);
  });

  it('does not open writing for invalid fallbacks even if a database override masks them', async () => {
    const f = fixture({ GATEWAY_MEMBER_RPM: 'bad' }, { GATEWAY_MEMBER_RPM: '150' });
    const service = await f.writable();
    expect((await service.getSnapshot()).values.GATEWAY_MEMBER_RPM).toBe(150);
    expect((await service.getForAdmin()).writeEnabled).toBe(false);
    await expect(service.update(update({ GATEWAY_MEMBER_RPM: '' }), 'admin')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('atomically initializes and advances revision, writes all overrides and audits all whitelisted fields', async () => {
    const f = fixture({ GATEWAY_MEMBER_RPM: '130' }, { SUB2API_API_KEY: 'unrelated-private-key', MODEL_RESPONSE_TIMEOUT: '999' });
    const service = await f.writable();
    const result = await service.update(update({ GATEWAY_MEMBER_RPM: '160', GATEWAY_ENTERPRISE_RPM: '700' }), 'admin-1');
    expect(result.version).toBe(1);
    expect(result.fields.find((field) => field.key === 'GATEWAY_MEMBER_RPM')).toMatchObject({ value: '160', effectiveValue: 160, source: 'database' });
    expect(f.state.get(MODEL_RUNTIME_POLICY_REVISION)).toBe('1');
    expect(f.state.get('GATEWAY_ENTERPRISE_RPM')).toBe('700');
    expect(f.transactions[0].systemSetting.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(f.transactions[0].systemSetting.updateMany).toHaveBeenCalledWith({
      where: { key: MODEL_RUNTIME_POLICY_REVISION, value: '0' }, data: { value: '1' },
    });
    expect(f.logs).toHaveLength(1);
    const log = f.logs[0];
    expect(log).toMatchObject({ action: MODEL_RUNTIME_POLICY_AUDIT_ACTION, actorId: 'admin-1', resourceType: 'MODEL_RUNTIME_POLICY', result: 'SUCCESS' });
    expect(log.metadata.reason).toBe('capacity verification');
    expect(Object.keys(log.metadata.before.overrides)).toEqual([...MODEL_RUNTIME_POLICY_KEYS]);
    expect(log.metadata.before).toMatchObject({ version: 0, overrides: { GATEWAY_MEMBER_RPM: null }, effectivePolicy: { GATEWAY_MEMBER_RPM: 130 }, sources: { GATEWAY_MEMBER_RPM: 'environment' } });
    expect(log.metadata.after).toMatchObject({ version: 1, overrides: { GATEWAY_MEMBER_RPM: '160' }, effectivePolicy: { GATEWAY_MEMBER_RPM: 160 }, sources: { GATEWAY_MEMBER_RPM: 'database' } });
    expect(JSON.stringify(log.metadata)).not.toMatch(/unrelated-private-key|SUB2API_API_KEY|MODEL_RESPONSE_TIMEOUT/);
    expect(result.changes).toHaveLength(2);
    expect(result.message).toContain('运行中请求保持原策略');
  });

  it('deletes empty overrides and audits fallback values and next-window semantics', async () => {
    const f = fixture({ GATEWAY_MEMBER_RPM: '130' }, { GATEWAY_MEMBER_RPM: '180' });
    const service = await f.writable();
    const result = await service.update(update({ GATEWAY_MEMBER_RPM: '', GATEWAY_MODEL_RATE_WINDOW_MS: '30000' }), 'admin');
    expect(f.state.has('GATEWAY_MEMBER_RPM')).toBe(false);
    expect(result.effectivePolicy.GATEWAY_MEMBER_RPM).toBe(130);
    expect(result.fields.find((field) => field.key === 'GATEWAY_MEMBER_RPM')).toMatchObject({ value: '', source: 'environment' });
    expect(result.changes).toContainEqual({ key: 'GATEWAY_MEMBER_RPM', before: '180', after: null, beforeEffectiveValue: 180, afterEffectiveValue: 130 });
    expect(result.message).toContain('当前计数窗口到期后采用新窗口');
  });

  it('allows zero for the conservative budget but keeps RPM positive', async () => {
    const f = fixture({}, { GATEWAY_ENTERPRISE_TOKEN_BUDGET: '10000' });
    const service = await f.writable();
    const result = await service.update(update({ GATEWAY_ENTERPRISE_TOKEN_BUDGET: '0' }), 'admin');
    expect(result.effectivePolicy.GATEWAY_ENTERPRISE_TOKEN_BUDGET).toBe(0);
    await expect(service.update(update({ GATEWAY_MEMBER_RPM: '0' }, 1), 'admin')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('saves upstream-managed output settings over existing finite overrides', async () => {
    const keys = ['GATEWAY_DEFAULT_MAX_TOKENS', 'WEB_DEFAULT_MAX_OUTPUT_TOKENS', 'PLANNER_MAX_OUTPUT_TOKENS', 'MODEL_MAX_OUTPUT_TOKENS'];
    const f = fixture({}, Object.fromEntries(keys.map(key => [key, '4096'])));
    const service = await f.writable();
    const result = await service.update(update(Object.fromEntries(keys.map(key => [key, '0']))), 'admin');
    for (const key of keys) {
      expect(result.effectivePolicy![key]).toBe(0);
      expect(f.state.get(key)).toBe('0');
    }
    expect(f.logs).toHaveLength(1);
  });

  it.each([
    { GATEWAY_STREAM_TOTAL_TIMEOUT_MS: '1000' },
    { WEB_MODEL_TOTAL_TIMEOUT_MS: '1000' },
    { GATEWAY_ENTERPRISE_RPM: '100' },
    { GATEWAY_ENTERPRISE_CONCURRENCY: '1' },
    { MODEL_MAX_OUTPUT_TOKENS: '1000', WEB_DEFAULT_MAX_OUTPUT_TOKENS: '2000' },
  ])('rolls back revision initialization and the whole batch on cross-field errors %p', async (updates) => {
    const f = fixture();
    const service = await f.writable();
    await expect(service.update(update(updates), 'admin')).rejects.toBeInstanceOf(BadRequestException);
    expect(f.state.size).toBe(0);
    expect(f.logs).toHaveLength(0);
    expect(f.transactions[0].systemSetting.upsert).not.toHaveBeenCalled();
  });

  it.each(['audit', 'storage'])('rolls back all fields and revision when %s write fails', async (failure) => {
    const f = fixture({}, { GATEWAY_MEMBER_RPM: '130', MODEL_RUNTIME_POLICY_REVISION: '4' });
    const service = await f.writable();
    f.controls.failAudit = failure === 'audit';
    f.controls.failUpsertKey = failure === 'storage' ? 'GATEWAY_ENTERPRISE_RPM' : '';
    await expect(service.update(update({ GATEWAY_MEMBER_RPM: '180', GATEWAY_ENTERPRISE_RPM: '700' }, 4), 'admin')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(f.state.get(MODEL_RUNTIME_POLICY_REVISION)).toBe('4');
    expect(f.state.get('GATEWAY_MEMBER_RPM')).toBe('130');
    expect(f.state.has('GATEWAY_ENTERPRISE_RPM')).toBe(false);
    expect(f.logs).toHaveLength(0);
  });

  it('returns 409 with both versions for stale saves without partial updates', async () => {
    const f = fixture({}, { MODEL_RUNTIME_POLICY_REVISION: '3' });
    const service = await f.writable();
    try {
      await service.update(update({ GATEWAY_MEMBER_RPM: '150' }, 2), 'admin');
      throw new Error('expected conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({ code: 'MODEL_RUNTIME_POLICY_VERSION_CONFLICT', expectedVersion: 2, currentVersion: 3 });
    }
    expect(f.state.get(MODEL_RUNTIME_POLICY_REVISION)).toBe('3');
    expect(f.state.has('GATEWAY_MEMBER_RPM')).toBe(false);
    expect(f.logs).toHaveLength(0);
  });

  it('admits exactly one simultaneous first writer for the same expected version', async () => {
    const f = fixture();
    const service = await f.writable();
    const results = await Promise.allSettled([
      service.update(update({ GATEWAY_MEMBER_RPM: '150' }), 'admin-a'),
      service.update(update({ GATEWAY_MEMBER_RPM: '180' }), 'admin-b'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect(f.state.get(MODEL_RUNTIME_POLICY_REVISION)).toBe('1');
    expect(f.logs).toHaveLength(1);
  });

  it('filters unrelated audit actions and validates cursor pagination', async () => {
    const f = fixture();
    const service = await f.writable();
    await service.update(update({ GATEWAY_MEMBER_RPM: '150' }), 'admin');
    await service.update(update({ GATEWAY_MEMBER_RPM: '160' }, 1), 'admin');
    f.logs.push({ id: 'unrelated', actorId: 'admin', action: 'SECRET_UPDATED', resourceType: 'SETTING', result: 'SUCCESS', createdAt: new Date(), metadata: { secret: 'private' } });
    const first = await service.history({ limit: 1 });
    expect(first.items.map((item) => item.id)).toEqual(['history-2']);
    expect(first.nextCursor).toBe('history-2');
    const next = await service.history({ cursor: first.nextCursor, limit: 1 });
    expect(next.items.map((item) => item.id)).toEqual(['history-1']);
    expect(next.nextCursor).toBeNull();
    await expect(service.history({ cursor: 'unrelated', limit: 20 })).rejects.toBeInstanceOf(NotFoundException);
    expect(JSON.stringify(first)).not.toContain('private');
  });

  it('sanitizes even extra sensitive properties injected into policy audit metadata', async () => {
    const f = fixture();
    const service = await f.writable();
    await service.update(update({ GATEWAY_MEMBER_RPM: '150' }), 'admin');
    f.logs[0].metadata.SUB2API_API_KEY = 'private';
    f.logs[0].metadata.before.overrides.SUB2API_API_KEY = 'private';
    f.logs[0].metadata.before.effectivePolicy.SUB2API_API_KEY = 42;
    const result = await service.history({ limit: 20 });
    expect(JSON.stringify(result)).not.toMatch(/private|SUB2API_API_KEY/);
    expect(result.items[0].reason).toBe('capacity verification');
  });

  it('restores before/after coverage under current environment with monotonic new versions', async () => {
    const f = fixture({ GATEWAY_MEMBER_RPM: '130' });
    const original = await f.writable();
    await original.update(update({ GATEWAY_MEMBER_RPM: '180' }), 'admin');
    const current = new ModelRuntimePolicyService(f.prisma, { get: (key: string) => ({ GATEWAY_MEMBER_RPM: '140' } as any)[key] } as any);
    const fingerprint = (await current.getForAdmin()).preflight.environmentFingerprint;
    const service = new ModelRuntimePolicyService(f.prisma, { get: (key: string) => ({
      GATEWAY_MEMBER_RPM: '140', MODEL_RUNTIME_POLICY_WRITE_ENABLED: 'true', MODEL_RUNTIME_POLICY_ENV_FINGERPRINT: fingerprint,
    } as any)[key] } as any);
    const before = await service.restore({ expectedVersion: 1, historyId: 'history-1', side: 'before', reason: 'restore defaults' }, 'admin-2');
    expect(before.version).toBe(2);
    expect(before.effectivePolicy.GATEWAY_MEMBER_RPM).toBe(140);
    expect(f.state.has('GATEWAY_MEMBER_RPM')).toBe(false);
    expect(before.warnings.join(' ')).toContain('不保证复现历史环境');
    expect(f.logs[1].metadata.restoredFrom).toEqual({ historyId: 'history-1', side: 'before' });
    const after = await service.restore({ expectedVersion: 2, historyId: 'history-1', side: 'after', reason: 'restore override' }, 'admin-3');
    expect(after.version).toBe(3);
    expect(after.effectivePolicy.GATEWAY_MEMBER_RPM).toBe(180);
  });

  it('refuses historical overrides outside current hard bounds, without changing data or version', async () => {
    const f = fixture();
    const service = await f.writable();
    await service.update(update({ GATEWAY_MEMBER_RPM: '180' }), 'admin');
    f.logs[0].metadata.after.overrides.GATEWAY_MEMBER_RPM = '20000';
    f.logs[0].metadata.after.effectivePolicy.GATEWAY_MEMBER_RPM = 20000;
    expect((await service.history({ limit: 20 })).items[0].after.effectivePolicy.GATEWAY_MEMBER_RPM).toBe(20000);
    await expect(service.restore({ expectedVersion: 1, historyId: 'history-1', side: 'after', reason: 'restore old limit' }, 'admin')).rejects.toBeInstanceOf(BadRequestException);
    expect(f.state.get(MODEL_RUNTIME_POLICY_REVISION)).toBe('1');
    expect(f.state.get('GATEWAY_MEMBER_RPM')).toBe('180');
    expect(f.logs).toHaveLength(1);
  });

  it('refuses damaged or non-policy audit history for restore', async () => {
    const f = fixture();
    const service = await f.writable();
    await expect(service.restore({ expectedVersion: 0, historyId: 'unknown', side: 'before', reason: 'restore' }, 'admin')).rejects.toBeInstanceOf(NotFoundException);
    await service.update(update({ GATEWAY_MEMBER_RPM: '180' }), 'admin');
    delete f.logs[0].metadata.before.overrides.GATEWAY_MEMBER_RPM;
    await expect(service.restore({ expectedVersion: 1, historyId: 'history-1', side: 'before', reason: 'restore' }, 'admin')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(f.state.get(MODEL_RUNTIME_POLICY_REVISION)).toBe('1');
  });
});
