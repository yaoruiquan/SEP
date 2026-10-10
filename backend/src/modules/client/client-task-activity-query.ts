import { Prisma } from '@prisma/client';
import type { ClientTaskMirrorQueryDto } from 'shared';

// Positive allowlist: unknown events, status/participation_status, monitor evidence,
// heartbeat and metadata must never promote a task merely because they were synced.
const BUSINESS_EVENT_TYPES = [
  'user_input', 'model_output', 'step', 'activity',
  'node_started', 'node_finished', 'tool_call', 'tool_result',
];

type ActivityQueryInput = {
  enterpriseId: string | null;
  /** Already resolved by the service, including any permitted query.userId filter. */
  userId?: string;
  query: ClientTaskMirrorQueryDto;
  skip: number;
  take: number;
};

function executionRange(column: Prisma.Sql, query: ClientTaskMirrorQueryDto): Prisma.Sql {
  const date = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value);
  return Prisma.join([
    ...(query.from ? [Prisma.sql`${column} >= ${date(query.from)}`] : []),
    ...(query.to ? [Prisma.sql`${column} < ${date(query.to)}`] : []),
  ], ' AND ');
}

/**
 * Mirrors taskMirrorReadWhere after authorization has resolved enterpriseId/userId.
 * Date filtering qualifies tasks; activity considers ALL visible historical runs,
 * independently of that date window. The fixed employee scope takes precedence over
 * the optional employee filter for activity attribution (both still qualify tasks).
 * Fallbacks use maxima within each source, in event > started > queued > received
 * priority, never updatedAt, heartbeat, event receipt time, message or JSON content.
 */
