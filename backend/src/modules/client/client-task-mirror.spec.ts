import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';
import { THROTTLER_SKIP, THROTTLER_LIMIT } from '@nestjs/throttler/dist/throttler.constants';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClientService } from './client.service';
import { ClientController } from './client.controller';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  ClientTaskEventDtoSchema,
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
  ...overrides,
});
const createBody = (overrides: Record<string, unknown> = {}) => ({
  clientTaskId: 'task-1', clientRunId: 'run-1', subscriptionId: 'sub-1', title: 'Task', ...overrides,
});

// Stateful mock only. No real database, credentials, network, or schema changes.
function fixture(role = 'MEMBER') {
  let rows: any[] = [];
  let events: any[] = [];
  const ctx = { enterpriseId: 'ent-1', memberId: 'member-1', departmentId: 'dept-1', role };
  const context = { resolve: jest.fn().mockResolvedValue(ctx) };
  const matches = (row: any, where: any) => Object.entries(where ?? {}).every(([key, value]) =>
    key === 'userId_clientTaskId'
      ? row.userId === (value as any).userId && row.clientTaskId === (value as any).clientTaskId
      : row[key] === value,
  );
  const withUser = (row: any, include: any) => !row ? null : ({
    ...row, ...(include ? { user: { id: row.userId, name: row.userId === 'user-1' ? 'Alice' : null } } : {}),
  });
  const prisma: any = {
    subscription: { findFirst: jest.fn().mockResolvedValue({ id: 'sub-1' }) },
    clientTaskMirror: {
      findUnique: jest.fn(async ({ where, include }) => withUser(rows.find(row => matches(row, where)), include)),
      findFirst: jest.fn(async ({ where, include }) => withUser(rows.find(row => matches(row, where)), include)),
      findMany: jest.fn(async ({ where, include, skip = 0, take }) => rows
        .filter(row => matches(row, where))
        .sort((a, b) => +b.updatedAt - +a.updatedAt || b.id.localeCompare(a.id))
        .slice(skip, skip + take).map(row => withUser(row, include))),
      count: jest.fn(async ({ where }) => rows.filter(row => matches(row, where)).length),
      create: jest.fn(async ({ data }) => {
        const row = makeRow(data);
        rows.push(row);
        return { ...row };
      }),
      update: jest.fn(async ({ where, data }) => {
        const row = rows.find(row => matches(row, where));
        if (!row) throw new Error('Missing fixture row');
        Object.entries(data).forEach(([key, value]) => { if (value !== undefined) row[key] = value; });
        return { ...row };
      }),
    },
    clientTaskMirrorEvent: {
      create: jest.fn(async ({ data }) => { const row = { id: `event-${events.length}`, ...data }; events.push(row); return row; }),
      findMany: jest.fn(async ({ where }) => events.filter(row => matches(row, where)).sort((a, b) => a.sequence - b.sequence)),
    },
  };
  prisma.$transaction = jest.fn(async (work: any) => {
    const originalRows = rows.map(row => ({ ...row }));
    const originalEvents = events.map(row => ({ ...row }));
    try { return await work(prisma); } catch (error) {
      rows = originalRows;
      events = originalEvents;
      throw error;
    }
  });
  const service = new ClientService(prisma, null!, null!, null!, context as any, null!, null!, null!, null!);
  return { service, prisma, context, ctx, seed: (...data: any[]) => rows.push(...data),
    rows: () => rows, events: () => events };
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
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 100,
      include: { user: { select: { id: true, name: true } } },
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

  it('sequence watermark is global across runs and duplicates never write events or state', async () => {
    const f = fixture();
    f.seed(makeRow({ clientRunId: 'run-2', lastSequence: 8, progress: 20 }));
    for (const clientRunId of ['run-1', 'run-2']) {
      const result = await f.service.eventTaskMirror('user-1', 'mirror-1', { clientRunId, sequence: 8, type: 'user_input', progress: 90 });
      expect(result).toMatchObject({ duplicate: true, lastSequence: 8, progress: 20 });
    }
    const body = { sequence: 9, clientRunId: 'run-2', type: 'model_output', message: 'text' };
    await f.service.eventTaskMirror('user-1', 'mirror-1', body);
    expect(await f.service.eventTaskMirror('user-1', 'mirror-1', body)).toMatchObject({ duplicate: true, lastSequence: 9 });
    expect(f.events()).toHaveLength(1);
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

  it('event race retries observe updated watermark and do not write twice', async () => {
    const f = fixture();
    f.seed(makeRow({ lastSequence: 1 }));
    f.prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    expect(await f.service.eventTaskMirror('user-1', 'mirror-1', { sequence: 1, type: 'user_input' })).toMatchObject({ duplicate: true });
    expect(f.events()).toEqual([]);
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

describe('Client task query/body validation and controller contract', () => {
  it('coerces valid pagination, preserves omitted pagination and strips hostile query fields', () => {
    const pipe = new ZodValidationPipe(ClientTaskMirrorQueryDtoSchema);
    expect(pipe.transform({ scope: 'mine', userId: 'peer', enterpriseId: 'foreign' })).toEqual({ scope: 'mine' });
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

  it('controller forwards only authenticated user and validated pagination', async () => {
    const service = { listTaskMirrors: jest.fn().mockResolvedValue({ items: [], total: 0, page: 2, limit: 50, hasNextPage: false }) };
    const controller = new ClientController(service as any);
    const query = new ZodValidationPipe(ClientTaskMirrorQueryDtoSchema).transform({ page: '2', userId: 'peer' });
    expect(await controller.listTaskMirrors({ user: { id: 'user-1' } } as any, query)).toMatchObject({ page: 2, items: [] });
    expect(service.listTaskMirrors).toHaveBeenCalledWith('user-1', { page: 2 });
  });
});


describe('Task mirror route throttling', () => {
  const taskHandlers = [
    'createTaskMirror', 'updateTaskMirror', 'heartbeatTaskMirror',
    'eventTaskMirror', 'listTaskMirrors', 'getTaskMirror',
  ] as const;
  const options = () => [
    { name: 'default', ttl: 60000, limit: 100 },
    { name: 'auth', ttl: 60000, limit: 10 },
    { name: 'chat', ttl: 60000, limit: 60 },
  ];
  const executionContext = (handler: Function, header: jest.Mock) => ({
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
