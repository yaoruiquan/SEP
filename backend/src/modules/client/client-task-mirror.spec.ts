import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';
import { THROTTLER_SKIP, THROTTLER_LIMIT } from '@nestjs/throttler/dist/throttler.constants';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClientService } from './client.service';
import { ClientController } from './client.controller';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  ClientTaskEventDtoSchema,
  CreateClientTaskMirrorDtoSchema,
  ClientTaskHeartbeatDtoSchema,
  ClientTaskMirrorQueryDtoSchema,
  UpdateClientTaskMirrorStatusDtoSchema,
} from 'shared';

const createdAt = new Date('2026-10-08T00:00:00Z');
const makeRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'mirror-1', userId: 'user-1', enterpriseId: 'ent-1', subscriptionId: 'sub-1',
  clientTaskId: 'task-1', clientRunId: 'run-1', title: 'Task', taskType: 'conversation',
  modelId: null, clientVersion: null, status: 'QUEUED', progress: 0, lastSequence: 0,
  currentStep: null, activity: null, errorSummary: null, lastHeartbeatAt: null,
  startedAt: null, completedAt: null, createdAt, updatedAt: createdAt,
  protocolVersion: 1, queuedAt: null,
  ...overrides,
});
const createBody = (overrides: Record<string, unknown> = {}) => ({
  clientTaskId: 'task-1', clientRunId: 'run-1', subscriptionId: 'sub-1', title: 'Task', ...overrides,
});

