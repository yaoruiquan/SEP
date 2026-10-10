import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { ClientTaskMirrorQueryDto } from 'shared';
import { buildClientTaskActivityQuery } from './client-task-activity-query';

const build = (query: ClientTaskMirrorQueryDto = {}, overrides = {}) => buildClientTaskActivityQuery({
  enterpriseId: 'enterprise-1', userId: 'user-1', query, skip: 0, take: 100, ...overrides,
});
const text = (sql: Prisma.Sql) => sql.text.replace(/\s+/g, ' ').trim();
const businessTypes = ['user_input', 'model_output', 'step', 'activity', 'node_started', 'node_finished', 'tool_call', 'tool_result'];
const excludedTypes = ['heartbeat', 'status', 'participation_status', 'monitor_state', 'content_coverage', 'repair_marker', 'metadata', 'unknown'];

describe('buildClientTaskActivityQuery parameters and SQL', () => {
  it('binds every external value, including patterns, filters and pagination', () => {
    const injection = "x'); DROP TABLE client_task_mirrors; --";
    const sql = build({ scopeSubscriptionId: injection, subscriptionId: 'sub-selected',
      taskType: injection, q: injection, statuses: ['INTERRUPTED'], view: 'attention',
      from: '2026-10-01', to: '2026-10-10' }, { enterpriseId: injection, userId: injection, skip: 200, take: 20 });
    expect(sql.text).not.toContain(injection);
    expect(sql.values).toEqual(expect.arrayContaining([
      injection, `%${injection}%`, 'sub-selected', 'INTERRUPTED',
      new Date('2026-09-30T16:00:00Z'), new Date('2026-10-09T16:00:00Z'),
    ]));
    expect(sql.values.slice(-2)).toEqual([20, 200]);
    expect(text(sql)).toMatch(/ORDER BY "activityAt" DESC NULLS LAST, id DESC LIMIT \$\d+ OFFSET \$\d+$/);
  });

  it('uses the resolved owner and handles a null enterprise explicitly', () => {
    const sql = build({ scope: 'enterprise', userId: 'untrusted-owner' }, { enterpriseId: null });
    expect(sql.text).toContain('m."enterpriseId" IS NULL');
    expect(sql.values).toContain('user-1');
    expect(sql.values).not.toContain('untrusted-owner');
    expect(build({}, { userId: undefined }).text).not.toContain('m."userId" =');
  });

  it('keeps fixed and selected subscriptions as separate AND conditions, deduplicating equal IDs', () => {
    const sql = build({ scopeSubscriptionId: 'fixed', subscriptionId: 'selected' });
    expect(text(sql)).toMatch(/WHERE p\."mirrorId" = m\.id AND p\."subscriptionId" = \$\d+\) OR \(m\."protocolVersion" = 1 AND m\."subscriptionId" = \$\d+\) \) AND \( EXISTS/);
    expect(sql.values).toEqual(expect.arrayContaining(['fixed', 'selected']));
    const same = build({ scopeSubscriptionId: 'fixed', subscriptionId: 'fixed' });
    expect((same.text.split('), activity AS (')[0].match(/OR \(m\."protocolVersion" = 1 AND m\."subscriptionId"/g) ?? []).length).toBe(1);
  });

  it('intersects view and explicit statuses and includes INTERRUPTED in attention', () => {
    const sql = build({ view: 'attention', statuses: ['COMPLETED'] });
    expect(text(sql)).toMatch(/m\.status IN \([^)]*\) AND m\.status IN/);
    expect(sql.values).toEqual(expect.arrayContaining(['WAITING_APPROVAL', 'PAUSED', 'INTERRUPTED', 'FAILED', 'COMPLETED']));
    expect(build({ view: 'history' }).text).not.toContain('m.status IN');
    expect(build({ statuses: [] }).text).toContain('AND FALSE');
  });

  it('keeps explicit offset dates and supports one-sided execution ranges', () => {
    const from = '2026-10-09T06:30:00-04:00';
    expect(build({ from }).values).toContainEqual(new Date(from));
    expect(build({ from }).text).not.toMatch(/ < \$/);
    expect(build({ to: '2026-10-10' }).text).not.toMatch(/ >= \$/);
  });

  it('aggregates only allowlisted occurredAt without reading content, JSON or sync times', () => {
    const sql = build({ sort: 'activityAt_desc' });
    expect(sql.values).toEqual(expect.arrayContaining(businessTypes));
    for (const type of excludedTypes) expect(sql.values).not.toContain(type);
    expect(sql.text).toContain('MAX(e."occurredAt")');
    expect(sql.text).not.toMatch(/message|participationMetadata|updatedAt|lastHeartbeatAt|SELECT\s+\*/i);
    expect(sql.text).not.toContain('e."createdAt"');
    expect(sql.text).not.toContain('e."clientRunId" = m."clientRunId"');
    expect(text(sql)).toContain('COALESCE("eventAt", "startedAt", "queuedAt", "receivedAt")');
  });
});

