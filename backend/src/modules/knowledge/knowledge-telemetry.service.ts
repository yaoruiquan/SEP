import { ForbiddenException, HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { KnowledgeAccessPolicy } from './knowledge-access-policy';

export const KNOWLEDGE_AUDIT_RESOURCE = 'KNOWLEDGE';
export const KNOWLEDGE_AUDIT_ACTIONS = [
  'KNOWLEDGE_SEARCH', 'KNOWLEDGE_TEST_SEARCH', 'KNOWLEDGE_SOURCE_READ',
  'KNOWLEDGE_BASE_CREATE', 'KNOWLEDGE_BASE_UPDATE', 'KNOWLEDGE_BASE_DELETE',
  'KNOWLEDGE_DOCUMENT_UPLOAD', 'KNOWLEDGE_DOCUMENT_VERSION_UPLOAD',
  'KNOWLEDGE_DOCUMENT_RETRY', 'KNOWLEDGE_DOCUMENT_DELETE',
  'KNOWLEDGE_GRANT_CREATE', 'KNOWLEDGE_GRANT_REVOKE',
  'KNOWLEDGE_OPERATION_RETIRED',
] as const;
export type KnowledgeAuditAction = typeof KNOWLEDGE_AUDIT_ACTIONS[number];

const RESULT_CODES = new Set([
  'SUCCESS', 'MATCHED', 'NO_MATCH', 'NO_ACCESS', 'NOT_READY',
  'VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT',
  'PRECONDITION_FAILED', 'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_FORMAT', 'RATE_LIMITED',
  'INTERNAL_ERROR', 'SERVICE_UNAVAILABLE', 'KNOWLEDGE_SERVICE_UNAVAILABLE',
  'KNOWLEDGE_RESOURCE_NOT_FOUND', 'KNOWLEDGE_ADMIN_REQUIRED',
  'ENTERPRISE_MEMBERSHIP_REQUIRED', 'KNOWLEDGE_OPERATION_RETIRED',
  'REQUEST_IN_PROGRESS', 'IDEMPOTENCY_CONFLICT', 'DOCUMENT_NOT_READY',
]);
const MAX_EVENTS = 10_000;
const HOUR_MS = 3_600_000;

export interface KnowledgeAuditActor {
  actorId: string;
  enterpriseId: string | null;
  memberId: string | null;
}

export interface KnowledgeAuditEvent {
  action: KnowledgeAuditAction;
  resourceId?: string;
  knowledgeBaseId?: string;
  documentId?: string;
  versionId?: string;
  sourceId?: string;
  targetMemberId?: string;
  statusCode: number;
  resultCode: string;
  requestId: string;
  searchId?: string;
  durationMs: number;
  count?: number;
  actualStrategy?: 'HYBRID' | 'LEXICAL' | null;
  degraded?: boolean;
  partial?: boolean;
}

export function knowledgeAuditId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

export function knowledgeAuditResultCode(value: unknown, statusCode: number): string {
  if (typeof value === 'string' && RESULT_CODES.has(value)) return value;
  if (statusCode < 400) return 'SUCCESS';
  return ({ 400: 'VALIDATION_ERROR', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN',
    404: 'NOT_FOUND', 409: 'CONFLICT', 410: 'KNOWLEDGE_OPERATION_RETIRED',
    412: 'PRECONDITION_FAILED', 413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_FORMAT',
    429: 'RATE_LIMITED', 503: 'SERVICE_UNAVAILABLE' } as Record<number, string>)[statusCode] ?? 'INTERNAL_ERROR';
}

function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(Math.floor(value), max) : undefined;
}

type JobMetrics = { pending: bigint; running: bigint; due: bigint; expiredLeases: bigint;
  failed: bigint; done: bigint; oldestPendingAt: Date | null };
