import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  SubscriptionUsageQueryDtoSchema,
  SubscriptionUsageRecordParamsSchema,
} from 'shared';
import { SubscriptionUsageService } from './subscription-usage.service';

describe('Subscription usage query contract', () => {
  it('defaults to descending order', () => {
    expect(SubscriptionUsageQueryDtoSchema.parse({}).order).toBe('desc');
  });
  it.each(['asc', 'desc'])('accepts explicit %s order', (order) => {
    expect(SubscriptionUsageQueryDtoSchema.parse({ order }).order).toBe(order);
  });
  it('uses UTC+8 date boundaries and explicit timezone instants', () => {
    expect(
      SubscriptionUsageQueryDtoSchema.parse({
        from: '2026-10-09',
        to: '2026-10-10',
      }),
    ).toMatchObject({
      from: '2026-10-08T16:00:00.000Z',
      to: '2026-10-09T16:00:00.000Z',
      page: 1,
      limit: 20,
    });
    expect(
      SubscriptionUsageQueryDtoSchema.parse({
        from: '2026-10-09T01:00:00+08:00',
      }).from,
    ).toBe('2026-10-08T17:00:00.000Z');
  });
  it.each([
    { from: '2026-02-30' },
    { from: '2026-10-09T00:00:00' },
    { from: '2026-10-10', to: '2026-10-09' },
    { from: '2026-10-09', to: '2026-10-09' },
    { limit: 101 },
    { page: 0 },
    { enterpriseId: 'foreign' },
    { source: 'unknown' },
    { order: 'ASC' },
    { order: '' },
    { order: 'asc; DROP TABLE users' },
  ])('rejects invalid or untrusted query %j', (query) => {
    expect(SubscriptionUsageQueryDtoSchema.safeParse(query).success).toBe(
      false,
    );
  });
  it('accepts the independent legacy list and detail source', () => {
    expect(
      SubscriptionUsageQueryDtoSchema.parse({ source: 'client-legacy' }).source,
    ).toBe('client-legacy');
    expect(
      SubscriptionUsageRecordParamsSchema.parse({
        source: 'client-legacy',
        recordId: 'mirror',
      }),
    ).toEqual({
      source: 'client-legacy',
      recordId: 'mirror',
    });
  });
  it('validates detail source and identifier', () => {
    expect(
      SubscriptionUsageRecordParamsSchema.safeParse({
        source: 'client',
        recordId: '',
      }).success,
    ).toBe(false);
    expect(
      SubscriptionUsageRecordParamsSchema.safeParse({
        source: 'ledger',
        recordId: 'id',
      }).success,
    ).toBe(false);
  });
});