/**
 * Opt-in real PostgreSQL verification:
 * CLIENT_TASK_ACTIVITY_POSTGRES_TEST=1 pnpm --dir backend exec jest --runInBand client-task-activity-query
 * Always creates its own disposable container and loopback-only random port. Never
 * reads DATABASE_URL, .env, existing containers, project data or real credentials.
 */
const postgres = process.env.CLIENT_TASK_ACTIVITY_POSTGRES_TEST === '1' ? describe : describe.skip;
if (process.env.CLIENT_TASK_ACTIVITY_POSTGRES_TEST === '1') jest.setTimeout(30_000);
type ActivityRow = { id: string; activityAt: Date; activityTimeSource: 'event' | 'started' | 'queued' | 'received' };
const at = (day: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T00:00:00Z`);
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', timeout: 20_000 }).trim();

postgres('buildClientTaskActivityQuery isolated PostgreSQL', () => {
  const container = `sep-activity-query-test-${randomUUID()}`;
  let db: PrismaClient;

  beforeAll(async () => {
    docker('run', '--detach', '--rm', '--pull=never', '--name', container,
      '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
      '--env', 'POSTGRES_PASSWORD=isolated-test-only', '--env', 'POSTGRES_DB=activity_test', 'postgres:16-alpine');
    const port = docker('port', container, '5432/tcp');
    if (!/^127\.0\.0\.1:\d+$/.test(port)) throw new Error('Expected an isolated loopback PostgreSQL port');
    db = new PrismaClient({ datasourceUrl: `postgresql://postgres:isolated-test-only@${port}/activity_test?schema=public` });
    for (let attempt = 0; ; attempt++) {
      try { await db.$connect(); break; }
      catch (error) {
        if (attempt >= 50) throw error;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    // Only columns referenced by this query / service eligibility are needed.
    for (const ddl of [
      `CREATE TABLE client_task_mirrors (
        id TEXT PRIMARY KEY, "enterpriseId" TEXT, "userId" TEXT NOT NULL,
        "subscriptionId" TEXT NOT NULL, "protocolVersion" INTEGER NOT NULL,
        title TEXT NOT NULL, "taskType" TEXT NOT NULL, status TEXT NOT NULL,
        "startedAt" TIMESTAMP(3), "queuedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL,
        "updatedAt" TIMESTAMP(3) NOT NULL, "lastHeartbeatAt" TIMESTAMP(3))`,
      `CREATE TABLE client_task_mirror_runs (
        id TEXT PRIMARY KEY, "mirrorId" TEXT NOT NULL REFERENCES client_task_mirrors(id),
        "clientRunId" TEXT NOT NULL, "protocolVersion" INTEGER NOT NULL, "subscriptionId" TEXT NOT NULL,
        "queuedAt" TIMESTAMP(3) NOT NULL, "startedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL)`,
      `CREATE TABLE client_task_participations (
        id TEXT PRIMARY KEY, "mirrorId" TEXT NOT NULL REFERENCES client_task_mirrors(id),
        "runId" TEXT NOT NULL REFERENCES client_task_mirror_runs(id), "clientRunId" TEXT NOT NULL,
        "subscriptionId" TEXT NOT NULL, "startedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL)`,
      `CREATE TABLE client_task_mirror_events (
        id TEXT PRIMARY KEY, "mirrorId" TEXT NOT NULL REFERENCES client_task_mirrors(id),
        "clientRunId" TEXT NOT NULL, "participationId" TEXT REFERENCES client_task_participations(id),
        type TEXT NOT NULL, "occurredAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL,
        message TEXT, "participationMetadata" JSONB)`,
    ]) await db.$executeRawUnsafe(ddl);
  }, 45_000);

  afterAll(async () => {
    try { await db?.$disconnect(); }
    finally { docker('rm', '--force', container); }
  }, 25_000);

  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE client_task_mirror_events, client_task_participations, client_task_mirror_runs, client_task_mirrors');
  });

  async function mirror(id: string, options: {
    enterpriseId?: string | null; userId?: string; subscriptionId?: string; protocolVersion?: number;
    title?: string; taskType?: string; status?: string; startedAt?: Date | null; queuedAt?: Date | null; createdAt?: Date;
  } = {}) {
    await db.$executeRaw`INSERT INTO client_task_mirrors
      (id, "enterpriseId", "userId", "subscriptionId", "protocolVersion", title, "taskType", status,
        "startedAt", "queuedAt", "createdAt", "updatedAt", "lastHeartbeatAt")
      VALUES (${id}, ${options.enterpriseId === undefined ? 'enterprise-1' : options.enterpriseId},
        ${options.userId ?? 'user-1'}, ${options.subscriptionId ?? 'root'}, ${options.protocolVersion ?? 2},
        ${options.title ?? 'Task'}, ${options.taskType ?? 'conversation'}, ${options.status ?? 'QUEUED'},
        ${options.startedAt ?? null}, ${options.queuedAt ?? null}, ${options.createdAt ?? at(1)}, ${at(30)}, ${at(30)})`;
  }

  async function run(mirrorId: string, clientRunId: string, options: {
    subscriptionId?: string; protocolVersion?: number; queuedAt?: Date; startedAt?: Date | null;
  } = {}) {
    const id = `${mirrorId}/${clientRunId}`;
    await db.$executeRaw`INSERT INTO client_task_mirror_runs
      (id, "mirrorId", "clientRunId", "protocolVersion", "subscriptionId", "queuedAt", "startedAt", "createdAt")
      VALUES (${id}, ${mirrorId}, ${clientRunId}, ${options.protocolVersion ?? 2}, ${options.subscriptionId ?? 'root'},
        ${options.queuedAt ?? at(2)}, ${options.startedAt ?? null}, ${at(20)})`;
    return id;
  }

  async function participant(mirrorId: string, clientRunId: string, subscriptionId: string, startedAt: Date | null = null) {
    const id = `${mirrorId}/${clientRunId}/${subscriptionId}`;
    await db.$executeRaw`INSERT INTO client_task_participations
      (id, "mirrorId", "clientRunId", "runId", "subscriptionId", "startedAt", "createdAt")
      VALUES (${id}, ${mirrorId}, ${clientRunId}, ${`${mirrorId}/${clientRunId}`}, ${subscriptionId}, ${startedAt}, ${at(20)})`;
    return id;
  }

  async function event(mirrorId: string, clientRunId: string, type: string, occurredAt: Date | null, participationId: string | null = null) {
    await db.$executeRaw`INSERT INTO client_task_mirror_events
      (id, "mirrorId", "clientRunId", type, "occurredAt", "participationId", "createdAt", message, "participationMetadata")
      VALUES (${randomUUID()}, ${mirrorId}, ${clientRunId}, ${type}, ${occurredAt}, ${participationId}, ${at(30)},
        ${'model_output user_input step activity'}, ${'{"type":"model_output","occurredAt":"2099-01-01"}'}::jsonb)`;
  }

  const read = (query: ClientTaskMirrorQueryDto = {}, overrides = {}) => db.$queryRaw<ActivityRow[]>(build(query, overrides));
  const ids = async (query: ClientTaskMirrorQueryDto = {}, overrides = {}) => (await read(query, overrides)).map(row => row.id);

  it('sorts the entire eligible set before pagination, breaking equal times by id descending', async () => {
    for (const id of ['a', 'b', 'c', 'd']) {
      await mirror(id);
      await event(id, 'old-run', 'model_output', id === 'a' ? at(9) : at(8));
    }
    expect(await ids()).toEqual(['a', 'd', 'c', 'b']);
    expect(await ids({}, { skip: 1, take: 2 })).toEqual(['d', 'c']);
    expect(await ids({}, { skip: 3, take: 2 })).toEqual(['b']);
    expect(await ids({}, { skip: 9, take: 2 })).toEqual([]);
    expect(await ids({}, { skip: 214748364700, take: 2 })).toEqual([]);
    expect(await ids({}, { take: 0 })).toEqual([]);
  });

  it('returns Date values and honors source precedence rather than greatest timestamp across sources', async () => {
    await mirror('event', { startedAt: at(9), queuedAt: at(10) });
    await event('event', 'historical-run', 'model_output', at(3));
    await mirror('started', { startedAt: at(4), queuedAt: at(11) });
    await mirror('queued', { queuedAt: at(5) });
    await mirror('received', { createdAt: at(2) });
    const rows = await read();
    expect(rows).toEqual([
      { id: 'queued', activityAt: at(5), activityTimeSource: 'queued' },
      { id: 'started', activityAt: at(4), activityTimeSource: 'started' },
      { id: 'event', activityAt: at(3), activityTimeSource: 'event' },
      { id: 'received', activityAt: at(2), activityTimeSource: 'received' },
    ]);
    expect(rows.every(row => row.activityAt instanceof Date)).toBe(true);
  });

  it('places all-null activity last and preserves id descending even for null ties', async () => {
    // Production createdAt is required. Temporarily permit malformed legacy rows
    // only inside this disposable test database to exercise NULLS LAST directly.
    await db.$executeRawUnsafe('ALTER TABLE client_task_mirrors ALTER COLUMN "createdAt" DROP NOT NULL');
    try {
      for (const id of ['a-null', 'z-null', 'dated']) {
        await mirror(id, { protocolVersion: 1, subscriptionId: 'a' });
      }
      await db.$executeRaw`UPDATE client_task_mirrors SET "createdAt" = NULL WHERE id IN (${'a-null'}, ${'z-null'})`;
      expect(await ids({ scopeSubscriptionId: 'a' })).toEqual(['dated', 'z-null', 'a-null']);
      expect(await ids({ scopeSubscriptionId: 'a' }, { skip: 1, take: 1 })).toEqual(['z-null']);
    } finally {
      await db.$executeRaw`UPDATE client_task_mirrors SET "createdAt" = ${at(1)} WHERE "createdAt" IS NULL`;
      await db.$executeRawUnsafe('ALTER TABLE client_task_mirrors ALTER COLUMN "createdAt" SET NOT NULL');
    }
  });

  it.each(businessTypes)('counts %s but ignores event receipts, unknown types and metadata content', async type => {
    await mirror('task', { startedAt: at(2) });
    await event('task', 'old', type, at(6));
    await event('task', 'current', 'model_output', null);
    for (const ignored of excludedTypes) await event('task', 'current', ignored, at(29));
    expect(await read()).toEqual([{ id: 'task', activityAt: at(6), activityTimeSource: 'event' }]);
  });

  it('falls back when business events have no occurredAt, without using receipt or heartbeat times', async () => {
    await mirror('task', { startedAt: at(2) });
    await event('task', 'current', 'model_output', null);
    await event('task', 'current', 'monitor_state', at(29));
    expect(await read()).toEqual([{ id: 'task', activityAt: at(2), activityTimeSource: 'started' }]);
  });

  it('restricts fixed-scope activity to its participation, across all historical runs', async () => {
    await mirror('task', { startedAt: at(28), queuedAt: at(28) });
    await run('task', 'old');
    await run('task', 'new');
    const oldA = await participant('task', 'old', 'a', at(3));
    const newA = await participant('task', 'new', 'a', at(4));
    const b = await participant('task', 'new', 'b', at(27));
    await event('task', 'old', 'model_output', at(10), oldA);
    await event('task', 'new', 'model_output', at(5), newA);
    await event('task', 'new', 'model_output', at(26), b);
    await event('task', 'new', 'model_output', at(29)); // Unattributed v2 root.
    await event('task', 'different-run', 'model_output', at(30), newA); // Mismatched participation/run.
    expect(await read({ scopeSubscriptionId: 'a', subscriptionId: 'b' }))
      .toEqual([{ id: 'task', activityAt: at(10), activityTimeSource: 'event' }]);
    expect((await read({ subscriptionId: 'b' }))[0].activityAt).toEqual(at(26));
  });

  it('uses only scoped participant started/queue fallbacks, not another employee or root times', async () => {
    await mirror('started', { startedAt: at(29), queuedAt: at(29) });
    await run('started', 'old', { queuedAt: at(2), startedAt: at(28) });
    await run('started', 'new', { queuedAt: at(3) });
    await participant('started', 'old', 'a', at(4));
    await participant('started', 'new', 'a', at(5));
    await participant('started', 'new', 'b', at(27));
    await mirror('queued', { startedAt: at(29), queuedAt: at(29) });
    await run('queued', 'run', { queuedAt: at(6), startedAt: at(28) });
    await participant('queued', 'run', 'a');
    expect(await read({ scopeSubscriptionId: 'a' })).toEqual([
      { id: 'queued', activityAt: at(6), activityTimeSource: 'queued' },
      { id: 'started', activityAt: at(5), activityTimeSource: 'started' },
    ]);
  });

  it('supports v1 root events without runs and historical proven v1 runs after upgrading to v2', async () => {
    await mirror('legacy', { protocolVersion: 1, subscriptionId: 'a' });
    await event('legacy', 'unregistered-old', 'user_input', at(6));
    await mirror('upgraded');
    await run('upgraded', 'old', { protocolVersion: 1, subscriptionId: 'a' });
    await run('upgraded', 'new');
    await participant('upgraded', 'new', 'a', at(3));
    await event('upgraded', 'old', 'model_output', at(7));
    await event('upgraded', 'new', 'model_output', at(29));
    expect(await read({ subscriptionId: 'a' })).toEqual([
      { id: 'upgraded', activityAt: at(7), activityTimeSource: 'event' },
      { id: 'legacy', activityAt: at(6), activityTimeSource: 'event' },
    ]);
  });

  it('does not attribute known v2 roots or other employees/foreign participations to a v1 scope', async () => {
    await mirror('legacy', { protocolVersion: 1, subscriptionId: 'a', startedAt: at(2) });
    await run('legacy', 'v2', { subscriptionId: 'b' });
    const other = await participant('legacy', 'v2', 'b', at(3));
    await event('legacy', 'v2', 'model_output', at(29));
    await event('legacy', 'v2', 'model_output', at(28), other);
    await mirror('foreign');
    await run('foreign', 'v2');
    const foreign = await participant('foreign', 'v2', 'a');
    await event('legacy', 'v2', 'model_output', at(27), foreign);
    expect(await read({ subscriptionId: 'a' })).toEqual([
      { id: 'legacy', activityAt: at(2), activityTimeSource: 'started' },
      { id: 'foreign', activityAt: at(2), activityTimeSource: 'queued' },
    ]);
  });

  it('requires fixed and selected subscription eligibility independently and preserves status intersection', async () => {
    for (const id of ['both', 'only-a', 'only-b', 'v2-root-only']) {
      await mirror(id, { subscriptionId: 'a', status: 'INTERRUPTED' });
      await run(id, 'run');
    }
    await participant('both', 'run', 'a');
    await participant('both', 'run', 'b');
    await participant('only-a', 'run', 'a');
    await participant('only-b', 'run', 'b');
    await mirror('legacy-a', { protocolVersion: 1, subscriptionId: 'a', status: 'INTERRUPTED' });
    expect(await ids({ scopeSubscriptionId: 'a', subscriptionId: 'b' })).toEqual(['both']);
    expect(await ids({ subscriptionId: 'a' })).not.toContain('v2-root-only');
    expect(await ids({ scopeSubscriptionId: 'a', subscriptionId: 'b', view: 'attention', statuses: ['INTERRUPTED'] })).toEqual(['both']);
    expect(await ids({ scopeSubscriptionId: 'a', subscriptionId: 'b', view: 'active', statuses: ['INTERRUPTED'] })).toEqual([]);
    expect(await ids({ view: 'attention', statuses: ['COMPLETED'] })).toEqual([]);
  });

  it('binds dates to the selected employee, uses start before queue, and never clips activity to the date window', async () => {
    const from = '2026-10-05', to = '2026-10-06'; // UTC: Oct 4 16:00 <= time < Oct 5 16:00.
    for (const id of ['match', 'wrong-employee', 'start-outside', 'lower-bound', 'upper-bound']) {
      await mirror(id);
      await run(id, 'run', { queuedAt: at(5) });
      await participant(id, 'run', 'a', at(5));
    }
    const match = await participant('match', 'run', 'b'); // Falls back to run queue.
    await participant('wrong-employee', 'run', 'b', at(7));
    await participant('start-outside', 'run', 'b', at(7));
    await participant('lower-bound', 'run', 'b', new Date('2026-10-04T16:00:00Z'));
    await participant('upper-bound', 'run', 'b', new Date('2026-10-05T16:00:00Z'));
    await event('match', 'run', 'model_output', at(20), match);
    expect(await ids({ scopeSubscriptionId: 'a', subscriptionId: 'b', from, to })).toEqual(['match', 'lower-bound']);
    expect((await read({ subscriptionId: 'b', from, to }))[0].activityAt).toEqual(at(20));
  });

  it('supports unscoped run queues and v1 start/queue/receipt date fallbacks only', async () => {
    await mirror('run-only');
    await run('run-only', 'run', { queuedAt: at(5), startedAt: at(20) });
    await mirror('v2-receipt', { createdAt: at(5) });
    await mirror('v1-receipt', { protocolVersion: 1, createdAt: at(5) });
    await mirror('v1-queue', { protocolVersion: 1, queuedAt: at(5), createdAt: at(20) });
    await mirror('v1-start', { protocolVersion: 1, startedAt: at(5), queuedAt: at(20) });
    await mirror('v1-start-outside', { protocolVersion: 1, startedAt: at(20), queuedAt: at(5), createdAt: at(5) });
    expect(new Set(await ids({ from: '2026-10-05', to: '2026-10-06' })))
      .toEqual(new Set(['run-only', 'v1-receipt', 'v1-queue', 'v1-start']));
    expect(await ids({ subscriptionId: 'root', from: '2026-10-05', to: '2026-10-06' }))
      .not.toContain('run-only');
  });

  it('matches the actual service taskMirrorReadWhere on PostgreSQL across permission and filter combinations', async () => {
    // Invoke the actual eligibility builder without constructing services or any DB context.
    const { ClientService } = await import('./client.service');
    for (let index = 0; index < 20; index++) {
      const id = `task-${String(index).padStart(2, '0')}`;
      await mirror(id, {
        enterpriseId: index % 5 === 0 ? null : index % 5 === 1 ? 'other-enterprise' : 'enterprise-1',
        userId: index % 2 ? 'user-1' : 'user-2', protocolVersion: index % 3 ? 2 : 1,
        subscriptionId: index % 2 ? 'a' : 'b', title: index % 2 ? 'HELLO 100%' : 'Other',
        taskType: index % 2 ? 'conversation' : 'workflow',
        status: ['QUEUED', 'RUNNING', 'PAUSED', 'INTERRUPTED', 'FAILED', 'COMPLETED'][index % 6],
        startedAt: index % 4 ? at(5) : null, queuedAt: index % 4 ? null : at(3),
      });
      if (index % 3) {
        await run(id, 'run', { queuedAt: index % 2 ? at(5) : at(3) });
        await participant(id, 'run', 'a', index % 2 ? at(5) : null);
        if (index % 4) await participant(id, 'run', 'b', at(8));
      }
    }
    const queries: ClientTaskMirrorQueryDto[] = [
      {}, { scope: 'mine' }, { scope: 'enterprise' }, { userId: 'user-2' },
      { q: 'hello' }, { q: '%' }, { q: "x'; SELECT 1; --" }, { taskType: 'workflow' },
      { view: 'active' }, { view: 'attention' }, { view: 'history', statuses: ['COMPLETED'] },
      { view: 'active', statuses: ['INTERRUPTED'] }, { statuses: ['FAILED', 'INTERRUPTED'] },
      { subscriptionId: 'a' }, { scopeSubscriptionId: 'a' },
      { scopeSubscriptionId: 'a', subscriptionId: 'b' }, { scopeSubscriptionId: 'a', subscriptionId: 'a' },
      { from: '2026-10-05', to: '2026-10-06' }, { from: '2026-10-05' }, { to: '2026-10-06' },
      { subscriptionId: 'a', from: '2026-10-05', to: '2026-10-06' },
      { scopeSubscriptionId: 'a', from: '2026-10-05', to: '2026-10-06' },
      { scopeSubscriptionId: 'a', subscriptionId: 'b', from: '2026-10-05', to: '2026-10-06' },
      { q: 'hello', taskType: 'conversation', view: 'attention', statuses: ['INTERRUPTED'], subscriptionId: 'a' },
    ];
    for (const enterpriseId of ['enterprise-1', null]) {
      const service = Object.create(ClientService.prototype);
      service.enterpriseContext = { resolve: async () => ({ enterpriseId, role: 'ENTERPRISE_ADMIN' }) };
      for (const query of queries) {
        const where = await service.taskMirrorReadWhere('user-1', query);
        const expected = await db.clientTaskMirror.findMany({ where, select: { id: true } });
        const userId = query.scope === 'mine' ? 'user-1' : query.userId;
        expect({ enterpriseId, query, ids: new Set(await ids(query, { enterpriseId, userId })) })
          .toEqual({ enterpriseId, query, ids: new Set(expected.map(row => row.id)) });
      }
      service.enterpriseContext = { resolve: async () => ({ enterpriseId, role: 'MEMBER' }) };
      for (const query of [{}, { scope: 'mine' }, { subscriptionId: 'a' },
        { view: 'attention' }, { from: '2026-10-05', to: '2026-10-06' }] as ClientTaskMirrorQueryDto[]) {
        const where = await service.taskMirrorReadWhere('user-1', query);
        const expected = await db.clientTaskMirror.findMany({ where, select: { id: true } });
        expect(new Set(await ids(query, { enterpriseId, userId: 'user-1' })))
          .toEqual(new Set(expected.map(row => row.id)));
      }
    }
  }, 120_000);
});