// Stateful mock only. No real database, credentials, network, or schema changes.
function fixture(role = 'MEMBER') {
  let rows: any[] = [];
  let events: any[] = [];
  let runs: any[] = [];
  let participations: any[] = [];
  const ctx = { enterpriseId: 'ent-1', memberId: 'member-1', departmentId: 'dept-1', role };
  const context = { resolve: jest.fn().mockResolvedValue(ctx) };
  const relation = (row: any, key: string) => key === 'user'
    ? { id: row.userId, name: row.userId === 'user-1' ? 'Alice' : null }
    : key === 'mirror' ? rows.find(item => item.id === row.mirrorId)
    : key === 'run' ? runs.find(item => item.id === row.runId)
    : key === 'runs' ? runs.filter(item => item.mirrorId === row.id)
    : key === 'participations' ? participations.filter(item => row.clientTaskId ? item.mirrorId === row.id : item.runId === row.id)
    : key === 'events' ? events.filter(item => row.executionId ? item.participationId === row.id : item.mirrorId === row.id)
    : row[key];
  const matches = (row: any, where: any): boolean => !!row && Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every(item => matches(row, item));
    if (key === 'OR') return value.some((item: any) => matches(row, item));
    if (key.includes('_')) return matches(row, value);
    const actual = relation(row, key);
    if (value === null || typeof value !== 'object' || value instanceof Date) return +actual === +value && actual instanceof Date || actual === value;
    if ('some' in value) return actual.some((item: any) => matches(item, value.some));
    if ('in' in value) return value.in.includes(actual);
    if ('contains' in value) return value.mode === 'insensitive'
      ? actual.toLowerCase().includes(value.contains.toLowerCase()) : actual.includes(value.contains);
    if ('gte' in value || 'lt' in value) return actual != null && (!value.gte || actual >= value.gte) && (!value.lt || actual < value.lt);
    return matches(actual, value);
  });
  const findMany = (data: any[], args: any = {}): any[] => {
    const order = Array.isArray(args.orderBy) ? args.orderBy : args.orderBy ? [args.orderBy] : [];
    let result = data.filter(row => matches(row, args.where)).sort((a, b) => {
      for (const spec of order) {
        const [key, rule] = Object.entries(spec)[0] as [string, any];
        const direction = typeof rule === 'string' ? rule : rule.sort;
        if (a[key] == null && b[key] != null) return 1;
        if (b[key] == null && a[key] != null) return -1;
        const cmp = a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0;
        if (cmp) return direction === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
    if (args.distinct) result = result.filter((row, i, all) => all.findIndex(other => args.distinct.every((key: string) => row[key] === other[key])) === i);
    return result.slice(args.skip ?? 0, args.take === undefined ? undefined : (args.skip ?? 0) + args.take)
      .map(row => project(row, args));
  };
  const project = (row: any, args: any = {}): any => {
    if (!row) return null;
    const output = args.select ? {} : { ...row };
    for (const [key, spec] of Object.entries(args.select ?? args.include ?? {}) as [string, any][]) {
      const value = relation(row, key);
      output[key] = spec === true ? value : Array.isArray(value) ? findMany(value, spec) : project(value, spec);
    }
    return output;
  };
  const update = (data: any[], { where, data: changes }: any) => {
    const row = data.find(row => matches(row, where));
    if (!row) throw new Error('Missing fixture row');
    Object.entries(changes).forEach(([key, value]) => { if (value !== undefined) row[key] = value; });
    return { ...row };
  };
  const prisma: any = {
    subscription: { findFirst: jest.fn(async ({ where }) => ({ id: where.id, name: `Subscription ${where.id}`,
      employeeId: `employee-${where.id}`, employee: { name: `Employee ${where.id}` } })) },
    clientTaskMirror: {
      findUnique: jest.fn(async args => project(rows.find(row => matches(row, args.where)), args)),
      findFirst: jest.fn(async args => project(rows.find(row => matches(row, args.where)), args)),
      findMany: jest.fn(async args => findMany(rows, args)),
      count: jest.fn(async ({ where }) => rows.filter(row => matches(row, where)).length),
      create: jest.fn(async ({ data }) => {
        const row = makeRow(data);
        rows.push(row);
        return { ...row };
      }),
      update: jest.fn(async args => update(rows, args)),
    },
    clientTaskMirrorRun: {
      findUnique: jest.fn(async args => project(runs.find(row => matches(row, args.where)), args)),
      findMany: jest.fn(async args => findMany(runs, args)),
      create: jest.fn(async ({ data }) => {
        const row = { id: `run-${runs.length}`, createdAt, updatedAt: createdAt, ...data };
        runs.push(row); return { ...row };
      }),
      update: jest.fn(async args => update(runs, args)),
    },
    clientTaskParticipation: {
      findUnique: jest.fn(async args => project(participations.find(row => matches(row, args.where)), args)),
      findMany: jest.fn(async args => findMany(participations, args)),
      create: jest.fn(async ({ data }) => {
        const row: any = { id: `participation-${participations.length}`, status: 'QUEUED', nodeId: null,
          title: null, modelId: null, createdAt, updatedAt: createdAt };
        Object.entries(data).forEach(([key, value]) => { if (value !== undefined) row[key] = value; });
        participations.push(row); return { ...row };
      }),
      update: jest.fn(async args => update(participations, args)),
    },
    clientTaskMirrorEvent: {
      create: jest.fn(async ({ data }) => { const row = { id: `event-${events.length}`, createdAt,
        ...data, participationId: data.participationId ?? null,
        participationMetadata: data.participationMetadata === Prisma.DbNull ? null : data.participationMetadata };
        events.push(row); return row; }),
      findUnique: jest.fn(async args => project(events.find(row => matches(row, args.where)), args)),
      findFirst: jest.fn(async args => findMany(events, args)[0] ?? null),
      findMany: jest.fn(async args => findMany(events, args)),
    },
  };
  prisma.$transaction = jest.fn(async (work: any) => {
    const originalRows = rows.map(row => ({ ...row }));
    const originalEvents = events.map(row => ({ ...row }));
    const originalRuns = runs.map(row => ({ ...row }));
    const originalParticipations = participations.map(row => ({ ...row }));
    try { return await work(prisma); } catch (error) {
      rows = originalRows;
      events = originalEvents;
      runs = originalRuns;
      participations = originalParticipations;
      throw error;
    }
  });
  const service = new ClientService(prisma, null!, null!, null!, context as any, null!, null!, null!, null!, null!);
  return { service, prisma, context, ctx, seed: (...data: any[]) => rows.push(...data),
    rows: () => rows, events: () => events, runs: () => runs, participations: () => participations };
}

describe('Client task mirror permissions and pagination', () => {
  it.each(['MEMBER', 'DEPT_MANAGER'])('%s lists only own tasks and cannot fetch peers', async role => {
    const f = fixture(role);
    f.seed(makeRow(), makeRow({ id: 'peer', userId: 'user-2' }), makeRow({ id: 'foreign', enterpriseId: 'ent-2' }));
    const result: any = await f.service.listTaskMirrors('user-1', { page: 1 });
    expect(result).toMatchObject({ total: 1, page: 1, limit: 50, hasNextPage: false });
    expect(result.items.map((row: any) => row.id)).toEqual(['mirror-1']);
    await expect(f.service.getTaskMirror('user-1', 'peer')).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.service.getTaskMirror('user-1', 'foreign')).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.service.listTaskMirrors('user-1', { scope: 'enterprise' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('admin default/enterprise includes peers but never another enterprise; mine restricts admin', async () => {
    const f = fixture('ENTERPRISE_ADMIN');
    f.seed(makeRow(), makeRow({ id: 'peer', userId: 'user-2' }), makeRow({ id: 'foreign', enterpriseId: 'ent-2' }));
    expect((await f.service.listTaskMirrors('user-1') as any[])).toHaveLength(2);
    const result: any = await f.service.listTaskMirrors('user-1', { page: 1, scope: 'enterprise' });
    expect(result.total).toBe(2);
    const mine: any = await f.service.listTaskMirrors('user-1', { page: 1, scope: 'mine' });
    expect(mine.items.map((row: any) => row.id)).toEqual(['mirror-1']);
    expect(await f.service.getTaskMirror('user-1', 'peer')).toMatchObject({ user: { id: 'user-2', name: null }, events: [] });
    await expect(f.service.getTaskMirror('user-1', 'foreign')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('legacy no-pagination and scope-only calls retain most recent 100 array; summary excludes secrets', async () => {
    const f = fixture();
    f.seed(...Array.from({ length: 105 }, (_, i) => makeRow({ id: `mirror-${String(i).padStart(3, '0')}` })));
    const result: any = await f.service.listTaskMirrors('user-1', { scope: 'mine' });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(100);
    expect(result[0].id).toBe('mirror-104');
    expect(result[0].user).toEqual({ id: 'user-1', name: 'Alice' });
    expect(f.prisma.clientTaskMirror.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ queuedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }], take: 100,
      include: expect.objectContaining({ user: { select: { id: true, name: true } } }),
    }));
  });

  it('page/limit returns exact envelope, total with matching permissions and accessible records past 100', async () => {
    const f = fixture();
    f.seed(...Array.from({ length: 105 }, (_, i) => makeRow({ id: `mirror-${String(i).padStart(3, '0')}` })), makeRow({ id: 'peer', userId: 'user-2' }));
    const first: any = await f.service.listTaskMirrors('user-1', { limit: 50 });
    expect(Object.keys(first).sort()).toEqual(['hasNextPage', 'items', 'limit', 'page', 'total']);
    expect(first).toMatchObject({ total: 105, page: 1, limit: 50, hasNextPage: true });
    const last: any = await f.service.listTaskMirrors('user-1', { page: 3, limit: 50 });
    expect(last).toMatchObject({ total: 105, page: 3, limit: 50, hasNextPage: false });
    expect(last.items).toHaveLength(5);
    const empty: any = await f.service.listTaskMirrors('user-1', { page: 2147483647, limit: 100 });
    expect(empty).toEqual({ items: [], total: 105, page: 2147483647, limit: 100, hasNextPage: false });
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('no enterprise retains existing forbidden boundary', async () => {
    const f = fixture();
    f.context.resolve.mockRejectedValue(new ForbiddenException('No enterprise'));
    await expect(f.service.listTaskMirrors('user-1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.getTaskMirror('user-1', 'mirror-1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.createTaskMirror('user-1', createBody())).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['status', 'heartbeat', 'events'])('admin cannot write peer/foreign mirrors via %s', async operation => {
    const f = fixture('ENTERPRISE_ADMIN');
    f.seed(makeRow({ id: 'peer', userId: 'user-2' }), makeRow({ id: 'foreign', enterpriseId: 'ent-2' }));
    const write = (id: string) => operation === 'status' ? f.service.updateTaskMirror('user-1', id, { status: 'RUNNING' })
      : operation === 'heartbeat' ? f.service.heartbeatTaskMirror('user-1', id, {})
      : f.service.eventTaskMirror('user-1', id, { sequence: 1, type: 'user_input' });
    for (const id of ['peer', 'foreign']) await expect(write(id)).rejects.toBeInstanceOf(NotFoundException);
    expect(f.prisma.clientTaskMirror.update).not.toHaveBeenCalled();
    expect(f.events()).toEqual([]);
  });
});

describe('Client task mirror create and run synchronization', () => {
  it('new create is authorized; same run replay after completed never resets state', async () => {
    const f = fixture();
    const first = await f.service.createTaskMirror('user-1', createBody());
    await f.service.updateTaskMirror('user-1', first.id, { clientRunId: 'run-1', status: 'COMPLETED', progress: 100 });
    const replay = await f.service.createTaskMirror('user-1', createBody());
    expect(replay).toMatchObject({ id: first.id, status: 'COMPLETED', progress: 100, completedAt: expect.any(Date) });
    expect(f.rows()).toHaveLength(1);
    expect(f.prisma.subscription.findFirst).toHaveBeenCalledTimes(2);
  });

  it('new run resets execution metadata, retains mirror id, history and task-level sequence', async () => {
    const f = fixture();
    f.seed(makeRow({ status: 'FAILED', progress: 80, currentStep: 'old', activity: 'old', errorSummary: 'error',
      startedAt: createdAt, completedAt: createdAt, lastHeartbeatAt: createdAt, lastSequence: 17 }));
    const result = await f.service.createTaskMirror('user-1', createBody({ clientRunId: 'run-2' }));
    expect(result).toMatchObject({ id: 'mirror-1', clientRunId: 'run-2', status: 'QUEUED', progress: 0,
      currentStep: null, activity: null, errorSummary: null, startedAt: null, completedAt: null,
      lastHeartbeatAt: null, lastSequence: 17 });
    expect(f.prisma.clientTaskMirrorEvent.create).not.toHaveBeenCalled();
  });

  it('subscription changes require fresh member/department grant and update the subscription reference', async () => {
    const f = fixture();
    f.seed(makeRow({ status: 'COMPLETED', progress: 100 }));
    f.prisma.subscription.findFirst.mockResolvedValueOnce(null);
    await expect(f.service.createTaskMirror('user-1', createBody({ subscriptionId: 'denied' }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.rows()[0].subscriptionId).toBe('sub-1');
    f.prisma.subscription.findFirst.mockResolvedValueOnce({ id: 'sub-2' });
    const result = await f.service.createTaskMirror('user-1', createBody({ subscriptionId: 'sub-2' }));
    expect(result).toMatchObject({ subscriptionId: 'sub-2', status: 'COMPLETED', progress: 100 });
    expect(f.prisma.subscription.findFirst).toHaveBeenLastCalledWith({ where: {
      id: 'sub-2', enterpriseId: 'ent-1', status: 'ACTIVE', OR: [{ endDate: null }, { endDate: { gt: expect.any(Date) } }],
      grants: { some: {
        OR: [{ memberId: 'member-1' }, { departmentId: 'dept-1' }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] }],
      } },
    }, select: { id: true } });
  });

  it.each(['memberId', 'departmentId'])('create excludes expired %s grants and shares the subscription cutoff', async grantKey => {
    const f = fixture();
    const grant = { [grantKey]: grantKey === 'memberId' ? 'member-1' : 'dept-1', expiresAt: new Date(0) };
    f.prisma.subscription.findFirst.mockImplementation(async ({ where }) => {
      const some = where.grants.some;
      const matchesIdentity = some.OR.some((condition: any) => condition[grantKey] === grant[grantKey]);
      const expiryConditions = some.AND?.[0].OR;
      const matchesExpiry = !expiryConditions || expiryConditions.some((condition: any) =>
        condition.expiresAt === null ? grant.expiresAt === null : grant.expiresAt > condition.expiresAt.gt,
      );
      return matchesIdentity && matchesExpiry ? { id: 'sub-1' } : null;
    });
    await expect(f.service.createTaskMirror('user-1', createBody())).rejects.toBeInstanceOf(ForbiddenException);
    const where = f.prisma.subscription.findFirst.mock.calls[0][0].where;
    expect(where.grants.some.AND).toEqual([{ OR: [
      { expiresAt: null }, { expiresAt: { gt: expect.any(Date) } },
    ] }]);
    expect(where.grants.some.AND[0].OR[1].expiresAt.gt).toBe(where.OR[1].endDate.gt);
    expect(f.prisma.clientTaskMirror.create).not.toHaveBeenCalled();
    expect(f.prisma.clientTaskMirror.update).not.toHaveBeenCalled();
  });

  it('no-department authorization uses direct grants only; expired/inactive subscription is denied', async () => {
    const f = fixture();
    f.ctx.departmentId = null!;
    f.prisma.subscription.findFirst.mockResolvedValue(null);
    await expect(f.service.createTaskMirror('user-1', createBody())).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.prisma.subscription.findFirst.mock.calls[0][0].where.grants.some.OR).toEqual([{ memberId: 'member-1' }]);
    expect(f.rows()).toEqual([]);
  });

  it('cross-enterprise reused clientTaskId is refused without overwriting any fields', async () => {
    const f = fixture();
    f.seed(makeRow({ enterpriseId: 'ent-2', status: 'COMPLETED' }));
    await expect(f.service.createTaskMirror('user-1', createBody({ clientRunId: 'run-2' }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.rows()[0]).toMatchObject({ enterpriseId: 'ent-2', clientRunId: 'run-1', status: 'COMPLETED' });
    expect(f.prisma.clientTaskMirror.update).not.toHaveBeenCalled();
  });

  it('same run replay is also denied after authorization is revoked', async () => {
    const f = fixture();
    f.seed(makeRow());
    f.prisma.subscription.findFirst.mockResolvedValue(null);
    await expect(f.service.createTaskMirror('user-1', createBody())).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.prisma.clientTaskMirror.update).not.toHaveBeenCalled();
  });

  it('explicit stale status conflicts; legacy omission and active run work', async () => {
    const f = fixture();
    f.seed(makeRow({ clientRunId: 'run-2' }));
    await expect(f.service.updateTaskMirror('user-1', 'mirror-1', { clientRunId: 'run-1', status: 'COMPLETED' })).rejects.toBeInstanceOf(ConflictException);
    expect(f.rows()[0].status).toBe('QUEUED');
    expect(await f.service.updateTaskMirror('user-1', 'mirror-1', { status: 'RUNNING' })).toMatchObject({ status: 'RUNNING', startedAt: expect.any(Date) });
    expect(await f.service.updateTaskMirror('user-1', 'mirror-1', { clientRunId: 'run-2', status: 'FAILED', errorSummary: 'fail' })).toMatchObject({ status: 'FAILED', errorSummary: 'fail', completedAt: expect.any(Date) });
  });

  it('repeated final status does not replace completion timestamp', async () => {
    const f = fixture();
    f.seed(makeRow({ status: 'COMPLETED', completedAt: createdAt }));
    const result = await f.service.updateTaskMirror('user-1', 'mirror-1', { clientRunId: 'run-1', status: 'COMPLETED' });
    expect(result.completedAt).toEqual(createdAt);
  });

  it.each(['COMPLETED', 'FAILED', 'CANCELLED'])('legacy terminal %s cannot be reopened by a late status request', async status => {
    const f = fixture();
    f.seed(makeRow({ status, completedAt: createdAt, progress: 100 }));
    const before = { ...f.rows()[0] };
    await expect(f.service.updateTaskMirror('user-1', 'mirror-1', { status: 'RUNNING', progress: 10 }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(f.rows()[0]).toEqual(before);
    expect(await f.service.listTaskMirrors('user-1', { view: 'active' })).toEqual([]);
    expect(f.prisma.clientTaskMirror.update).not.toHaveBeenCalled();
  });

  it('terminal retries cannot clear completion time and nonterminal requests cannot set it', async () => {
    const f = fixture();
    f.seed(makeRow({ status: 'COMPLETED', completedAt: createdAt }));
    expect(await f.service.updateTaskMirror('user-1', 'mirror-1', { status: 'COMPLETED', completedAt: null }))
      .toMatchObject({ completedAt: createdAt });
    f.seed(makeRow({ id: 'pending' }));
    await expect(f.service.updateTaskMirror('user-1', 'pending', {
      status: 'RUNNING', completedAt: createdAt.toISOString(),
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(f.rows()[1]).toMatchObject({ status: 'QUEUED', completedAt: null });
  });

  it('explicit history event archives under its run without touching active progress/heartbeat', async () => {
    const f = fixture();
    f.seed(makeRow({ clientRunId: 'run-2', progress: 10, lastSequence: 17, lastHeartbeatAt: createdAt }));
    const result = await f.service.eventTaskMirror('user-1', 'mirror-1', {
      clientRunId: 'run-1', sequence: 18, type: 'model_output', message: 'historical', progress: 100,
    });
    expect(result).toMatchObject({ lastSequence: 18, progress: 10, lastHeartbeatAt: createdAt });
    expect(f.events()[0]).toMatchObject({ clientRunId: 'run-1', message: 'historical', sequence: 18 });
    await f.service.eventTaskMirror('user-1', 'mirror-1', { sequence: 19, type: 'user_input', progress: 20 });
    expect(f.events()[1].clientRunId).toBe('run-2');
    expect(f.rows()[0].progress).toBe(20);
    const detail = await f.service.getTaskMirror('user-1', 'mirror-1');
    expect(detail.events.map(event => event.clientRunId)).toEqual(['run-1', 'run-2']);
  });

  it('sequence identity is per run, not a global watermark; persisted replays never write twice', async () => {
    const f = fixture();
    f.seed(makeRow({ clientRunId: 'run-2', lastSequence: 8, progress: 20 }));
    for (const clientRunId of ['run-1', 'run-2']) {
      const result = await f.service.eventTaskMirror('user-1', 'mirror-1', { clientRunId, sequence: 8, type: 'user_input', progress: 90 });
      expect(result).toMatchObject({ lastSequence: 8 });
      expect(result).not.toHaveProperty('duplicate');
    }
    const body = { sequence: 9, clientRunId: 'run-2', type: 'model_output', message: 'text' };
    await f.service.eventTaskMirror('user-1', 'mirror-1', body);
    expect(await f.service.eventTaskMirror('user-1', 'mirror-1', body)).toMatchObject({ duplicate: true, lastSequence: 9 });
    expect(f.events()).toHaveLength(3);
  });

  it('text chunks round-trip exactly including whitespace/newlines and ordering', async () => {
    const f = fixture();
    f.seed(makeRow());
    const content = '  leading\n' + '文'.repeat(2200) + '\n trailing  ';
    const chunks = content.match(/[\s\S]{1,1000}/g)!;
    for (const [index, message] of chunks.entries()) {
      const body = ClientTaskEventDtoSchema.parse({ clientRunId: 'run-1', sequence: index + 1, type: 'model_output',
        stepKey: `content:v1:message-1:${index}:${chunks.length}`, message });
      await f.service.eventTaskMirror('user-1', 'mirror-1', body);
    }
    const detail = await f.service.getTaskMirror('user-1', 'mirror-1');
    expect(detail.events.map(event => event.message).join('')).toBe(content);
    expect(detail.events.every(event => event.clientRunId === 'run-1')).toBe(true);
  });

  it('serialization/unique create conflicts retry and reuse winning mirror, rather than resetting terminal state', async () => {
    const f = fixture();
    f.seed(makeRow({ status: 'COMPLETED', progress: 100, lastSequence: 15 }));
    f.prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' }).mockRejectedValueOnce({ code: 'P2002' });
    expect(await f.service.createTaskMirror('user-1', createBody())).toMatchObject({ id: 'mirror-1', status: 'COMPLETED', lastSequence: 15 });
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('event race retries observe persisted identity and do not write twice', async () => {
    const f = fixture();
    f.seed(makeRow({ lastSequence: 1 }));
    await f.service.eventTaskMirror('user-1', 'mirror-1', { sequence: 1, type: 'user_input' });
    f.prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    expect(await f.service.eventTaskMirror('user-1', 'mirror-1', { sequence: 1, type: 'user_input' })).toMatchObject({ duplicate: true });
    expect(f.events()).toHaveLength(1);
  });

  it('event/update failure rolls back archival watermark and does not swallow unexpected failures', async () => {
    const f = fixture();
    f.seed(makeRow());
    const error = new Error('Mock write failure');
    f.prisma.clientTaskMirror.update.mockRejectedValueOnce(error);
    await expect(f.service.eventTaskMirror('user-1', 'mirror-1', { sequence: 1, type: 'user_input' })).rejects.toBe(error);
    expect(f.events()).toEqual([]);
    expect(f.rows()[0].lastSequence).toBe(0);
  });

  it('repeated transaction conflicts become bounded retryable HTTP 409', async () => {
    const f = fixture();
    f.prisma.$transaction.mockRejectedValue({ code: 'P2034' });
    await expect(f.service.createTaskMirror('user-1', createBody())).rejects.toBeInstanceOf(ConflictException);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});

describe('Client task monitor v2 runs and participation', () => {
  const v2 = (overrides: Record<string, unknown> = {}) => createBody({ protocolVersion: 2 as const,
    queuedAt: '2026-10-08T08:00:00+08:00', ...overrides });
  const participant = (overrides: Record<string, unknown> = {}) => ({ executionId: 'node-run-1',
    subscriptionId: 'sub-1', nodeId: 'node-1', title: 'Node', modelId: 'model-1', ...overrides });

  it.each(['COMPLETED', 'FAILED', 'CANCELLED'] as const)('v2 terminal %s remains final for current and historical runs', async status => {
    const f = fixture();
    await f.service.createTaskMirror('user-1', v2());
    await f.service.updateTaskMirror('user-1', 'mirror-1', { status, progress: 100 });
    const finishedMirror = { ...f.rows()[0] };
    const finishedRun = { ...f.runs()[0] };
    await expect(f.service.updateTaskMirror('user-1', 'mirror-1', { status: 'RUNNING' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(f.rows()[0]).toEqual(finishedMirror);
    expect(f.runs()[0]).toEqual(finishedRun);
    expect(await f.service.listTaskMirrors('user-1', { view: 'active' })).toEqual([]);
    await f.service.createTaskMirror('user-1', v2({ clientRunId: 'run-2' }));
    await f.service.updateTaskMirror('user-1', 'mirror-1', { clientRunId: 'run-2', status: 'RUNNING' });
    const current = { ...f.rows()[0] };
    await expect(f.service.updateTaskMirror('user-1', 'mirror-1', { clientRunId: 'run-1', status: 'RUNNING' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(f.rows()[0]).toEqual(current);
    expect(f.runs()[0]).toEqual(finishedRun);
  });

  it('archives newer participant chunks without reopening a terminal execution', async () => {
    const f = fixture();
    await f.service.createTaskMirror('user-1', v2());
    await f.service.eventTaskMirror('user-1', 'mirror-1', { sequence: 1, type: 'node_finished',
      participation: participant({ status: 'COMPLETED', completedAt: createdAt.toISOString() }) });
    await f.service.eventTaskMirror('user-1', 'mirror-1', { sequence: 2, type: 'model_output', message: 'late output',
      participation: participant({ status: 'RUNNING' }) });
    expect(f.participations()[0]).toMatchObject({ status: 'COMPLETED', lastSequence: 2, completedAt: createdAt });
    expect(f.events()).toHaveLength(2);
    expect(f.events()[1].message).toBe('late output');
  });

  it('v2 freezes verified snapshots and replay never reselects or rewinds an old run', async () => {
    const f = fixture();
    await f.service.createTaskMirror('user-1', v2());
    await f.service.updateTaskMirror('user-1', 'mirror-1', { status: 'RUNNING' });
    await f.service.createTaskMirror('user-1', v2({ clientRunId: 'run-2', subscriptionId: 'sub-2' }));
    await f.service.updateTaskMirror('user-1', 'mirror-1', { status: 'RUNNING', progress: 30 });
    f.prisma.subscription.findFirst.mockResolvedValue(null);
    const replay = await f.service.createTaskMirror('user-1', v2());
    expect(replay).toMatchObject({ clientRunId: 'run-2', subscriptionId: 'sub-2', status: 'RUNNING', progress: 30 });
    expect(f.prisma.subscription.findFirst).toHaveBeenCalledTimes(2);
    expect(f.runs()).toHaveLength(2);
    expect(f.runs()[0]).toMatchObject({ protocolVersion: 2, employeeId: 'employee-sub-1',
      employeeName: 'Employee sub-1', subscriptionName: 'Subscription sub-1', queuedAt: createdAt });
    await expect(f.service.createTaskMirror('user-1', v2({ subscriptionId: 'sub-2' }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('never backfills proof for a legacy run and does not accept participation without a proven run', async () => {
    const f = fixture();
    f.seed(makeRow());
    await expect(f.service.createTaskMirror('user-1', v2())).rejects.toBeInstanceOf(ConflictException);
    await expect(f.service.eventTaskMirror('user-1', 'mirror-1', { sequence: 1, type: 'node_started',
      participation: participant() })).rejects.toBeInstanceOf(ConflictException);
    expect(f.runs()).toEqual([]);
    expect(f.participations()).toEqual([]);
    expect(f.events()).toEqual([]);
  });

  it('historical proven status changes only the run, stale heartbeat and unknown old status are rejected', async () => {
    const f = fixture();
    await f.service.createTaskMirror('user-1', v2());
    await f.service.createTaskMirror('user-1', v2({ clientRunId: 'run-2' }));
    await f.service.updateTaskMirror('user-1', 'mirror-1', { status: 'RUNNING', progress: 40 });
    const current = { ...f.rows()[0] };
    await f.service.updateTaskMirror('user-1', 'mirror-1', { clientRunId: 'run-1', status: 'COMPLETED',
      progress: 100, completedAt: '2026-10-08T02:00:00Z' });
    expect(f.runs()[0]).toMatchObject({ status: 'COMPLETED', completedAt: new Date('2026-10-08T02:00:00Z') });
    expect(f.rows()[0]).toEqual(current);
    await expect(f.service.heartbeatTaskMirror('user-1', 'mirror-1', { clientRunId: 'run-1', progress: 0 })).rejects.toBeInstanceOf(ConflictException);
    await expect(f.service.updateTaskMirror('user-1', 'mirror-1', { clientRunId: 'unproven', status: 'FAILED' })).rejects.toBeInstanceOf(ConflictException);
    expect(await f.service.heartbeatTaskMirror('user-1', 'mirror-1', { clientRunId: 'run-2' })).toMatchObject({ lastHeartbeatAt: expect.any(Date) });
  });

  it('admits participants once, reuses snapshots after revocation, and keeps repeated executions separate', async () => {
    const f = fixture();
    await f.service.createTaskMirror('user-1', v2());
    await f.service.eventTaskMirror('user-1', 'mirror-1', { sequence: 1, type: 'node_started',
      participation: participant({ status: 'RUNNING', startedAt: '2026-10-08T00:00:01Z' }) });
    await f.service.eventTaskMirror('user-1', 'mirror-1', { sequence: 2, type: 'node_started',
      participation: participant({ executionId: 'node-run-2', subscriptionId: 'sub-2', status: 'RUNNING' }) });
    f.prisma.subscription.findFirst.mockResolvedValue(null);
    const chunk = { sequence: 3, type: 'model_output', stepKey: 'content:v1:m:0:1', message: ' actual output ',
      participation: participant({ status: 'COMPLETED', completedAt: '2026-10-08T01:00:00Z' }) };
    await f.service.eventTaskMirror('user-1', 'mirror-1', chunk);
    expect(await f.service.eventTaskMirror('user-1', 'mirror-1', chunk)).toMatchObject({ duplicate: true });
    await f.service.eventTaskMirror('user-1', 'mirror-1', { sequence: 4, type: 'model_output', message: 'aggregate' });
    expect(f.prisma.subscription.findFirst).toHaveBeenCalledTimes(3);
    expect(f.participations()).toHaveLength(2);
    expect(f.participations()[0]).toMatchObject({ status: 'COMPLETED', employeeName: 'Employee sub-1' });
    expect(f.events()[2]).toMatchObject({ participationId: f.participations()[0].id });
    expect(f.events()[3].participationId).toBeNull();
    const detail = await f.service.getTaskMirror('user-1', 'mirror-1');
    expect(detail.runs[0].participations).toHaveLength(2);
    expect(detail.runs[0].participations[0].events.map(event => event.message)).toEqual([null, ' actual output ']);
    await expect(f.service.eventTaskMirror('user-1', 'mirror-1', { sequence: 5, type: 'node_started',
      participation: participant({ executionId: 'new-denied' }) })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.eventTaskMirror('user-1', 'mirror-1', { sequence: 5, type: 'node_finished',
      participation: participant({ subscriptionId: 'sub-2' }) })).rejects.toBeInstanceOf(ConflictException);
    await expect(f.service.eventTaskMirror('user-1', 'mirror-1', { sequence: 5, type: 'node_finished',
      participation: participant({ nodeId: 'another-node' }) })).rejects.toBeInstanceOf(ConflictException);
    expect(f.events()).toHaveLength(4);
  });

  it('out-of-order chunks preserve content without rewinding progress, participant state, or diagnostic maximum', async () => {
    const f = fixture();
    await f.service.createTaskMirror('user-1', v2());
    const finish = { sequence: 10, type: 'model_output', progress: 100, message: 'end',
      participation: participant({ status: 'COMPLETED', completedAt: '2026-10-08T02:00:00Z' }) };
    await f.service.eventTaskMirror('user-1', 'mirror-1', finish);
    await f.service.eventTaskMirror('user-1', 'mirror-1', { sequence: 2, type: 'model_output', progress: 10, message: 'start',
      participation: participant({ status: 'RUNNING', startedAt: '2026-10-08T01:00:00Z' }) });
    expect(f.rows()[0]).toMatchObject({ progress: 100, lastSequence: 10 });
    expect(f.participations()[0]).toMatchObject({ status: 'COMPLETED', lastSequence: 10,
      startedAt: new Date('2026-10-08T01:00:00Z') });
    await expect(f.service.eventTaskMirror('user-1', 'mirror-1', { ...finish, message: 'changed' })).rejects.toBeInstanceOf(ConflictException);
    await expect(f.service.eventTaskMirror('user-1', 'mirror-1', { ...finish,
      participation: participant({ status: 'FAILED' }) })).rejects.toBeInstanceOf(ConflictException);
    await f.service.createTaskMirror('user-1', v2({ clientRunId: 'run-2' }));
    await f.service.eventTaskMirror('user-1', 'mirror-1', { sequence: 1, type: 'model_output', progress: 5 });
    expect(f.rows()[0]).toMatchObject({ progress: 5, lastSequence: 10 });
    expect(f.events()).toHaveLength(3);
  });

  it('participant admission and event insertion roll back together on failure', async () => {
    const f = fixture();
    await f.service.createTaskMirror('user-1', v2());
    const error = new Error('write failed');
    f.prisma.clientTaskMirrorEvent.create.mockRejectedValueOnce(error);
    await expect(f.service.eventTaskMirror('user-1', 'mirror-1', { sequence: 1, type: 'node_started',
      participation: participant() })).rejects.toBe(error);
    expect(f.participations()).toEqual([]);
    expect(f.events()).toEqual([]);
  });

  it('archives the admitted conversation first participation after revocation using only the run snapshot', async () => {
    const f = fixture();
    await f.service.createTaskMirror('user-1', v2({ modelId: 'admitted-model' }));
    f.prisma.subscription.findFirst.mockResolvedValue(null);
    const body = { clientRunId: 'run-1', sequence: 1, type: 'participation_status',
      participation: { executionId: 'run-1', subscriptionId: 'sub-1', status: 'QUEUED' as const, modelId: 'changed-model' } };
    await f.service.eventTaskMirror('user-1', 'mirror-1', body);
    expect(f.prisma.subscription.findFirst).toHaveBeenCalledTimes(1);
    expect(f.participations()[0]).toMatchObject({ executionId: 'run-1', subscriptionId: 'sub-1',
      employeeId: 'employee-sub-1', employeeName: 'Employee sub-1', subscriptionName: 'Subscription sub-1',
      modelId: 'admitted-model', status: 'QUEUED' });
    expect(f.events()[0].participationId).toBe(f.participations()[0].id);
    expect(await f.service.eventTaskMirror('user-1', 'mirror-1', body)).toMatchObject({ duplicate: true });
  });

  it.each([
    { taskType: 'arrangement', executionId: 'run-1', subscriptionId: 'sub-1' },
    { taskType: 'conversation', executionId: 'node-run-1', subscriptionId: 'sub-1' },
    { taskType: 'conversation', executionId: 'run-1', subscriptionId: 'sub-2' },
    { taskType: 'conversation', executionId: 'run-1', subscriptionId: 'sub-1', nodeId: 'node-1' },
  ])('run admission does not authorize a new node or another subscription: %j', async ({ taskType, ...participation }) => {
    const f = fixture();
    await f.service.createTaskMirror('user-1', v2({ taskType }));
    f.prisma.subscription.findFirst.mockResolvedValue(null);
    await expect(f.service.eventTaskMirror('user-1', 'mirror-1', {
      sequence: 1, type: 'node_started', participation,
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.prisma.subscription.findFirst).toHaveBeenCalledTimes(2);
    expect(f.participations()).toEqual([]);
    expect(f.events()).toEqual([]);
  });
});

describe('Client task monitor filtering, summaries and options', () => {
  const query = (input: unknown) => ClientTaskMirrorQueryDtoSchema.parse(input);
  const prepare = async (role = 'MEMBER') => {
    const f = fixture(role);
    await f.service.createTaskMirror('user-1', createBody({ protocolVersion: 2 as const, queuedAt: '2026-10-08T08:00:00+08:00' }));
    for (const [sequence, executionId, subscriptionId] of [[1, 'execution-1', 'sub-2'], [2, 'execution-2', 'sub-2'], [3, 'execution-3', 'sub-1']] as const) {
      await f.service.eventTaskMirror('user-1', 'mirror-1', { sequence, type: 'node_started',
        participation: { executionId, subscriptionId, startedAt: '2026-10-08T08:30:00+08:00' } });
    }
    f.seed(makeRow({ id: 'legacy', subscriptionId: 'sub-2', status: 'FAILED', title: 'Legacy', taskType: 'workflow' }),
      makeRow({ id: 'peer', userId: 'user-2', subscriptionId: 'sub-2', status: 'COMPLETED' }),
      makeRow({ id: 'foreign', enterpriseId: 'ent-2', status: 'RUNNING' }));
    return f;
  };

  it('subscription filter includes proven participation OR limited legacy, never a v2 root alone', async () => {
    const f = await prepare();
    const result: any[] = await f.service.listTaskMirrors('user-1', query({ subscriptionId: 'sub-2' })) as any[];
    expect(result.map(row => row.id)).toEqual(['mirror-1', 'legacy']);
    expect(result[0].subscriptionSummary).toEqual({ coverage: 'proven', legacySubscriptionId: null, subscriptions: [
      { subscriptionId: 'sub-1', employeeId: 'employee-sub-1', employeeName: 'Employee sub-1', subscriptionName: 'Subscription sub-1', executionCount: 1 },
      { subscriptionId: 'sub-2', employeeId: 'employee-sub-2', employeeName: 'Employee sub-2', subscriptionName: 'Subscription sub-2', executionCount: 2 },
    ] });
    expect(result[1].subscriptionSummary).toEqual({ coverage: 'limited', legacySubscriptionId: 'sub-2', subscriptions: [] });
    expect(result[0]).not.toHaveProperty('events');
    await f.service.createTaskMirror('user-1', createBody({ clientTaskId: 'unused', clientRunId: 'unused-run', protocolVersion: 2 as const, subscriptionId: 'sub-unused' }));
    expect(await f.service.listTaskMirrors('user-1', query({ subscriptionId: 'sub-unused' }))).toEqual([]);
  });

  it('combines title/type/view/status filters and date-only execution ranges, not heartbeat time', async () => {
    const f = await prepare();
    expect((await f.service.listTaskMirrors('user-1', query({ q: 'lega', taskType: 'workflow', view: 'attention', statuses: 'FAILED' })) as any[])
      .map(row => row.id)).toEqual(['legacy']);
    expect(await f.service.listTaskMirrors('user-1', query({ view: 'active', statuses: 'FAILED' }))).toEqual([]);
    await f.service.heartbeatTaskMirror('user-1', 'mirror-1', {});
    const range = { subscriptionId: 'sub-2', from: '2026-10-08', to: '2026-10-09' };
    expect((await f.service.listTaskMirrors('user-1', query(range)) as any[]).map(row => row.id)).toEqual(['mirror-1', 'legacy']);
    expect(await f.service.listTaskMirrors('user-1', query({ ...range, from: '2026-10-09', to: '2026-10-10' }))).toEqual([]);
    expect(await f.service.listTaskMirrors('user-1', query({ ...range, from: '2026-10-08T00:30:00Z', to: '2026-10-08T01:00:00Z' }))).toHaveLength(1);
    expect(await f.service.listTaskMirrors('user-1', query({ ...range, from: '2026-10-07T23:00:00Z', to: '2026-10-08T00:30:00Z' }))).toHaveLength(1);
  });

  it('options ignore status/view/pagination but retain filters and owner/admin boundaries', async () => {
    const f = await prepare();
    const options = await f.service.getTaskMirrorFilterOptions('user-1', query({ view: 'active', statuses: 'RUNNING', page: 99, subscriptionId: 'sub-2' }));
    expect(options).toMatchObject({ users: [{ id: 'user-1', name: 'Alice' }], taskTypes: ['conversation', 'workflow'],
      counts: { active: 1, attention: 1, history: 2 } });
    expect(options.subscriptions.map(sub => sub.subscriptionId)).toEqual(['sub-1', 'sub-2']);
    await expect(f.service.listTaskMirrors('user-1', query({ userId: 'user-2' }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.getTaskMirrorFilterOptions('user-1', query({ userId: 'user-2' }))).rejects.toBeInstanceOf(ForbiddenException);
    const admin = await prepare('ENTERPRISE_ADMIN');
    expect((await admin.service.listTaskMirrors('user-1', query({ userId: 'user-2' })) as any[]).map(row => row.id)).toEqual(['peer']);
    expect((await admin.service.getTaskMirrorFilterOptions('user-1')).counts).toEqual({ active: 1, attention: 1, history: 3 });
    expect((await admin.service.getTaskMirrorFilterOptions('user-1', query({ scope: 'mine' }))).users).toEqual([{ id: 'user-1', name: 'Alice' }]);
  });

  it.each(['queuedAt', 'startedAt', 'updatedAt'])('both %s sort directions have stable id ties and nulls last', async field => {
    const f = fixture();
    f.seed(makeRow({ id: 'b', [field]: createdAt }), makeRow({ id: 'a', [field]: createdAt }),
      makeRow({ id: 'c', [field]: new Date('2026-10-09T00:00:00Z') }));
    if (field !== 'updatedAt') f.seed(makeRow({ id: 'null', [field]: null }));
    const asc: any[] = await f.service.listTaskMirrors('user-1', query({ sort: `${field}_asc` })) as any[];
    const desc: any[] = await f.service.listTaskMirrors('user-1', query({ sort: `${field}_desc` })) as any[];
    expect(asc.map(row => row.id)).toEqual(field === 'updatedAt' ? ['a', 'b', 'c'] : ['a', 'b', 'c', 'null']);
    expect(desc.map(row => row.id)).toEqual(field === 'updatedAt' ? ['c', 'b', 'a'] : ['c', 'b', 'a', 'null']);
  });
});

describe('Client task query/body validation and controller contract', () => {
  it('coerces valid pagination, preserves omitted pagination and strips hostile query fields', () => {
    const pipe = new ZodValidationPipe(ClientTaskMirrorQueryDtoSchema);
    expect(pipe.transform({ scope: 'mine', userId: 'peer', enterpriseId: 'foreign' })).toEqual({ scope: 'mine', userId: 'peer' });
    expect(pipe.transform({ page: '2', limit: '100' })).toEqual({ page: 2, limit: 100 });
    expect(pipe.transform({})).toEqual({});
  });

  it.each([{ page: '0' }, { page: '-1' }, { page: '1.5' }, { page: 'NaN' }, { page: ['1', '2'] },
    { limit: '101' }, { limit: '0' }, { limit: '' }, { scope: 'all' }])('invalid query %j is HTTP 400', query => {
    expect(() => new ZodValidationPipe(ClientTaskMirrorQueryDtoSchema).transform(query)).toThrow(BadRequestException);
  });

  it('optional run IDs are legacy-compatible; explicit empty run and oversized messages are rejected', () => {
    expect(UpdateClientTaskMirrorStatusDtoSchema.parse({ status: 'RUNNING' })).toEqual({ status: 'RUNNING' });
    expect(ClientTaskEventDtoSchema.parse({ sequence: 1, type: 'user_input' })).toEqual({ sequence: 1, type: 'user_input' });
    expect(ClientTaskEventDtoSchema.safeParse({ sequence: 1, type: 'user_input', clientRunId: '' }).success).toBe(false);
    expect(ClientTaskEventDtoSchema.safeParse({ sequence: 1, type: 'user_input', message: 'a'.repeat(1001) }).success).toBe(false);
    expect(UpdateClientTaskMirrorStatusDtoSchema.safeParse({ status: 'RUNNING', clientRunId: '' }).success).toBe(false);
  });

  it('validates protocol, participation state/times, status filters and date boundaries', () => {
    expect(CreateClientTaskMirrorDtoSchema.safeParse(createBody({ protocolVersion: 1 })).success).toBe(false);
    expect(CreateClientTaskMirrorDtoSchema.safeParse(createBody({ protocolVersion: 2, queuedAt: '2026-10-08T08:00:00+08:00' })).success).toBe(true);
    expect(ClientTaskHeartbeatDtoSchema.safeParse({ clientRunId: '' }).success).toBe(false);
    for (const input of [{ sort: 'updated' }, { statuses: 'RUNNING,unknown' }, { from: '2026-02-30' },
      { from: '2026-10-09', to: '2026-10-08' }, { from: '2026-10-08T10:00:00' }]) {
      expect(ClientTaskMirrorQueryDtoSchema.safeParse(input).success).toBe(false);
    }
    expect(ClientTaskMirrorQueryDtoSchema.parse({ statuses: 'RUNNING, PAUSED' }).statuses).toEqual(['RUNNING', 'PAUSED']);
    for (const participation of [{ executionId: '', subscriptionId: 'sub-1' },
      { executionId: 'exec', subscriptionId: 'sub-1', status: 'unknown' },
      { executionId: 'exec', subscriptionId: 'sub-1', startedAt: 'yesterday' }]) {
      expect(ClientTaskEventDtoSchema.safeParse({ sequence: 1, type: 'node', participation }).success).toBe(false);
    }
  });

  it('filter options controller forwards validated query and registers its route before :id', async () => {
    const service = { getTaskMirrorFilterOptions: jest.fn().mockResolvedValue({ counts: { history: 0 } }) };
    const controller = new ClientController(service as any);
    const query = ClientTaskMirrorQueryDtoSchema.parse({ subscriptionId: 'sub-1', statuses: 'FAILED' });
    await controller.getTaskMirrorFilterOptions({ user: { id: 'user-1' } } as any, query);
    expect(service.getTaskMirrorFilterOptions).toHaveBeenCalledWith('user-1', query);
    const names = Object.getOwnPropertyNames(ClientController.prototype);
    expect(names.indexOf('getTaskMirrorFilterOptions')).toBeLessThan(names.indexOf('getTaskMirror'));
  });

  it('controller forwards only authenticated user and validated pagination', async () => {
    const service = { listTaskMirrors: jest.fn().mockResolvedValue({ items: [], total: 0, page: 2, limit: 50, hasNextPage: false }) };
    const controller = new ClientController(service as any);
    const query = new ZodValidationPipe(ClientTaskMirrorQueryDtoSchema).transform({ page: '2', userId: 'peer' });
    expect(await controller.listTaskMirrors({ user: { id: 'user-1' } } as any, query)).toMatchObject({ page: 2, items: [] });
    expect(service.listTaskMirrors).toHaveBeenCalledWith('user-1', { page: 2, userId: 'peer' });
  });
});


describe('Task mirror route throttling', () => {
  const taskHandlers = [
    'createTaskMirror', 'updateTaskMirror', 'heartbeatTaskMirror',
    'eventTaskMirror', 'listTaskMirrors', 'getTaskMirror', 'getTaskMirrorFilterOptions',
  ] as const;
  const options = () => [
    { name: 'default', ttl: 60000, limit: 100 },
    { name: 'auth', ttl: 60000, limit: 10 },
    { name: 'chat', ttl: 60000, limit: 60 },
  ];
  const executionContext = (handler: (...args: never[]) => unknown, header: jest.Mock) => ({
    getHandler: () => handler, getClass: () => ClientController,
    switchToHttp: () => ({
      getRequest: () => ({ ip: '127.0.0.1', headers: {} }),
      getResponse: () => ({ header }),
    }),
  });

  it.each(taskHandlers)('%s skips only auth/chat and retains JWT and default bucket', handlerName => {
    const handler = ClientController.prototype[handlerName];
    expect(Reflect.getMetadata(THROTTLER_SKIP + 'auth', handler)).toBe(true);
    expect(Reflect.getMetadata(THROTTLER_SKIP + 'chat', handler)).toBe(true);
    expect(Reflect.getMetadata(THROTTLER_SKIP + 'default', handler)).not.toBe(true);
    expect(Reflect.getMetadata(THROTTLER_LIMIT + 'default', handler)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(JwtAuthGuard);
  });

  it('actual guard applies just default 100/60s to task routes', async () => {
    const storage = { increment: jest.fn().mockResolvedValue({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) };
    const guard = new ThrottlerGuard(options(), storage, new Reflector());
    await guard.onModuleInit();
    for (const name of taskHandlers) {
      storage.increment.mockClear();
      expect(await guard.canActivate(executionContext(ClientController.prototype[name], jest.fn()) as any)).toBe(true);
      expect(storage.increment).toHaveBeenCalledTimes(1);
      expect(storage.increment).toHaveBeenCalledWith(expect.any(String), 60000, 100, 60000, 'default');
    }
  });

  it('blocked default route still returns HTTP 429 with unsuffixed Retry-After', async () => {
    const storage = { increment: jest.fn().mockResolvedValue({ totalHits: 101, timeToExpire: 42, isBlocked: true, timeToBlockExpire: 42 }) };
    const guard = new ThrottlerGuard(options(), storage, new Reflector());
    await guard.onModuleInit();
    const header = jest.fn();
    await expect(guard.canActivate(executionContext(ClientController.prototype.createTaskMirror, header) as any)).rejects.toBeInstanceOf(ThrottlerException);
    expect(header).toHaveBeenCalledWith('Retry-After', 42);
  });

  it('unrelated login/subscription handlers still use all configured buckets', async () => {
    const storage = { increment: jest.fn().mockResolvedValue({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) };
    const guard = new ThrottlerGuard(options(), storage, new Reflector());
    await guard.onModuleInit();
    for (const name of ['login', 'listSubscriptions'] as const) {
      storage.increment.mockClear();
      expect(await guard.canActivate(executionContext(ClientController.prototype[name], jest.fn()) as any)).toBe(true);
      expect(storage.increment.mock.calls.map(call => call[4])).toEqual(['default', 'auth', 'chat']);
    }
    expect(Reflect.getMetadata(THROTTLER_SKIP + 'auth', ClientController)).toBeUndefined();
  });
});