type FailureStage = 'PARSING' | 'CHUNKING' | 'EMBEDDING' | 'PUBLISHING' | 'UNKNOWN';
type FailureMetrics = { stage: FailureStage; count: bigint };
type RetentionMetrics = { pendingVersions: bigint; oldestExpiredAt: Date | null };
type InventoryMetrics = { documents: bigint; versions: bigint; originalBytes: bigint;
  chunks: bigint; vectorChunks: bigint; lexicalChunks: bigint; chunkRelationBytes: bigint };

@Injectable()
export class KnowledgeTelemetryService {
  private readonly logger = new Logger(KnowledgeTelemetryService.name);
  private readonly startedAt = new Date();
  private readonly counters = { auditAttempts: 0, auditWritten: 0, auditWriteFailures: 0,
    actorResolutionFailures: 0, metricsReadFailures: 0 };
  private lastAuditFailureAt: string | null = null;

  constructor(
    private readonly audit: AuditService,
    private readonly policy: KnowledgeAccessPolicy,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async resolveActor(actorId: string): Promise<KnowledgeAuditActor> {
    try {
      const viewer = await this.policy.resolve(actorId);
      return { actorId, enterpriseId: viewer.enterpriseId, memberId: viewer.memberId };
    } catch (error) {
      if (!(error instanceof ForbiddenException)) {
        this.counters.actorResolutionFailures += 1;
        this.logger.warn('KNOWLEDGE_AUDIT_ACTOR_RESOLUTION_FAILED');
      }
      return { actorId, enterpriseId: null, memberId: null };
    }
  }

  /** Reconstruct the complete payload: never forward arbitrary request/response metadata. */
  async record(actor: KnowledgeAuditActor, event: KnowledgeAuditEvent): Promise<void> {
    this.counters.auditAttempts += 1;
    try {
      if (!KNOWLEDGE_AUDIT_ACTIONS.includes(event.action)) throw new TypeError('Invalid audit action');
      const statusCode = integer(event.statusCode, 599);
      const metadata = {
        memberId: knowledgeAuditId(actor.memberId) ?? null,
        knowledgeBaseId: knowledgeAuditId(event.knowledgeBaseId) ?? null,
        documentId: knowledgeAuditId(event.documentId) ?? null,
        versionId: knowledgeAuditId(event.versionId) ?? null,
        sourceId: knowledgeAuditId(event.sourceId) ?? null,
        targetMemberId: knowledgeAuditId(event.targetMemberId) ?? null,
        statusCode: statusCode && statusCode >= 100 ? statusCode : 500,
        resultCode: knowledgeAuditResultCode(event.resultCode, statusCode ?? 500),
        requestId: knowledgeAuditId(event.requestId) ?? null,
        searchId: knowledgeAuditId(event.searchId) ?? null,
        durationMs: integer(event.durationMs) ?? 0,
        count: integer(event.count) ?? null,
        actualStrategy: event.actualStrategy === 'HYBRID' || event.actualStrategy === 'LEXICAL'
          ? event.actualStrategy : null,
        degraded: typeof event.degraded === 'boolean' ? event.degraded : null,
        partial: typeof event.partial === 'boolean' ? event.partial : null,
      };
      await this.audit.record({
        actorId: knowledgeAuditId(actor.actorId),
        enterpriseId: knowledgeAuditId(actor.enterpriseId) ?? null,
        action: event.action,
        resourceType: KNOWLEDGE_AUDIT_RESOURCE,
        resourceId: knowledgeAuditId(event.resourceId) ?? null,
        result: metadata.statusCode >= 400 ? 'FAILED' : 'SUCCESS',
        metadata,
      });
      this.counters.auditWritten += 1;
    } catch {
      this.counters.auditWriteFailures += 1;
      this.lastAuditFailureAt = new Date().toISOString();
      this.logger.error('KNOWLEDGE_AUDIT_WRITE_FAILED');
    }
  }

  getDiagnostics() {
    return { scope: 'PROCESS_LOCAL' as const, since: this.startedAt.toISOString(),
      ...this.counters, lastAuditFailureAt: this.lastAuditFailureAt };
  }

  async getMetrics(actorId: string) {
    // Re-read the current DB role; JWT claims and request enterprise roles are not authorization.
    try {
      const user = knowledgeAuditId(actorId) ? await this.prisma.user.findUnique({
        where: { id: actorId }, select: { role: true },
      }) : null;
      if (user?.role !== 'ADMIN') throw new ForbiddenException({
        code: 'KNOWLEDGE_PLATFORM_ADMIN_REQUIRED', message: '仅平台管理员可查看知识库监控',
      });
      return await this.collectMetrics();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.counters.metricsReadFailures += 1;
      this.logger.error('KNOWLEDGE_METRICS_READ_FAILED');
      throw new ServiceUnavailableException({ code: 'KNOWLEDGE_METRICS_UNAVAILABLE', message: '知识库监控暂时不可用' });
    }
  }

  private async collectMetrics() {
    const now = new Date();
    const from = new Date(now.getTime() - HOUR_MS);
    const where = { resourceType: KNOWLEDGE_AUDIT_RESOURCE,
      action: { in: [...KNOWLEDGE_AUDIT_ACTIONS] }, createdAt: { gte: from, lte: now } };
    const [events, totalEvents, [jobs], failures, [retention], [inventory]] = await Promise.all([
      this.prisma.auditLog.findMany({ where, select: { action: true, result: true, metadata: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: MAX_EVENTS }),
      this.prisma.auditLog.count({ where }),
      this.prisma.$queryRaw<JobMetrics[]>`SELECT
        count(*) FILTER (WHERE status = 'PENDING') AS pending,
        count(*) FILTER (WHERE status = 'RUNNING') AS running,
        count(*) FILTER (WHERE status = 'PENDING' AND "nextRunAt" <= ${now}) AS due,
        count(*) FILTER (WHERE status = 'RUNNING' AND "leaseUntil" <= ${now}) AS "expiredLeases",
        count(*) FILTER (WHERE status = 'FAILED') AS failed,
        count(*) FILTER (WHERE status = 'DONE') AS done,
        min("createdAt") FILTER (WHERE status = 'PENDING') AS "oldestPendingAt"
        FROM knowledge_processing_jobs`,
      this.prisma.$queryRaw<FailureMetrics[]>`SELECT CASE
        WHEN "errorCode" IN ('INVALID_DOCUMENT', 'EMPTY_DOCUMENT') THEN 'PARSING'
        WHEN "errorCode" IN ('TOKENIZER_UNAVAILABLE', 'DOCUMENT_LIMIT') THEN 'CHUNKING'
        WHEN "errorCode" IN ('EMBEDDING_PROFILE_MISMATCH', 'EMBEDDING_UNAVAILABLE', 'INVALID_EMBEDDING') THEN 'EMBEDDING'
        WHEN "errorCode" = 'INCOMPLETE_INDEX' THEN 'PUBLISHING'
        ELSE 'UNKNOWN' END AS stage, count(*) AS count
        FROM knowledge_processing_jobs WHERE status = 'FAILED' GROUP BY 1`,
      this.prisma.$queryRaw<RetentionMetrics[]>`SELECT count(*) AS "pendingVersions", min(v."retiredAt") AS "oldestExpiredAt"
        FROM document_versions v JOIN documents d ON d.id = v."documentId"
        WHERE v.published = false AND v."publishedAt" IS NOT NULL AND v."retiredAt" <= ${now}
        AND d."activeVersionId" IS DISTINCT FROM v.id
        AND (EXISTS (SELECT 1 FROM text_chunks c WHERE c."versionId" = v.id)
          OR EXISTS (SELECT 1 FROM knowledge_parsed_blocks b WHERE b."versionId" = v.id))`,
      this.prisma.$queryRaw<InventoryMetrics[]>`SELECT
        (SELECT count(*) FROM documents) AS documents,
        (SELECT count(*) FROM document_versions) AS versions,
        ((SELECT coalesce(sum("fileSize"), 0) FROM document_versions) +
          (SELECT coalesce(sum("fileSize"), 0) FROM documents WHERE "latestVersionId" IS NULL)) AS "originalBytes",
        count(*) AS chunks,
        count(*) FILTER (WHERE "embeddingVector" IS NOT NULL) AS "vectorChunks",
        count(*) FILTER (WHERE cardinality(tokens) > 0) AS "lexicalChunks",
        pg_total_relation_size('text_chunks'::regclass) AS "chunkRelationBytes"
        FROM text_chunks`,
    ]);

    const searches = events.filter(event => event.action === 'KNOWLEDGE_SEARCH');
    const searchStats = { requests: searches.length, failures: 0, degraded: 0, partial: 0,
      noMatch: 0, matched: 0, noAccess: 0, notReady: 0, executed: 0, latencySamples: 0, p95Ms: null as number | null };
    const latencies: number[] = [];
    let allFailures = 0;
    for (const event of events) {
      const data = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
        ? event.metadata as Record<string, unknown> : {};
      const failed = event.result === 'FAILED' || (typeof data.statusCode === 'number' && data.statusCode >= 400);
      if (failed) allFailures += 1;
      if (event.action !== 'KNOWLEDGE_SEARCH') continue;
      if (failed) searchStats.failures += 1;
      if (data.degraded === true) searchStats.degraded += 1;
      if (data.partial === true) searchStats.partial += 1;
      if (!failed && data.resultCode === 'NO_MATCH') searchStats.noMatch += 1;
      if (!failed && data.resultCode === 'MATCHED') searchStats.matched += 1;
      if (!failed && data.resultCode === 'NO_ACCESS') searchStats.noAccess += 1;
      if (!failed && data.resultCode === 'NOT_READY') searchStats.notReady += 1;
      const duration = integer(data.durationMs);
      if (duration !== undefined) latencies.push(duration);
    }
    latencies.sort((a, b) => a - b);
    searchStats.latencySamples = latencies.length;
    searchStats.p95Ms = latencies.length ? latencies[Math.ceil(latencies.length * 0.95) - 1] : null;
    searchStats.executed = searchStats.matched + searchStats.noMatch;
    const ratio = (count: number, total: number) => total ? count / total : null;
    const search = { ...searchStats, failureRate: ratio(searchStats.failures, searchStats.requests),
      degradationRate: ratio(searchStats.degraded, searchStats.requests),
      noMatchRate: ratio(searchStats.noMatch, searchStats.executed) };
    const queue = { scope: 'CURRENT_DATABASE_JOBS' as const, pending: Number(jobs.pending),
      running: Number(jobs.running), due: Number(jobs.due), expiredLeases: Number(jobs.expiredLeases),
      failed: Number(jobs.failed), done: Number(jobs.done),
      oldestPendingWaitMs: jobs.oldestPendingAt ? Math.max(0, now.getTime() - jobs.oldestPendingAt.getTime()) : 0,
      failureStageSource: 'ERROR_CODE_CLASSIFICATION' as const,
      failedByStage: { PARSING: 0, CHUNKING: 0, EMBEDDING: 0, PUBLISHING: 0, UNKNOWN: 0 } };
    for (const failure of failures) {
      if (Object.prototype.hasOwnProperty.call(queue.failedByStage, failure.stage)) {
        queue.failedByStage[failure.stage] = Number(failure.count);
      }
    }
    const cleanup = { scope: 'EXPIRED_HISTORY_PARSED_CONTENT' as const, pendingVersions: Number(retention.pendingVersions),
      oldestOverdueMs: retention.oldestExpiredAt ? Math.max(0, now.getTime() - retention.oldestExpiredAt.getTime()) : 0 };
    const storage = { logicalOriginalBytes: Number(inventory.originalBytes), physicalFileBytesMeasured: false,
      documents: Number(inventory.documents), versions: Number(inventory.versions),
      chunks: Number(inventory.chunks), vectorChunks: Number(inventory.vectorChunks),
      lexicalChunks: Number(inventory.lexicalChunks), chunkRelationBytes: Number(inventory.chunkRelationBytes) };
    const diagnostics = this.getDiagnostics();
    const thresholds = this.getThresholds();
    const alerts: Array<{ code: string; value: number; threshold: number }> = [];
    const check = (code: string, value: number | null, threshold: number) => {
      if (value !== null && value > threshold) alerts.push({ code, value, threshold });
    };
    check('SEARCH_P95_HIGH', search.p95Ms, thresholds.searchP95Ms);
    check('SEARCH_FAILURE_RATE_HIGH', search.failureRate, thresholds.failureRate);
    check('SEARCH_DEGRADATION_RATE_HIGH', search.degradationRate, thresholds.degradationRate);
    check('SEARCH_NO_MATCH_RATE_HIGH', search.noMatchRate, thresholds.noMatchRate);
    check('JOB_BACKLOG_HIGH', queue.pending + queue.running, thresholds.jobBacklog);
    check('JOB_WAIT_HIGH', queue.oldestPendingWaitMs, thresholds.jobWaitMs);
    check('JOB_FAILURES_HIGH', queue.failed, thresholds.failedJobs);
    check('JOB_LEASE_EXPIRED', queue.expiredLeases, 0);
    check('HISTORY_CLEANUP_DELAY_HIGH', cleanup.oldestOverdueMs, thresholds.cleanupDelayMs);
    check('STORAGE_HIGH', storage.logicalOriginalBytes, thresholds.storageBytes);
    check('INDEX_SIZE_HIGH', storage.chunks, thresholds.indexChunks);
    check('AUDIT_WRITE_FAILURE', diagnostics.auditWriteFailures, 0);
    check('AUDIT_ACTOR_RESOLUTION_FAILURE', diagnostics.actorResolutionFailures, 0);
    return { generatedAt: now.toISOString(), window: { from: from.toISOString(), to: now.toISOString(),
      maxEvents: MAX_EVENTS, sampleSize: events.length, totalEvents, sampled: totalEvents > MAX_EVENTS,
      selection: 'LATEST_FIRST' as const },
      audit: { events: events.length, failures: allFailures }, search, queue, cleanup, storage, diagnostics, thresholds,
      alerting: { status: alerts.length ? 'WARNING' as const : 'OK' as const,
        delivery: 'RESPONSE_ONLY' as const, externalNotifications: false, alerts } };
  }

  private getThresholds() {
    const number = (name: string, fallback: number, min: number, max: number) => {
      const raw = this.config.get<unknown>(name);
      if ((typeof raw !== 'string' && typeof raw !== 'number') || raw === '') return fallback;
      const value = Number(raw);
      return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
    };
    return {
      searchP95Ms: number('KNOWLEDGE_METRICS_SEARCH_P95_MS', 3000, 1, 3_600_000),
      failureRate: number('KNOWLEDGE_METRICS_FAILURE_RATE', 0.05, 0, 1),
      degradationRate: number('KNOWLEDGE_METRICS_DEGRADATION_RATE', 0.2, 0, 1),
      noMatchRate: number('KNOWLEDGE_METRICS_NO_MATCH_RATE', 0.5, 0, 1),
      jobBacklog: number('KNOWLEDGE_METRICS_JOB_BACKLOG', 100, 0, 1_000_000),
      jobWaitMs: number('KNOWLEDGE_METRICS_JOB_WAIT_MS', 300_000, 1, 604_800_000),
      failedJobs: number('KNOWLEDGE_METRICS_FAILED_JOBS', 0, 0, 1_000_000),
      cleanupDelayMs: number('KNOWLEDGE_METRICS_CLEANUP_DELAY_MS', HOUR_MS, 1, 2_592_000_000),
      storageBytes: number('KNOWLEDGE_METRICS_STORAGE_BYTES', 10_737_418_240, 1, Number.MAX_SAFE_INTEGER),
      indexChunks: number('KNOWLEDGE_METRICS_INDEX_CHUNKS', 1_000_000, 1, 1_000_000_000),
    };
  }
}