export function buildClientTaskActivityQuery({
  enterpriseId, userId, query, skip, take,
}: ActivityQueryInput): Prisma.Sql {
  const conditions: Prisma.Sql[] = [enterpriseId === null
    ? Prisma.sql`m."enterpriseId" IS NULL`
    : Prisma.sql`m."enterpriseId" = ${enterpriseId}`];
  if (userId !== undefined) conditions.push(Prisma.sql`m."userId" = ${userId}`);
  if (query.taskType) conditions.push(Prisma.sql`m."taskType" = ${query.taskType}`);
  // Prisma contains/insensitive uses ILIKE, including its % and _ pattern semantics.
  if (query.q) conditions.push(Prisma.sql`m.title ILIKE ${`%${query.q}%`}`);
  for (const subscriptionId of new Set([query.scopeSubscriptionId, query.subscriptionId].filter(Boolean))) {
    conditions.push(Prisma.sql`(
      EXISTS (SELECT 1 FROM client_task_participations p
        WHERE p."mirrorId" = m.id AND p."subscriptionId" = ${subscriptionId})
      OR (m."protocolVersion" = 1 AND m."subscriptionId" = ${subscriptionId})
    )`);
  }
  if (query.view === 'active') {
    conditions.push(Prisma.sql`m.status IN (${Prisma.join(['QUEUED', 'RUNNING'])})`);
  }
  if (query.view === 'attention') {
    conditions.push(Prisma.sql`m.status IN (${Prisma.join(['WAITING_APPROVAL', 'PAUSED', 'INTERRUPTED', 'FAILED'])})`);
  }
  if (query.statuses) {
    conditions.push(query.statuses.length
      ? Prisma.sql`m.status IN (${Prisma.join(query.statuses)})`
      : Prisma.sql`FALSE`);
  }
  if (query.from || query.to) {
    // Preserve service semantics: selected employee, otherwise the fixed scope.
    const subscriptionId = query.subscriptionId ?? query.scopeSubscriptionId;
    conditions.push(Prisma.sql`(
      EXISTS (SELECT 1 FROM client_task_participations p
        JOIN client_task_mirror_runs r ON r.id = p."runId"
        WHERE p."mirrorId" = m.id
          ${subscriptionId ? Prisma.sql`AND p."subscriptionId" = ${subscriptionId}` : Prisma.empty}
          AND ((${executionRange(Prisma.sql`p."startedAt"`, query)})
            OR (p."startedAt" IS NULL AND (${executionRange(Prisma.sql`r."queuedAt"`, query)}))))
      ${!subscriptionId ? Prisma.sql`OR EXISTS (
        SELECT 1 FROM client_task_mirror_runs r
        WHERE r."mirrorId" = m.id AND (${executionRange(Prisma.sql`r."queuedAt"`, query)}))` : Prisma.empty}
      OR (m."protocolVersion" = 1
        ${subscriptionId ? Prisma.sql`AND m."subscriptionId" = ${subscriptionId}` : Prisma.empty}
        AND (${executionRange(Prisma.sql`COALESCE(m."startedAt", m."queuedAt", m."createdAt")`, query)}))
    )`);
  }

  const activitySubscriptionId = query.scopeSubscriptionId ?? query.subscriptionId;
  const scopedEvents = activitySubscriptionId ? Prisma.sql`AND (
    EXISTS (SELECT 1 FROM client_task_participations p
      WHERE p.id = e."participationId" AND p."mirrorId" = m.id
        AND p."clientRunId" = e."clientRunId" AND p."subscriptionId" = ${activitySubscriptionId})
    OR (e."participationId" IS NULL AND (
      EXISTS (SELECT 1 FROM client_task_mirror_runs r
        WHERE r."mirrorId" = m.id AND r."clientRunId" = e."clientRunId"
          AND r."protocolVersion" = 1 AND r."subscriptionId" = ${activitySubscriptionId})
      OR (m."protocolVersion" = 1 AND m."subscriptionId" = ${activitySubscriptionId}
        AND NOT EXISTS (SELECT 1 FROM client_task_mirror_runs r
          WHERE r."mirrorId" = m.id AND r."clientRunId" = e."clientRunId"))
    ))
  )` : Prisma.empty;

  return Prisma.sql`
    WITH eligible AS (
      SELECT m.id, m."protocolVersion", m."subscriptionId", m."startedAt", m."queuedAt", m."createdAt"
      FROM client_task_mirrors m
      WHERE ${Prisma.join(conditions, ' AND ')}
    ), activity AS (
      SELECT m.id, business."eventAt", execution."startedAt", execution."queuedAt", execution."receivedAt"
      FROM eligible m
      LEFT JOIN LATERAL (
        SELECT MAX(e."occurredAt") AS "eventAt"
        FROM client_task_mirror_events e
        WHERE e."mirrorId" = m.id AND e.type IN (${Prisma.join(BUSINESS_EVENT_TYPES)})
          AND e."occurredAt" IS NOT NULL ${scopedEvents}
      ) business ON TRUE
      LEFT JOIN LATERAL (
        SELECT MAX(times."startedAt") AS "startedAt", MAX(times."queuedAt") AS "queuedAt",
          MAX(times."receivedAt") AS "receivedAt"
        FROM (
          SELECT p."startedAt", r."queuedAt", p."createdAt" AS "receivedAt"
          FROM client_task_participations p
          JOIN client_task_mirror_runs r ON r.id = p."runId"
          WHERE p."mirrorId" = m.id
            ${activitySubscriptionId ? Prisma.sql`AND p."subscriptionId" = ${activitySubscriptionId}` : Prisma.empty}
          UNION ALL
          SELECT r."startedAt", r."queuedAt", r."createdAt"
          FROM client_task_mirror_runs r
          WHERE r."mirrorId" = m.id
            ${activitySubscriptionId ? Prisma.sql`AND r."protocolVersion" = 1 AND r."subscriptionId" = ${activitySubscriptionId}` : Prisma.empty}
          UNION ALL
          SELECT m."startedAt", m."queuedAt", m."createdAt"
          ${activitySubscriptionId ? Prisma.sql`WHERE m."protocolVersion" = 1 AND m."subscriptionId" = ${activitySubscriptionId}` : Prisma.empty}
        ) times
      ) execution ON TRUE
    )
    SELECT id, COALESCE("eventAt", "startedAt", "queuedAt", "receivedAt") AS "activityAt",
      CASE WHEN "eventAt" IS NOT NULL THEN 'event'
        WHEN "startedAt" IS NOT NULL THEN 'started'
        WHEN "queuedAt" IS NOT NULL THEN 'queued'
        ELSE 'received' END AS "activityTimeSource"
    FROM activity
    ORDER BY "activityAt" DESC NULLS LAST, id DESC
    LIMIT ${take} OFFSET ${skip}
  `;
}