describe('SubscriptionUsageService', () => {
  let prisma: any;
  let context: any;
  let audit: any;
  let service: SubscriptionUsageService;
  const ctx = {
    enterpriseId: 'ent',
    memberId: 'member',
    departmentId: 'dept',
    role: 'ENTERPRISE_ADMIN',
  };
  const subscription = {
    id: 'sub',
    employeeId: 'employee',
    status: 'ACTIVE',
    endDate: null,
  };
  const date = new Date('2026-10-09T01:00:00Z');
  const sqlText = (call: any) => call[0].strings.join('?');
  const query = (input = {}) => SubscriptionUsageQueryDtoSchema.parse(input);

  beforeEach(() => {
    prisma = {
      subscription: { findFirst: jest.fn().mockResolvedValue(subscription) },
      employeeGrant: {
        findFirst: jest.fn().mockResolvedValue({ id: 'grant' }),
      },
      computeUsageRecord: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 2 },
          _sum: {
            inputTokens: 100,
            outputTokens: 20,
            costCNY: new Decimal('0.3'),
          },
        }),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ items: [], total: 0n }])
        .mockResolvedValueOnce([{ userId: 'u', userName: 'User' }])
        .mockResolvedValueOnce([{ count: 1n, readableCount: 1n }]),
      clientTaskMirror: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'mirror',
          clientTaskId: 'task',
          title: 'Task',
          userId: 'u',
        }),
      },
      clientTaskParticipation: { findMany: jest.fn().mockResolvedValue([]) },
      clientTaskMirrorEvent: { findMany: jest.fn().mockResolvedValue([]) },
      message: { findMany: jest.fn().mockResolvedValue([]) },
    };
    prisma.$transaction = jest.fn((fn) => fn(prisma));
    context = { resolve: jest.fn().mockResolvedValue(ctx) };
    audit = { record: jest.fn().mockResolvedValue({ id: 'audit' }) };
    service = new SubscriptionUsageService(prisma, context, audit);
  });

  it('requires the subscription to belong to the resolved enterprise', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    await expect(service.list('sub', 'u', query())).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.subscription.findFirst.mock.calls[0][0].where).toEqual({
      id: 'sub',
      enterpriseId: 'ent',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['MEMBER', 'DEPT_MANAGER'])(
    '%s cannot select a colleague',
    async (role) => {
      context.resolve.mockResolvedValue({ ...ctx, role });
      await expect(
        service.list('sub', 'u', query({ userId: 'other' })),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['MEMBER', 'DEPT_MANAGER'])(
    '%s has only personal records, consumption and member options',
    async (role) => {
      context.resolve.mockResolvedValue({ ...ctx, role });
      const result = await service.list('sub', 'u', query());
      expect(result.scope).toBe('personal');
      expect(
        prisma.employeeGrant.findFirst.mock.calls[0][0].where,
      ).toMatchObject({
        subscriptionId: 'sub',
        OR: [{ memberId: 'member' }, { departmentId: 'dept' }],
        AND: [
          {
            OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
          },
        ],
      });
      expect(
        prisma.computeUsageRecord.aggregate.mock.calls[0][0].where.userId,
      ).toBe('u');
      const listSql = sqlText(prisma.$queryRaw.mock.calls[0]);
      expect(listSql).toContain('AND m."userId" = ?');
      expect(listSql).toContain('AND s."userId" = ?');
      const membersSql = sqlText(prisma.$queryRaw.mock.calls[1]);
      expect(membersSql).toContain('AND b."userId" = ?');
    },
  );

  it.each([
    { grant: null, status: 'ACTIVE', endDate: null },
    { grant: { id: 'grant' }, status: 'PAUSED', endDate: null },
    {
      grant: { id: 'grant' },
      status: 'ACTIVE',
      endDate: new Date('2000-01-01'),
    },
  ])(
    'members require active unexpired subscription and grant: %j',
    async ({ grant, ...fields }) => {
      context.resolve.mockResolvedValue({ ...ctx, role: 'MEMBER' });
      prisma.subscription.findFirst.mockResolvedValue({
        ...subscription,
        ...fields,
      });
      prisma.employeeGrant.findFirst.mockResolvedValue(grant);
      await expect(
        service.detail('sub', 'u', 'client', 'mirror'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.clientTaskMirror.findFirst).not.toHaveBeenCalled();
    },
  );

  it('admin can audit historical subscriptions and departed owners without current membership lookup', async () => {
    prisma.subscription.findFirst.mockResolvedValue({
      ...subscription,
      status: 'EXPIRED',
      endDate: date,
    });
    const result = await service.list(
      'sub',
      'admin',
      query({ userId: 'departed' }),
    );
    expect(result.scope).toBe('enterprise');
    expect(
      prisma.computeUsageRecord.aggregate.mock.calls[0][0].where.userId,
    ).toBe('departed');
    expect(prisma.employeeGrant.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 'DESC'],
    ['desc', 'DESC'],
    ['asc', 'ASC'],
  ])(
    'unifies metadata-only %s sorting and pagination in SQL, not heartbeat time',
    async (order, direction) => {
      const result = await service.list(
        'sub',
        'admin',
        query({
          order,
          page: 3,
          limit: 5,
          from: '2026-10-09',
          to: '2026-10-10',
        }),
      );
      const call = prisma.$queryRaw.mock.calls[0][0];
      const text = sqlText([call]);
      expect(text).toContain('UNION ALL');
      expect(text).toContain('GROUP BY m.id');
      const ordering = `ORDER BY "usedAt" ${direction}, source ASC, "recordId" ${direction}`;
      expect(text.split(ordering)).toHaveLength(3);
      expect(text).toContain(`SELECT * FROM records ${ordering}`);
      expect(text).toContain(`${ordering}) FROM page`);
      expect(text).toContain('LIMIT ? OFFSET ?');
      expect(call.values).toEqual(
        expect.arrayContaining([
          5,
          10,
          new Date('2026-10-08T16:00:00Z'),
          new Date('2026-10-09T16:00:00Z'),
        ]),
      );
      expect(text).toContain('COALESCE(p."completedAt", r."completedAt",');
      expect(text).toContain(
        'COALESCE(p."startedAt", r."startedAt", r."queuedAt") < ?',
      );
      expect(text).toContain('activity."usedAt" < ?');
      expect(text).not.toMatch(
        /updatedAt|lastHeartbeatAt|msg\.content|b\."messageId"/,
      );
      expect(result.coverage.legacyClientTaskCount).toBe(1);
      expect(prisma.$transaction.mock.calls[0][1]).toEqual({
        isolationLevel: 'RepeatableRead',
      });
    },
  );

  const clientPeriodSql = (call: any, memberOptions = false) => {
    const text = sqlText(call).replace(/\s+/g, ' ');
    const client = text.slice(
      text.indexOf('WHERE m."enterpriseId"'),
      text.indexOf(memberOptions ? ' UNION ' : ' GROUP BY m.id'),
    );
    return client.slice(client.indexOf('AND ( (TRUE'));
  };

  it('includes UTC+8 midnight crossings and intermediate long-task days by interval overlap in both queries', async () => {
    await service.list(
      'sub',
      'admin',
      query({ from: '2026-10-09', to: '2026-10-10' }),
    );
    const listCall = prisma.$queryRaw.mock.calls[0];
    const membersCall = prisma.$queryRaw.mock.calls[1];
    const period = clientPeriodSql(listCall);
    expect(period).toBe(clientPeriodSql(membersCall, true));
    // The end, not the start, must reach the day's lower bound; neither endpoint needs to be inside it.
    expect(period).toContain('COALESCE(p."completedAt", r."completedAt",');
    expect(period).toContain('END) > ?');
    expect(period).toContain(
      'AND COALESCE(p."startedAt", r."startedAt", r."queuedAt") < ?',
    );
    expect(period).toContain(
      'OR COALESCE(p."startedAt", r."startedAt", r."queuedAt") >= ?',
    );
    expect(period).not.toContain('r."queuedAt") BETWEEN');
    for (const [call, count] of [
      [listCall, 4],
      [membersCall, 5],
    ] as const) {
      for (const boundary of ['2026-10-08T16:00:00Z', '2026-10-09T16:00:00Z']) {
        expect(
          call[0].values.filter(
            (value) =>
              value instanceof Date &&
              value.getTime() === new Date(boundary).getTime(),
          ),
        ).toHaveLength(count + (boundary === '2026-10-08T16:00:00Z' ? 1 : 0));
      }
    }
  });

  it('bounds unfinished intervals at query time and does not treat terminal missing timestamps as forever active', async () => {
    await service.list('sub', 'admin', query({ from: '2026-10-09' }));
    const period = clientPeriodSql(prisma.$queryRaw.mock.calls[0]);
    expect(period).toBe(clientPeriodSql(prisma.$queryRaw.mock.calls[1], true));
    expect(period).toContain(
      "CASE WHEN p.status IN ('QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'PAUSED', 'INTERRUPTED') AND r.status IN ('QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'PAUSED', 'INTERRUPTED') THEN CURRENT_TIMESTAMP ELSE COALESCE(p.\"startedAt\", r.\"startedAt\", r.\"queuedAt\") END) > ?",
    );
    expect(period).not.toMatch(/IS NULL|updatedAt|lastHeartbeatAt|infinity/);
  });

  it('matches occurredAt only on the proven participation, mirror and run, never another employee or unassigned event', async () => {
    await service.list(
      'sub',
      'admin',
      query({ from: '2026-10-09', to: '2026-10-10' }),
    );
    for (const [index, options] of [
      [0, false],
      [1, true],
    ] as const) {
      const call = prisma.$queryRaw.mock.calls[index];
      const period = clientPeriodSql(call, options);
      expect(period).toContain(
        'OR EXISTS ( SELECT 1 FROM client_task_mirror_events e WHERE e."participationId" = p.id AND e."mirrorId" = p."mirrorId" AND e."clientRunId" = p."clientRunId" AND e."occurredAt" >= ? AND e."occurredAt" < ?',
      );
      expect(period).not.toMatch(/e\."createdAt"|e\.message|COALESCE\(e\./);
      const proof = sqlText(call);
      expect(proof).toContain('p."subscriptionId" = ?');
      expect(proof).toContain('p."employeeId" = ?');
      expect(proof).toContain('r."protocolVersion" >= 2');
      expect(proof).toContain(
        'r.id = p."runId" AND r."mirrorId" = p."mirrorId" AND r."clientRunId" = p."clientRunId"',
      );
      expect(call[0].values).toEqual(
        expect.arrayContaining(['ent', 'sub', 'employee']),
      );
    }
  });

  it.each([{ from: '2026-10-09' }, { to: '2026-10-10' }])(
    'uses the same one-sided client window %j in list and members',
    async (input) => {
      await service.list('sub', 'admin', query(input));
      const period = clientPeriodSql(prisma.$queryRaw.mock.calls[0]);
      expect(period).toBe(
        clientPeriodSql(prisma.$queryRaw.mock.calls[1], true),
      );
      if ('from' in input) {
        expect(period).toContain('END) > ?');
        expect(period).toContain('e."occurredAt" >= ?');
        expect(period).not.toContain('< ?');
      } else {
        expect(period).toContain('r."queuedAt") < ?');
        expect(period).toContain('e."occurredAt" < ?');
        expect(period).not.toContain('>= ?');
      }
    },
  );

  it('excludes executions ending exactly at from while including starts and attributed events at from', async () => {
    await service.list(
      'sub',
      'admin',
      query({ from: '2026-10-09', to: '2026-10-10' }),
    );
    for (const [index, options] of [
      [0, false],
      [1, true],
    ] as const) {
      const period = clientPeriodSql(
        prisma.$queryRaw.mock.calls[index],
        options,
      );
      expect(period).toContain(
        'END) > ? OR COALESCE(p."startedAt", r."startedAt", r."queuedAt") >= ?)',
      );
      expect(period).not.toContain('END) >= ?');
      expect(period).toContain('r."queuedAt") < ?');
      expect(period).toContain('e."occurredAt" >= ? AND e."occurredAt" < ?');
    }
  });

  it('does not scan v2 participation events when no business period is selected', async () => {
    await service.list('sub', 'admin', query());
    for (const call of prisma.$queryRaw.mock.calls.slice(0, 2)) {
      expect(sqlText(call)).not.toContain('e."participationId" = p.id');
      expect(sqlText(call)).toContain("e.type = 'user_input'");
    }
  });

  it('list proves all billing rows, including old/null/mixed ownership, before including a Web session', async () => {
    await service.list(
      'sub',
      'admin',
      query({ source: 'web-task', userId: 'u', from: '2026-10-09' }),
    );
    const text = sqlText(prisma.$queryRaw.mock.calls[0]);
    expect(text).toContain("AND s.source = 'TASK'");
    expect(text).not.toContain('client_task_participations');
    const proof = text.slice(
      text.indexOf('AND NOT EXISTS'),
      text.indexOf('AND s.source IN'),
    );
    expect(proof).toContain('b."enterpriseId" IS DISTINCT FROM ?');
    expect(proof).toContain('b."subscriptionId" IS DISTINCT FROM ?');
    expect(proof).toContain('b."employeeId" IS DISTINCT FROM s."employeeId"');
    expect(proof).toContain('b."userId" IS DISTINCT FROM s."userId"');
    expect(proof).not.toMatch(/createdAt|LIMIT|gte|BETWEEN/);
  });

  it('independent consumption uses the same tenant/subscription/employee/user and half-open time window', async () => {
    const result = await service.list(
      'sub',
      'admin',
      query({
        source: 'client',
        userId: 'u',
        from: '2026-10-09',
        to: '2026-10-10',
      }),
    );
    expect(prisma.computeUsageRecord.aggregate.mock.calls[0][0].where).toEqual({
      enterpriseId: 'ent',
      subscriptionId: 'sub',
      employeeId: 'employee',
      userId: 'u',
      createdAt: {
        gte: new Date('2026-10-08T16:00:00Z'),
        lt: new Date('2026-10-09T16:00:00Z'),
      },
    });
    expect(result.modelConsumption).toMatchObject({
      callCount: 2,
      totalTokens: 120,
      costCNY: 0.3,
      sourceFilterApplied: false,
      taskCostAttribution: 'unknown',
    });
  });

  it('admin member options ignore selected member/source/page and include billed-only owners', async () => {
    const members = [
      { userId: 'selected', userName: 'Selected member' },
      { userId: 'other-page', userName: 'Other page member' },
      { userId: 'ledger-only', userName: null },
    ];
    prisma.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ items: [], total: 0n }])
      .mockResolvedValueOnce(members)
      .mockResolvedValueOnce([{ count: 0n, readableCount: 0n }]);
    const result = await service.list(
      'sub',
      'admin',
      query({ source: 'client', userId: 'selected', page: 2 }),
    );
    const call = prisma.$queryRaw.mock.calls[1][0];
    expect(result.members).toEqual(members);
    expect(call.values).not.toContain('selected');
    const text = sqlText([call]);
    expect(text).toContain('SELECT b."userId" FROM compute_usage_records b');
    expect(text).toContain('b."enterpriseId" = ? AND b."subscriptionId" = ?');
    expect(text).toContain('b."employeeId" = ?');
    expect(text).toContain('IS DISTINCT FROM');
    expect(text).not.toMatch(/LIMIT|OFFSET|AND [msb]\."userId" =/);
    expect(call.values).toEqual(
      expect.arrayContaining(['ent', 'sub', 'employee']),
    );
  });

  it('member options retain the selected business time range across every source', async () => {
    await service.list(
      'sub',
      'admin',
      query({
        userId: 'selected',
        source: 'web-task',
        from: '2026-10-09',
        to: '2026-10-10',
      }),
    );
    const call = prisma.$queryRaw.mock.calls[1][0];
    expect(call.values).not.toContain('selected');
    for (const boundary of ['2026-10-08T16:00:00Z', '2026-10-09T16:00:00Z']) {
      expect(
        call.values.filter(
          (value) =>
            value instanceof Date &&
            value.getTime() === new Date(boundary).getTime(),
        ),
      ).toHaveLength(boundary === '2026-10-08T16:00:00Z' ? 6 : 5);
    }
    expect(sqlText([call])).not.toContain("AND s.source = 'TASK'");
    expect(sqlText([call])).toContain('b."userId" IS NOT NULL');
  });

  it('empty ledger aggregates represent no model consumption, not a task cost', async () => {
    prisma.computeUsageRecord.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { inputTokens: null, outputTokens: null, costCNY: null },
    });
    const result = await service.list('sub', 'admin', query());
    expect(result.modelConsumption).toEqual({
      callCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costCNY: 0,
      basis: 'compute-usage-ledger',
      sourceFilterApplied: false,
      taskCostAttribution: 'unknown',
    });
  });

  it.each([
    'mixed-enterprise',
    'mixed-subscription',
    'mixed-employee',
    'mixed-owner',
    'null-attribution',
    'unbilled',
    'deleted-session',
    'wrong-source',
  ])('%s Web record fails complete proof and never reads body', async () => {
    prisma.$queryRaw.mockReset().mockResolvedValue([]);
    await expect(
      service.detail('sub', 'admin', 'web-conversation', 'session'),
    ).rejects.toThrow(NotFoundException);
    const text = sqlText(prisma.$queryRaw.mock.calls[0]);
    expect(text).toContain('IS DISTINCT FROM');
    expect(text).toContain('AND EXISTS');
    expect(text).toContain('s.source = ?::"ConversationSource"');
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('reads strictly proven colleague Web messages only after proof, with safe fields and stable ordering', async () => {
    prisma.$queryRaw.mockReset().mockResolvedValue([
      {
        id: 'session',
        title: 'Title',
        userId: 'colleague',
        employeeId: 'employee',
        createdAt: date,
        source: 'TASK',
      },
    ]);
    prisma.message.findMany.mockResolvedValue([
      { id: 'message', role: 'ASSISTANT', content: 'text', createdAt: date },
    ]);
    const result = await service.detail('sub', 'admin', 'web-task', 'session');
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.message.findMany.mock.invocationCallOrder[0],
    );
    expect(prisma.message.findMany.mock.calls[0][0]).toEqual({
      where: {
        sessionId: 'session',
        session: { userId: 'colleague', employeeId: 'employee' },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, role: true, content: true, createdAt: true },
    });
    expect(result).toMatchObject({
      messages: [{ createdAt: date.toISOString() }],
      coverage: { taskCost: 'unknown' },
    });
    expect(audit.record).toHaveBeenCalledWith({
      actorId: 'admin',
      enterpriseId: 'ent',
      action: 'subscription.usage-record.read',
      resourceType: 'subscription',
      resourceId: 'sub',
      metadata: { source: 'web-task', recordId: 'session' },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('text');
  });

  it('withholds admin body response when read auditing fails', async () => {
    prisma.$queryRaw.mockReset().mockResolvedValue([
      {
        id: 'session',
        title: 'Title',
        userId: 'colleague',
        employeeId: 'employee',
        createdAt: date,
        source: 'CHAT',
      },
    ]);
    audit.record.mockRejectedValue(new Error('database unavailable'));
    await expect(
      service.detail('sub', 'admin', 'web-conversation', 'session'),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('members can read proven self messages without admin auditing', async () => {
    context.resolve.mockResolvedValue({ ...ctx, role: 'MEMBER' });
    prisma.$queryRaw.mockReset().mockResolvedValue([
      {
        id: 'session',
        title: null,
        userId: 'u',
        employeeId: 'employee',
        createdAt: date,
        source: 'CHAT',
      },
    ]);
    await service.detail('sub', 'u', 'web-conversation', 'session');
    expect(audit.record).not.toHaveBeenCalled();
    expect(prisma.message.findMany.mock.calls[0][0].where.session.userId).toBe(
      'u',
    );
  });

  it('member Web proof is self-scoped even when record belongs to a colleague', async () => {
    context.resolve.mockResolvedValue({ ...ctx, role: 'MEMBER' });
    prisma.$queryRaw.mockReset().mockResolvedValue([]);
    await expect(
      service.detail('sub', 'u', 'web-task', 'session'),
    ).rejects.toThrow(NotFoundException);
    expect(sqlText(prisma.$queryRaw.mock.calls[0])).toContain(
      'AND s."userId" = ?',
    );
    expect(prisma.$queryRaw.mock.calls[0][0].values).toContain('u');
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  const participation = (
    id: string,
    clientRunId: string,
    executionId = id,
  ) => ({
    id,
    clientRunId,
    executionId,
    nodeId: 'repeated-node',
    title: 'Node',
    subscriptionId: 'sub',
    employeeId: 'employee',
    employeeName: 'Employee',
    subscriptionName: 'Subscription',
    status: 'COMPLETED',
    startedAt: date,
    completedAt: date,
    createdAt: date,
    run: {
      clientRunId,
      queuedAt: date,
      taskType: 'arrangement',
      protocolVersion: 2,
    },
  });
  it('client detail excludes other subscriptions, legacy and unassigned events; repeated executions stay distinct', async () => {
    prisma.clientTaskParticipation.findMany.mockResolvedValue([
      participation('p1', 'r1'),
      participation('p2', 'r1'),
      participation('p3', 'r2'),
    ]);
    prisma.clientTaskMirrorEvent.findMany.mockResolvedValue([
      {
        id: 'e1',
        participationId: 'p1',
        clientRunId: 'r1',
        sequence: 1,
        type: 'INPUT',
        stepKey: null,
        message: 'first',
        occurredAt: date,
        createdAt: date,
      },
      {
        id: 'e2',
        participationId: 'p2',
        clientRunId: 'r1',
        sequence: 2,
        type: 'OUTPUT',
        stepKey: null,
        message: 'second',
        occurredAt: null,
        createdAt: date,
      },
      {
        id: 'unassigned',
        participationId: null,
        clientRunId: 'r1',
        sequence: 3,
        message: 'legacy',
      },
      {
        id: 'foreign',
        participationId: 'foreign',
        clientRunId: 'r2',
        sequence: 4,
        message: 'foreign',
      },
    ]);
    const result: any = await service.detail(
      'sub',
      'admin',
      'client',
      'mirror',
    );
    expect(
      prisma.clientTaskMirror.findFirst.mock.calls[0][0].where,
    ).toMatchObject({
      id: 'mirror',
      enterpriseId: 'ent',
      participations: {
        some: {
          subscriptionId: 'sub',
          employeeId: 'employee',
          run: { protocolVersion: { gte: 2 } },
        },
      },
    });
    expect(
      prisma.clientTaskMirrorEvent.findMany.mock.calls[0][0].where,
    ).toEqual({
      mirrorId: 'mirror',
      OR: [
        { participationId: 'p1', clientRunId: 'r1' },
        { participationId: 'p2', clientRunId: 'r1' },
        { participationId: 'p3', clientRunId: 'r2' },
      ],
    });
    expect(result.runs).toHaveLength(2);
    expect(result.runs[0].participations.map((p) => p.executionId)).toEqual([
      'p1',
      'p2',
    ]);
    expect(result.runs[0].participations[0].events[0].message).toBe('first');
    expect(JSON.stringify(result)).not.toMatch(/foreign|legacy"/);
  });

  it('unknown/foreign/legacy client record is rejected before events', async () => {
    prisma.clientTaskMirror.findFirst.mockResolvedValue(null);
    await expect(
      service.detail('sub', 'admin', 'client', 'mirror'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.clientTaskParticipation.findMany).not.toHaveBeenCalled();
    expect(prisma.clientTaskMirrorEvent.findMany).not.toHaveBeenCalled();
  });

  it('inconsistent run identifiers fail closed before events', async () => {
    prisma.clientTaskParticipation.findMany.mockResolvedValue([
      { ...participation('p1', 'r1'), run: { clientRunId: 'r2' } },
    ]);
    await expect(
      service.detail('sub', 'admin', 'client', 'mirror'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.clientTaskMirrorEvent.findMany).not.toHaveBeenCalled();
  });

  it('member client detail scopes mirror owner and never reads a colleague body', async () => {
    context.resolve.mockResolvedValue({ ...ctx, role: 'DEPT_MANAGER' });
    prisma.clientTaskMirror.findFirst.mockResolvedValue(null);
    await expect(
      service.detail('sub', 'u', 'client', 'mirror'),
    ).rejects.toThrow(NotFoundException);
    expect(
      prisma.clientTaskMirror.findFirst.mock.calls[0][0].where.userId,
    ).toBe('u');
    expect(prisma.clientTaskMirrorEvent.findMany).not.toHaveBeenCalled();
  });

  const normalizedSql = (call: any) => sqlText(call).replace(/\s+/g, ' ');
  const legacyProof = (text: string) => {
    const start = text.indexOf(
      'm."enterpriseId" = ?',
      text.indexOf('legacy_activity'),
    );
    return text.slice(
      start,
      text.indexOf('p."mirrorId" = m.id)', start) +
        'p."mirrorId" = m.id)'.length,
    );
  };

  it.each([
    [undefined, true, true, true],
    ['client', true, true, false],
    ['client-legacy', false, true, false],
    ['web-conversation', false, false, true],
    ['web-task', false, false, true],
  ])(
    'selects %s sources before unified counting/pagination',
    async (source, v2, legacy, web) => {
      await service.list('sub', 'admin', query({ source, page: 2, limit: 3 }));
      const call = prisma.$queryRaw.mock.calls[0];
      const text = normalizedSql(call);
      expect(text.includes("SELECT 'client'::text AS source")).toBe(v2);
      expect(text.includes("SELECT 'client-legacy'::text AS source")).toBe(
        legacy,
      );
      expect(text.includes('FROM conversation_sessions s')).toBe(web);
      expect(text.match(/UNION ALL/g) ?? []).toHaveLength(
        Number(v2) + Number(legacy) + Number(web) - 1,
      );
      expect(text).toContain('WITH records AS (');
      expect(text).toContain('SELECT count(*) FROM records');
      expect(text).toContain('LIMIT ? OFFSET ?');
      expect(call[0].values.slice(-2)).toEqual([3, 3]);
      // Source filtering remains unrelated to ledger consumption.
      expect(
        prisma.computeUsageRecord.aggregate.mock.calls[0][0].where,
      ).toEqual({
        enterpriseId: 'ent',
        subscriptionId: 'sub',
        employeeId: 'employee',
});
    },
  );

  it('shares all-time legacy eligibility across list, member options and readable coverage', async () => {
    context.resolve.mockResolvedValue({ ...ctx, role: 'MEMBER' });
    prisma.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ items: [], total: 0n }])
      .mockResolvedValueOnce([{ userId: 'u', userName: 'User' }])
      .mockResolvedValueOnce([{ count: 7n, readableCount: 2n }]);
    const result = await service.list(
      'sub',
      'u',
      query({
        source: 'client-legacy',
        from: '2026-10-09',
        to: '2026-10-10',
      }),
    );
    const [list, members, coverage] =
      prisma.$queryRaw.mock.calls.map(normalizedSql);
    const proof = legacyProof(list);
    expect(proof).toBe(legacyProof(members));
    expect(coverage).toContain(proof);
    expect(proof).toContain(
      'm."enterpriseId" = ? AND m."subscriptionId" = ? AND m."userId" = ?',
    );
    expect(proof).toContain(
      `m."protocolVersion" < 2 AND m."taskType" = 'conversation'`,
    );
    expect(proof).toContain(
      'NOT EXISTS (SELECT 1 FROM client_task_mirror_runs r WHERE r."mirrorId" = m.id)',
    );
    expect(proof).toContain(
      'NOT EXISTS (SELECT 1 FROM client_task_participations p WHERE p."mirrorId" = m.id)',
    );
    // Neither anti-join may narrow to a run/subscription/protocol and hide mixed data.
    expect(proof).not.toMatch(
      /r\."(?:subscriptionId|protocolVersion|clientRunId)"|p\."(?:subscriptionId|clientRunId)"/,
    );
    for (const index of [0, 1, 2]) {
      expect(prisma.$queryRaw.mock.calls[index][0].values).toEqual(
        expect.arrayContaining(['ent', 'sub', 'u']),
      );
    }
    expect(coverage).not.toMatch(
      /usedAt|startedAt|occurredAt|queuedAt|createdAt/,
    );
    expect(
      prisma.$queryRaw.mock.calls[2][0].values.some((v) => v instanceof Date),
    ).toBe(false);
    expect(result.coverage).toMatchObject({
      legacyClientTaskCount: 7,
      readableLegacyClientTaskCount: 2,
      legacyCountScope: 'subscription-and-user-all-time',
    });
    expect(result.coverage.limitations).toContain('legacy-time-provenance-unverified');
    // Preserve the wider historical count, including old runs linked to this subscription.
    expect(coverage).toContain(
      'OR EXISTS (SELECT 1 FROM client_task_mirror_runs r',
    );
    expect(coverage).toContain(
      'r."subscriptionId" = ? AND r."protocolVersion" < 2',
    );
  });

  it('uses current null-participation input time and the same half-open legacy window for list/members', async () => {
    await service.list(
      'sub',
      'admin',
      query({ source: 'client-legacy', from: '2026-10-09', to: '2026-10-10' }),
    );
    for (const call of prisma.$queryRaw.mock.calls.slice(0, 2)) {
      const text = normalizedSql(call);
      expect(text).toContain('SELECT min(e."occurredAt") AS "inputAt"');
      expect(text).toContain(
        `e."mirrorId" = m.id AND e."clientRunId" = m."clientRunId" AND e."participationId" IS NULL AND e.type = 'user_input'`,
      );
      expect(text).toContain(
        'COALESCE(m."startedAt", legacy_input."inputAt", m."queuedAt", m."createdAt") AS "usedAt"',
      );
      expect(text).toContain(
        `WHEN m."startedAt" IS NOT NULL THEN 'legacy-started'`,
      );
      expect(text).toContain(
        `WHEN legacy_input."inputAt" IS NOT NULL THEN 'legacy-input'`,
      );
      expect(text).toContain(
        `WHEN m."queuedAt" IS NOT NULL THEN 'legacy-queued' ELSE 'legacy-received'`,
      );
      expect(text).toContain(
        'legacy_activity."usedAt" >= ? AND legacy_activity."usedAt" < ?',
      );
      expect(call[0].values).toEqual(
        expect.arrayContaining([
          new Date('2026-10-08T16:00:00Z'),
          new Date('2026-10-09T16:00:00Z'),
        ]),
      );
      expect(text).not.toMatch(/lastHeartbeatAt|updatedAt|e\.message/);
    }
  });

  const legacyMirror = {
    id: 'mirror',
    clientTaskId: 'old-task',
    title: 'Old conversation',
    userId: 'u',
    clientRunId: 'current-run',
    status: 'COMPLETED',
    queuedAt: date,
    startedAt: null,
    completedAt: date,
    createdAt: new Date('2026-10-09T08:00:00Z'),
  };
  const legacyEvent = (fields: Record<string, unknown> = {}) => ({
    id: 'input',
    participationId: null,
    clientRunId: 'current-run',
    sequence: 1,
    type: 'user_input',
    stepKey: null,
    message: 'historical input',
    progress: null,
    occurredAt: date,
    createdAt: legacyMirror.createdAt,
    ...fields,
  });

  it('legacy detail reads only current-run null-participation input/output inside RepeatableRead', async () => {
    prisma.clientTaskMirror.findFirst.mockResolvedValue(legacyMirror);
    const input = legacyEvent({
      occurredAt: null,
      stepKey: 'content:v1:input:0:2',
    });
    const output = legacyEvent({
      id: 'output',
      sequence: 3,
      type: 'model_output',
      progress: 100,
      message: 'historical output',
      occurredAt: null,
      stepKey: 'content:v1:output:0:2',
    });
    // Include another subscription's mirror sharing the run ID, plus foreign run/node/log events.
    const stored = [
      { mirrorId: 'mirror', event: input },
      { mirrorId: 'mirror', event: output },
      {
        mirrorId: 'other-subscription-mirror',
        event: legacyEvent({ message: 'other subscription secret' }),
      },
      {
        mirrorId: 'mirror',
        event: legacyEvent({
          id: 'other-run', clientRunId: 'prior-run', message: 'other run secret',
        }),
      },
      {
        mirrorId: 'mirror',
        event: legacyEvent({
          id: 'node', participationId: 'foreign-node', message: 'node secret',
        }),
      },
      {
        mirrorId: 'mirror',
        event: legacyEvent({ id: 'log', type: 'status', message: 'log secret' }),
      },
    ];
    prisma.clientTaskMirrorEvent.findMany.mockImplementation(
      async ({ where }) =>
        stored
          .filter(({ mirrorId, event: e }) =>
            mirrorId === where.mirrorId &&
            e.clientRunId === where.clientRunId &&
            e.participationId === where.participationId &&
            where.type.in.includes(e.type),
          )
          .map(({ event }) => event),
    );
    const result = await service.detail(
      'sub',
      'admin',
      'client-legacy',
      'mirror',
    );
    expect(prisma.clientTaskMirror.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'mirror',
        enterpriseId: 'ent',
        subscriptionId: 'sub',
        protocolVersion: { lt: 2 },
        taskType: 'conversation',
        runs: { none: {} },
        participations: { none: {} },
      },
      select: {
        id: true,
        clientTaskId: true,
        title: true,
        userId: true,
        clientRunId: true,
        status: true,
        queuedAt: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
    });
    expect(prisma.clientTaskMirrorEvent.findMany.mock.calls[0][0]).toEqual({
      where: {
        mirrorId: 'mirror',
        clientRunId: 'current-run',
        participationId: null,
        type: { in: ['user_input', 'model_output'] },
      },
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        participationId: true,
        clientRunId: true,
        sequence: true,
        type: true,
        stepKey: true,
        message: true,
        progress: true,
        occurredAt: true,
        createdAt: true,
      },
    });
    expect(result).toMatchObject({
      source: 'client-legacy',
      recordId: 'mirror',
      task: {
        id: 'mirror',
        clientTaskId: 'old-task',
        title: 'Old conversation',
        userId: 'u',
      },
      run: {
        clientRunId: 'current-run',
        status: 'COMPLETED',
        queuedAt: date.toISOString(),
        startedAt: null,
        completedAt: date.toISOString(),
        usedAt: date.toISOString(),
        timeBasis: 'legacy-queued',
      },
      events: [
        {
          id: 'input',
          participationId: null,
          occurredAt: null,
          progress: null,
          stepKey: 'content:v1:input:0:2',
        },
        {
          id: 'output',
          participationId: null,
          occurredAt: null,
          progress: 100,
          sequence: 3,
        },
      ],
      coverage: {
        attribution: 'legacy-root-subscription-unverified',
        currentRunOnly: true,
        taskCost: 'unknown',
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/secret/);
    expect(result).not.toHaveProperty('runs');
    expect(prisma.clientTaskParticipation.findMany).not.toHaveBeenCalled();
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'RepeatableRead',
    });
    expect(audit.record).toHaveBeenCalledWith({
      actorId: 'admin',
      enterpriseId: 'ent',
      action: 'subscription.usage-record.read',
      resourceType: 'subscription',
      resourceId: 'sub',
      metadata: { source: 'client-legacy', recordId: 'mirror' },
    });
  });

  it.each([
    {
      startedAt: new Date('2026-01-04'),
      inputAt: new Date('2026-01-03'),
      queuedAt: new Date('2026-01-02'),
      basis: 'legacy-started',
      usedAt: '2026-01-04',
    },
    {
      startedAt: null,
      inputAt: new Date('2026-01-03'),
      queuedAt: new Date('2026-01-02'),
      basis: 'legacy-input',
      usedAt: '2026-01-03',
    },
    {
      startedAt: null,
      inputAt: null,
      queuedAt: new Date('2026-01-02'),
      basis: 'legacy-queued',
      usedAt: '2026-01-02',
    },
    {
      startedAt: null,
      inputAt: null,
      queuedAt: null,
      basis: 'legacy-received',
      usedAt: '2026-01-05',
    },
  ])(
    'legacy business time precedence $basis matches list SQL',
    async ({ startedAt, inputAt, queuedAt, basis, usedAt }) => {
      prisma.clientTaskMirror.findFirst.mockResolvedValue({
        ...legacyMirror,
        startedAt,
        queuedAt,
        createdAt: new Date('2026-01-05'),
      });
      prisma.clientTaskMirrorEvent.findMany.mockResolvedValue([
        legacyEvent({
          occurredAt: inputAt ? new Date(inputAt.getTime() + 60000) : null,
        }),
        legacyEvent({ id: 'earliest', sequence: 2, occurredAt: inputAt }),
        legacyEvent({
          id: 'output',
          sequence: 3,
          type: 'model_output',
          occurredAt: new Date('2025-01-01'),
        }),
      ]);
      const result = await service.detail(
        'sub',
        'admin',
        'client-legacy',
        'mirror',
      );
      if (result.source !== 'client-legacy')
        throw new Error('unexpected detail source');
      expect(result.run.timeBasis).toBe(basis);
      expect(result.run.usedAt).toBe(new Date(usedAt).toISOString());
      expect(result.events).toHaveLength(3);
    },
  );

  it.each([
    { id: 'other' },
    { enterpriseId: 'foreign' },
    { subscriptionId: 'other' },
    { protocolVersion: 2 },
    { taskType: 'arrangement' },
    { runs: [{ protocolVersion: 1 }] },
    { runs: [{ protocolVersion: 2 }] },
    { participations: [{ subscriptionId: 'other' }] },
    { userId: 'colleague' },
  ])(
    'legacy detail refuses ineligible mirror %j before reading any event',
    async (override) => {
      context.resolve.mockResolvedValue({ ...ctx, role: 'MEMBER' });
      const candidate = {
        ...legacyMirror,
        enterpriseId: 'ent',
        subscriptionId: 'sub',
        protocolVersion: 1,
        taskType: 'conversation',
        runs: [],
        participations: [],
        ...override,
      };
      prisma.clientTaskMirror.findFirst.mockImplementation(
        async ({ where }) => {
          const eligible =
            candidate.id === where.id &&
            candidate.enterpriseId === where.enterpriseId &&
            candidate.subscriptionId === where.subscriptionId &&
            candidate.userId === where.userId &&
            candidate.protocolVersion < where.protocolVersion.lt &&
            candidate.taskType === where.taskType &&
            where.runs.none &&
            candidate.runs.length === 0 &&
            where.participations.none &&
            candidate.participations.length === 0;
          return eligible ? candidate : null;
        },
      );
      await expect(
        service.detail('sub', 'u', 'client-legacy', 'mirror'),
      ).rejects.toThrow(NotFoundException);
      expect(
        prisma.clientTaskMirror.findFirst.mock.calls[0][0].where.userId,
      ).toBe('u');
      expect(prisma.clientTaskMirrorEvent.findMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('checks legacy mirror eligibility and reads events on the same transaction client', async () => {
    const tx = {
      clientTaskMirror: { findFirst: jest.fn().mockResolvedValue(legacyMirror) },
      clientTaskMirrorEvent: { findMany: jest.fn().mockResolvedValue([legacyEvent()]) },
    };
    prisma.$transaction.mockImplementation((read) => read(tx));
    const result = await service.detail('sub', 'admin', 'client-legacy', 'mirror');
    expect(result.source).toBe('client-legacy');
    expect(tx.clientTaskMirror.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.clientTaskMirrorEvent.findMany).toHaveBeenCalledTimes(1);
    expect(tx.clientTaskMirror.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      tx.clientTaskMirrorEvent.findMany.mock.invocationCallOrder[0],
    );
    expect(prisma.clientTaskMirror.findFirst).not.toHaveBeenCalled();
    expect(prisma.clientTaskMirrorEvent.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'RepeatableRead' });
  });

  it('ordinary members read their own legacy body without administrator audit', async () => {
    context.resolve.mockResolvedValue({ ...ctx, role: 'MEMBER' });
    prisma.clientTaskMirror.findFirst.mockResolvedValue(legacyMirror);
    const result = await service.detail('sub', 'u', 'client-legacy', 'mirror');
    expect(result.source).toBe('client-legacy');
    expect(
      prisma.clientTaskMirror.findFirst.mock.calls[0][0].where.userId,
    ).toBe('u');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('legacy administrator body is withheld when audit fails', async () => {
    prisma.clientTaskMirror.findFirst.mockResolvedValue(legacyMirror);
    prisma.clientTaskMirrorEvent.findMany.mockResolvedValue([legacyEvent()]);
    audit.record.mockRejectedValue(new Error('audit unavailable'));
    await expect(
      service.detail('sub', 'admin', 'client-legacy', 'mirror'),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it.each([
    { grant: null, status: 'ACTIVE', endDate: null },
    { grant: { id: 'grant' }, status: 'PAUSED', endDate: null },
    {
      grant: { id: 'grant' },
      status: 'ACTIVE',
      endDate: new Date('2000-01-01'),
    },
  ])(
    'legacy detail uses existing active grant/subscription policy: %j',
    async ({ grant, ...fields }) => {
      context.resolve.mockResolvedValue({ ...ctx, role: 'MEMBER' });
      prisma.subscription.findFirst.mockResolvedValue({
        ...subscription,
        ...fields,
      });
      prisma.employeeGrant.findFirst.mockResolvedValue(grant);
      await expect(
        service.detail('sub', 'u', 'client-legacy', 'mirror'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.clientTaskMirrorEvent.findMany).not.toHaveBeenCalled();
    },
  );
});
