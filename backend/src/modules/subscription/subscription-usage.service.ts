import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SubscriptionUsageQueryDto,
  SubscriptionUsageQueryDtoSchema,
  SubscriptionUsageRecord,
  SubscriptionUsageSource,
  SubscriptionUsageListResponse,
  SubscriptionUsageDetailResponse,
  SubscriptionClientUsageDetail,
  SubscriptionLegacyClientUsageDetail,
  SubscriptionModelConsumption,
} from 'shared';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { AuditService } from '../audit/audit.service';

interface UsageScope {
  enterpriseId: string;
  subscriptionId: string;
  employeeId: string;
  userId?: string;
  scope: 'enterprise' | 'personal';
}

@Injectable()
export class SubscriptionUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: EnterpriseContextService,
    private readonly audit: AuditService,
  ) {}

  private async authorize(
    id: string,
    userId: string,
    requestedUserId?: string,
  ): Promise<UsageScope> {
    const ctx = await this.context.resolve(userId);
    const subscription = await this.prisma.subscription.findFirst({
      where: { id, enterpriseId: ctx.enterpriseId },
      select: { id: true, employeeId: true, status: true, endDate: true },
    });
    if (!subscription) throw new NotFoundException('雇佣关系不存在');
    const admin = ctx.role === 'ENTERPRISE_ADMIN';
    if (!admin) {
      if (requestedUserId && requestedUserId !== userId) {
        throw new ForbiddenException('只能查看本人使用记录');
      }
      const now = new Date();
      const grant = await this.prisma.employeeGrant.findFirst({
        where: {
          subscriptionId: id,
          OR: [
            { memberId: ctx.memberId },
            ...(ctx.departmentId ? [{ departmentId: ctx.departmentId }] : []),
          ],
          AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
        },
        select: { id: true },
      });
      if (
        !grant ||
        subscription.status !== 'ACTIVE' ||
        (subscription.endDate && subscription.endDate <= now)
      ) {
        throw new ForbiddenException('没有有效的员工使用授权');
      }
    }
    return {
      enterpriseId: ctx.enterpriseId,
      subscriptionId: id,
      employeeId: subscription.employeeId,
      userId: admin ? requestedUserId : userId,
      scope: admin ? 'enterprise' : 'personal',
    };
  }

  private timeFilter(
    column: Prisma.Sql,
    query: SubscriptionUsageQueryDto,
  ): Prisma.Sql {
    return Prisma.sql`${query.from ? Prisma.sql`AND ${column} >= ${new Date(query.from)}` : Prisma.empty}
      ${query.to ? Prisma.sql`AND ${column} < ${new Date(query.to)}` : Prisma.empty}`;
  }

  private clientTimeFilter(query: SubscriptionUsageQueryDto): Prisma.Sql {
    if (!query.from && !query.to) return Prisma.empty;
    const start = Prisma.sql`COALESCE(p."startedAt", r."startedAt", r."queuedAt")`;
    // Missing completion is ongoing only for nonterminal executions, never heartbeat-derived.
    const end = Prisma.sql`COALESCE(p."completedAt", r."completedAt",
      CASE WHEN p.status IN ('QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'PAUSED')
        AND r.status IN ('QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'PAUSED')
        THEN CURRENT_TIMESTAMP ELSE ${start} END)`;
    // End equality is not overlap, but an instantaneous/fallback start at from is still usage.
    return Prisma.sql`AND (
      (TRUE
        ${query.from ? Prisma.sql`AND (${end} > ${new Date(query.from)} OR ${start} >= ${new Date(query.from)})` : Prisma.empty}
        ${query.to ? Prisma.sql`AND ${start} < ${new Date(query.to)}` : Prisma.empty})
      OR EXISTS (
        SELECT 1 FROM client_task_mirror_events e
        WHERE e."participationId" = p.id AND e."mirrorId" = p."mirrorId"
          AND e."clientRunId" = p."clientRunId"
          ${this.timeFilter(Prisma.sql`e."occurredAt"`, query)}
      )
    )`;
  }

  // Legacy attribution is limited to a root conversation with no run/node data at all.
  private legacyClientProof(scope: UsageScope): Prisma.Sql {
    return Prisma.sql`m."enterpriseId" = ${scope.enterpriseId}
      AND m."subscriptionId" = ${scope.subscriptionId}
      ${scope.userId ? Prisma.sql`AND m."userId" = ${scope.userId}` : Prisma.empty}
      AND m."protocolVersion" < 2 AND m."taskType" = 'conversation'
      AND NOT EXISTS (SELECT 1 FROM client_task_mirror_runs r WHERE r."mirrorId" = m.id)
      AND NOT EXISTS (SELECT 1 FROM client_task_participations p WHERE p."mirrorId" = m.id)`;
  }

  private legacyClientActivity(): Prisma.Sql {
    return Prisma.sql`CROSS JOIN LATERAL (
      SELECT min(e."occurredAt") AS "inputAt" FROM client_task_mirror_events e
      WHERE e."mirrorId" = m.id AND e."clientRunId" = m."clientRunId"
        AND e."participationId" IS NULL AND e.type = 'user_input'
    ) legacy_input
    CROSS JOIN LATERAL (
      SELECT COALESCE(m."startedAt", legacy_input."inputAt", m."queuedAt", m."createdAt") AS "usedAt",
        CASE WHEN m."startedAt" IS NOT NULL THEN 'legacy-started'
          WHEN legacy_input."inputAt" IS NOT NULL THEN 'legacy-input'
          WHEN m."queuedAt" IS NOT NULL THEN 'legacy-queued'
          ELSE 'legacy-received' END::text AS "timeBasis"
    ) legacy_activity`;
  }

  // Compare every bill, without time/user filters: an old conflicting bill also invalidates a session.
  private webProof(scope: UsageScope): Prisma.Sql {
    return Prisma.sql`
      s."employeeId" = ${scope.employeeId}
      ${scope.userId ? Prisma.sql`AND s."userId" = ${scope.userId}` : Prisma.empty}
      AND EXISTS (SELECT 1 FROM compute_usage_records b WHERE b."sessionId" = s.id)
      AND NOT EXISTS (
        SELECT 1 FROM compute_usage_records b WHERE b."sessionId" = s.id AND (
          b."enterpriseId" IS DISTINCT FROM ${scope.enterpriseId}
          OR b."subscriptionId" IS DISTINCT FROM ${scope.subscriptionId}
          OR b."employeeId" IS DISTINCT FROM s."employeeId"
          OR b."userId" IS DISTINCT FROM s."userId"
        )
      )`;
  }

  async list(
    id: string,
    userId: string,
    input: SubscriptionUsageQueryDto,
  ): Promise<SubscriptionUsageListResponse> {
    const query = SubscriptionUsageQueryDtoSchema.parse(input);
    const scope = await this.authorize(id, userId, query.userId);
    return this.prisma.$transaction(
      async (tx) => {
        const client = Prisma.sql`
        SELECT 'client'::text AS source, m.id AS "recordId", m.title,
          (array_agg(r."taskType" ORDER BY COALESCE(p."startedAt", r."queuedAt") DESC, p.id DESC))[1] AS "taskType",
          (array_agg(p.status ORDER BY COALESCE(p."startedAt", r."queuedAt") DESC, p.id DESC))[1] AS status,
          m."userId", u.name AS "userName",
          max(COALESCE(p."startedAt", r."queuedAt")) AS "usedAt",
          'participation-start-or-run-queued'::text AS "timeBasis"
        FROM client_task_participations p
        JOIN client_task_mirror_runs r ON r.id = p."runId" AND r."mirrorId" = p."mirrorId" AND r."clientRunId" = p."clientRunId"
        JOIN client_task_mirrors m ON m.id = p."mirrorId"
        LEFT JOIN users u ON u.id = m."userId"
        WHERE m."enterpriseId" = ${scope.enterpriseId} AND p."subscriptionId" = ${id}
          AND p."employeeId" = ${scope.employeeId} AND r."protocolVersion" >= 2
          ${scope.userId ? Prisma.sql`AND m."userId" = ${scope.userId}` : Prisma.empty}
          ${this.clientTimeFilter(query)}
        GROUP BY m.id, m.title, m."userId", u.name`;
        const legacyClient = Prisma.sql`
        SELECT 'client-legacy'::text AS source, m.id AS "recordId", m.title,
          m."taskType", m.status, m."userId", u.name AS "userName",
          legacy_activity."usedAt", legacy_activity."timeBasis"
        FROM client_task_mirrors m
        LEFT JOIN users u ON u.id = m."userId"
        ${this.legacyClientActivity()}
        WHERE ${this.legacyClientProof(scope)}
          ${this.timeFilter(Prisma.sql`legacy_activity."usedAt"`, query)}`;
        const web = Prisma.sql`
        SELECT CASE WHEN s.source = 'TASK' THEN 'web-task' ELSE 'web-conversation' END::text AS source,
          s.id AS "recordId", s.title, s.source::text AS "taskType", s.status::text AS status,
          s."userId", u.name AS "userName", activity."usedAt",
          'last-message-or-session-created'::text AS "timeBasis"
        FROM conversation_sessions s
        LEFT JOIN users u ON u.id = s."userId"
        CROSS JOIN LATERAL (
          SELECT COALESCE(max(msg."createdAt"), s."createdAt") AS "usedAt"
          FROM messages msg WHERE msg."sessionId" = s.id
        ) activity
        WHERE ${this.webProof(scope)}
          AND s.source IN ('CHAT', 'TASK')
          ${query.source === 'web-task' ? Prisma.sql`AND s.source = 'TASK'` : Prisma.empty}
          ${query.source === 'web-conversation' ? Prisma.sql`AND s.source = 'CHAT'` : Prisma.empty}
          ${this.timeFilter(Prisma.sql`activity."usedAt"`, query)}`;
        const candidates =
          query.source === 'client'
            ? Prisma.sql`${client} UNION ALL ${legacyClient}`
            : query.source === 'client-legacy'
              ? legacyClient
              : query.source
                ? web
                : Prisma.sql`${client} UNION ALL ${legacyClient} UNION ALL ${web}`;
        const ordering =
          query.order === 'asc'
            ? Prisma.sql`"usedAt" ASC, source ASC, "recordId" ASC`
            : Prisma.sql`"usedAt" DESC, source ASC, "recordId" DESC`;
        const [result] = await tx.$queryRaw<
          Array<{ items: SubscriptionUsageRecord[]; total: bigint }>
        >(Prisma.sql`
        WITH records AS (${candidates}), page AS (
          SELECT * FROM records ORDER BY ${ordering}
          LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
        )
        SELECT (SELECT count(*) FROM records) AS total,
          COALESCE((SELECT jsonb_agg(to_jsonb(page) || jsonb_build_object('usedAt',
            to_char("usedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
            ORDER BY ${ordering}) FROM page), '[]'::jsonb) AS items`);
        const modelConsumption = await this.modelConsumption(tx, scope, query);
        const members = await this.memberOptions(tx, scope, query);
        const [legacy] = await tx.$queryRaw<
          Array<{ count: bigint; readableCount: bigint }>
        >(Prisma.sql`
        SELECT count(*) AS count,
          count(*) FILTER (WHERE ${this.legacyClientProof(scope)}) AS "readableCount"
        FROM client_task_mirrors m
        WHERE m."enterpriseId" = ${scope.enterpriseId}
          ${scope.userId ? Prisma.sql`AND m."userId" = ${scope.userId}` : Prisma.empty}
          AND ((m."subscriptionId" = ${id} AND m."protocolVersion" < 2)
            OR EXISTS (SELECT 1 FROM client_task_mirror_runs r WHERE r."mirrorId" = m.id
              AND r."subscriptionId" = ${id} AND r."protocolVersion" < 2))`);
        return {
          items: result.items,
          members,
          total: Number(result.total),
          page: query.page,
          limit: query.limit,
          scope: scope.scope,
          period: {
            from: query.from ?? null,
            to: query.to ?? null,
            timezone: 'Asia/Shanghai',
            bounds: '[from,to)',
          },
          modelConsumption,
          coverage: {
            preciseClientProtocolMin: 2,
            legacyClientTaskCount: Number(legacy.count),
            readableLegacyClientTaskCount: Number(legacy.readableCount),
            legacyCountScope: 'subscription-and-user-all-time',
            web: 'strict-billing-session-owner-proof-only',
            limitations: [
              'legacy-client-attribution-unverified',
              'legacy-time-provenance-unverified',
              'unbilled-mixed-or-deleted-web-sessions-excluded',
              'task-cost-unattributed',
            ],
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async memberOptions(
    tx: Prisma.TransactionClient,
    scope: UsageScope,
    query: SubscriptionUsageQueryDto,
  ) {
    const optionsScope = {
      ...scope,
      userId: scope.scope === 'enterprise' ? undefined : scope.userId,
    };
    return tx.$queryRaw<
      Array<{ userId: string; userName: string | null }>
    >(Prisma.sql`
      WITH owners AS (
        SELECT m."userId" FROM client_task_participations p
        JOIN client_task_mirror_runs r ON r.id = p."runId" AND r."mirrorId" = p."mirrorId" AND r."clientRunId" = p."clientRunId"
        JOIN client_task_mirrors m ON m.id = p."mirrorId"
        WHERE m."enterpriseId" = ${scope.enterpriseId} AND p."subscriptionId" = ${scope.subscriptionId}
          AND p."employeeId" = ${scope.employeeId} AND r."protocolVersion" >= 2
          ${optionsScope.userId ? Prisma.sql`AND m."userId" = ${optionsScope.userId}` : Prisma.empty}
          ${this.clientTimeFilter(query)}
        UNION
        SELECT m."userId" FROM client_task_mirrors m
        ${this.legacyClientActivity()}
        WHERE ${this.legacyClientProof(optionsScope)}
          ${this.timeFilter(Prisma.sql`legacy_activity."usedAt"`, query)}
        UNION
        SELECT s."userId" FROM conversation_sessions s
        CROSS JOIN LATERAL (
          SELECT COALESCE(max(msg."createdAt"), s."createdAt") AS "usedAt"
          FROM messages msg WHERE msg."sessionId" = s.id
        ) activity
        WHERE ${this.webProof(optionsScope)} AND s.source IN ('CHAT', 'TASK')
          ${this.timeFilter(Prisma.sql`activity."usedAt"`, query)}
        UNION
        SELECT b."userId" FROM compute_usage_records b
        WHERE b."enterpriseId" = ${scope.enterpriseId} AND b."subscriptionId" = ${scope.subscriptionId}
          AND b."employeeId" = ${scope.employeeId} AND b."userId" IS NOT NULL
          ${optionsScope.userId ? Prisma.sql`AND b."userId" = ${optionsScope.userId}` : Prisma.empty}
          ${this.timeFilter(Prisma.sql`b."createdAt"`, query)}
      )
      SELECT owners."userId", u.name AS "userName" FROM owners
      LEFT JOIN users u ON u.id = owners."userId"
      ORDER BY u.name ASC NULLS LAST, owners."userId" ASC`);
  }

  private async modelConsumption(
    tx: Prisma.TransactionClient,
    scope: UsageScope,
    query: SubscriptionUsageQueryDto,
  ): Promise<SubscriptionModelConsumption> {
    const result = await tx.computeUsageRecord.aggregate({
      where: {
        enterpriseId: scope.enterpriseId,
        subscriptionId: scope.subscriptionId,
        employeeId: scope.employeeId,
        ...(scope.userId ? { userId: scope.userId } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lt: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, costCNY: true },
    });
    const inputTokens = result._sum.inputTokens ?? 0;
    const outputTokens = result._sum.outputTokens ?? 0;
    return {
      callCount: result._count._all,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costCNY: result._sum.costCNY?.toNumber() ?? 0,
      basis: 'compute-usage-ledger',
      sourceFilterApplied: false,
      taskCostAttribution: 'unknown',
    };
  }

  async detail(
    id: string,
    userId: string,
    source: SubscriptionUsageSource,
    recordId: string,
  ): Promise<SubscriptionUsageDetailResponse> {
    const scope = await this.authorize(id, userId);
    const result =
      await this.prisma.$transaction<SubscriptionUsageDetailResponse>(
        async (tx) => {
          if (source === 'client')
            return this.clientDetail(tx, scope, recordId);
          if (source === 'client-legacy')
            return this.legacyClientDetail(tx, scope, recordId);
          const [session] = await tx.$queryRaw<
            Array<{
              id: string;
              title: string | null;
              userId: string;
              employeeId: string;
              createdAt: Date;
              source: 'CHAT' | 'TASK';
            }>
          >(Prisma.sql`
        SELECT s.id, s.title, s."userId", s."employeeId", s."createdAt", s.source
        FROM conversation_sessions s WHERE s.id = ${recordId}
          AND s.source = ${source === 'web-task' ? 'TASK' : 'CHAT'}::"ConversationSource"
          AND ${this.webProof(scope)}`);
          if (!session)
            throw new NotFoundException('使用记录不存在或无法核实归属');
          // Only after the complete billing/owner proof; never use billing.messageId as a message ID.
          const messages = await tx.message.findMany({
            where: {
              sessionId: session.id,
              session: { userId: session.userId, employeeId: scope.employeeId },
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { id: true, role: true, content: true, createdAt: true },
          });
          return {
            source,
            recordId,
            session: { ...session, createdAt: session.createdAt.toISOString() },
            messages: messages.map((message) => ({
              ...message,
              createdAt: message.createdAt.toISOString(),
            })),
            coverage: { attribution: 'verified', taskCost: 'unknown' },
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    if (scope.scope === 'enterprise') {
      try {
        await this.audit.record({
          actorId: userId,
          enterpriseId: scope.enterpriseId,
          action: 'subscription.usage-record.read',
          resourceType: 'subscription',
          resourceId: id,
          metadata: { source, recordId },
        });
      } catch {
        throw new ServiceUnavailableException('正文访问审计暂不可用');
      }
    }
    return result;
  }

  private async legacyClientDetail(
    tx: Prisma.TransactionClient,
    scope: UsageScope,
    recordId: string,
  ): Promise<SubscriptionLegacyClientUsageDetail> {
    const mirror = await tx.clientTaskMirror.findFirst({
      where: {
        id: recordId,
        enterpriseId: scope.enterpriseId,
        subscriptionId: scope.subscriptionId,
        ...(scope.userId ? { userId: scope.userId } : {}),
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
    if (!mirror) throw new NotFoundException('使用记录不存在或无法核实归属');
    const events = await tx.clientTaskMirrorEvent.findMany({
      where: {
        mirrorId: mirror.id,
        clientRunId: mirror.clientRunId,
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
    const inputAt = events
      .filter((e) => e.type === 'user_input' && e.occurredAt !== null)
      .reduce<Date | null>(
        (earliest, e) =>
          !earliest || e.occurredAt < earliest ? e.occurredAt : earliest,
        null,
      );
    const usedAt =
      mirror.startedAt ?? inputAt ?? mirror.queuedAt ?? mirror.createdAt;
    const timeBasis = mirror.startedAt
      ? 'legacy-started'
      : inputAt
        ? 'legacy-input'
        : mirror.queuedAt
          ? 'legacy-queued'
          : 'legacy-received';
    return {
      source: 'client-legacy',
      recordId,
      task: {
        id: mirror.id,
        clientTaskId: mirror.clientTaskId,
        title: mirror.title,
        userId: mirror.userId,
      },
      run: {
        clientRunId: mirror.clientRunId,
        status: mirror.status,
        queuedAt: mirror.queuedAt?.toISOString() ?? null,
        startedAt: mirror.startedAt?.toISOString() ?? null,
        completedAt: mirror.completedAt?.toISOString() ?? null,
        usedAt: usedAt.toISOString(),
        timeBasis,
      },
      events: events.map((e) => ({
        ...e,
        participationId: null,
        occurredAt: e.occurredAt?.toISOString() ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
      coverage: {
        attribution: 'legacy-root-subscription-unverified',
        currentRunOnly: true,
        taskCost: 'unknown',
      },
    };
  }

  private async clientDetail(
    tx: Prisma.TransactionClient,
    scope: UsageScope,
    recordId: string,
  ): Promise<SubscriptionClientUsageDetail> {
    const participationWhere: Prisma.ClientTaskParticipationWhereInput = {
      subscriptionId: scope.subscriptionId,
      employeeId: scope.employeeId,
      run: { protocolVersion: { gte: 2 }, mirrorId: recordId },
    };
    const mirror = await tx.clientTaskMirror.findFirst({
      where: {
        id: recordId,
        enterpriseId: scope.enterpriseId,
        ...(scope.userId ? { userId: scope.userId } : {}),
        participations: { some: participationWhere },
      },
      select: { id: true, clientTaskId: true, title: true, userId: true },
    });
    if (!mirror) throw new NotFoundException('使用记录不存在或无法核实归属');
    const participations = await tx.clientTaskParticipation.findMany({
      where: { ...participationWhere, mirrorId: mirror.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        clientRunId: true,
        executionId: true,
        nodeId: true,
        title: true,
        subscriptionId: true,
        employeeId: true,
        employeeName: true,
        subscriptionName: true,
        status: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        run: {
          select: {
            clientRunId: true,
            queuedAt: true,
            taskType: true,
            protocolVersion: true,
          },
        },
      },
    });
    // Validate the redundant run identifiers before reading any event bodies.
    const verified = participations.filter(
      (p) => p.clientRunId === p.run.clientRunId,
    );
    if (!verified.length)
      throw new NotFoundException('使用记录不存在或无法核实归属');
    const events = await tx.clientTaskMirrorEvent.findMany({
      where: {
        mirrorId: mirror.id,
        OR: verified.map((p) => ({
          participationId: p.id,
          clientRunId: p.clientRunId,
        })),
      },
      orderBy: [{ clientRunId: 'asc' }, { sequence: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        participationId: true,
        clientRunId: true,
        sequence: true,
        type: true,
        stepKey: true,
        message: true,
        occurredAt: true,
        createdAt: true,
      },
    });
    const runs = [...new Set(verified.map((p) => p.clientRunId))].map(
      (clientRunId) => ({
        ...verified.find((p) => p.clientRunId === clientRunId).run,
        queuedAt: verified
          .find((p) => p.clientRunId === clientRunId)
          .run.queuedAt.toISOString(),
        participations: verified
          .filter((p) => p.clientRunId === clientRunId)
          .map(({ run: _run, ...p }) => ({
            ...p,
            startedAt: p.startedAt?.toISOString() ?? null,
            completedAt: p.completedAt?.toISOString() ?? null,
            createdAt: p.createdAt.toISOString(),
            events: events
              .filter(
                (e) =>
                  e.participationId === p.id && e.clientRunId === p.clientRunId,
              )
              .map((e) => ({
                ...e,
                occurredAt: e.occurredAt?.toISOString() ?? null,
                createdAt: e.createdAt.toISOString(),
              })),
          })),
      }),
    );
    return {
      source: 'client',
      recordId,
      task: mirror,
      runs,
      coverage: {
        attribution: 'verified-participations-only',
        legacyRunsExcluded: true,
        unassignedEventsExcluded: true,
        taskCost: 'unknown',
      },
    };
  }
}
