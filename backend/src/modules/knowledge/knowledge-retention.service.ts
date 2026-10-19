import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KnowledgePrivateStorage } from './knowledge-private-storage';

const RETRY_DELAY_MS = 5 * 60 * 1000;
type ExpiredVersion = { id: string; documentId: string };
type RetentionBatch = { scanned: number; cleaned: number; skipped: number; failed: number };

export function knowledgeHistoryRetentionDays(config?: Pick<ConfigService, 'get'>): number {
  const days = Number(config?.get('KNOWLEDGE_HISTORY_RETENTION_DAYS'));
  return Number.isSafeInteger(days) && days > 0 && days <= 3650 ? days : 30;
}

/** Retain metadata, but remove expired source text and unshared originals independently of processing. */
@Injectable()
export class KnowledgeRetentionService {
  private readonly logger = new Logger(KnowledgeRetentionService.name);
  private readonly storage = new KnowledgePrivateStorage();
  private inFlight?: Promise<RetentionBatch>;
  private lastStartedAt: Date | null = null;
  private lastFinishedAt: Date | null = null;
  private lastSuccessAt: Date | null = null;
  private lastError: 'RETENTION_UNAVAILABLE' | null = null;
  private lastBatch: RetentionBatch | null = null;

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  @Interval('knowledge-history-retention', 60_000)
  async maintain(): Promise<void> {
    try { await this.runOnce(); }
    catch { this.logger.warn('Knowledge history retention unavailable; next interval will retry'); }
  }

  runOnce(): Promise<RetentionBatch> {
    if (this.inFlight) return this.inFlight;
    this.lastStartedAt = new Date();
    this.inFlight = this.cleanBatch().then(batch => {
      this.lastBatch = batch;
      this.lastError = batch.failed ? 'RETENTION_UNAVAILABLE' : null;
      if (!batch.failed) this.lastSuccessAt = new Date();
      return batch;
    }).catch(error => {
      this.lastError = 'RETENTION_UNAVAILABLE';
      throw error;
    }).finally(() => {
      this.lastFinishedAt = new Date();
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  /** Database backlog survives restarts; execution timestamps describe this process only. */
  async getStatus() {
    const now = new Date();
    const [backlog = { count: 0n, oldest: null }] = await this.prisma.$queryRaw<Array<{ count: bigint; oldest: Date | null }>>`
      SELECT count(*) AS count, min(v."retiredAt") AS oldest
      FROM document_versions v JOIN documents d ON d.id = v."documentId"
      JOIN knowledge_bases kb ON kb.id = d."knowledgeBaseId"
      WHERE ${this.expiredWhere(now)}`;
    const failedDeletionJobs = await this.prisma.knowledgeProcessingJob.count({ where: { kind: 'CLEANUP', status: 'FAILED' } });
    return {
      retentionDays: knowledgeHistoryRetentionDays(this.config), batchSize: this.batchSize(),
      intervalMs: 60_000, retryDelayMs: RETRY_DELAY_MS, running: !!this.inFlight,
      pendingVersions: Number(backlog.count), oldestExpiredAt: backlog.oldest,
      lagMs: backlog.oldest ? Math.max(0, now.getTime() - backlog.oldest.getTime()) : 0,
      failedDeletionJobs, lastStartedAt: this.lastStartedAt, lastFinishedAt: this.lastFinishedAt,
      lastSuccessAt: this.lastSuccessAt, lastError: this.lastError,
      lastBatch: this.lastBatch ? { ...this.lastBatch } : null,
    };
  }

  private batchSize() {
    const size = Number(this.config.get('KNOWLEDGE_RETENTION_BATCH_SIZE'));
    return Number.isSafeInteger(size) && size > 0 ? Math.min(size, 100) : 25;
  }

  private expiredWhere(now: Date) {
    return Prisma.sql`v.published = false AND v.status = 'READY' AND v.stage <> 'EXPIRED'
      AND v."retiredAt" <= ${now} AND d."deletedAt" IS NULL AND kb."deletedAt" IS NULL
      AND v.id IS DISTINCT FROM d."activeVersionId" AND v.id IS DISTINCT FROM d."latestVersionId"`;
  }

  private async cleanBatch(): Promise<RetentionBatch> {
    const now = new Date();
    const candidates = await this.prisma.$queryRaw<ExpiredVersion[]>`
      SELECT v.id, v."documentId" FROM document_versions v
      JOIN documents d ON d.id = v."documentId" JOIN knowledge_bases kb ON kb.id = d."knowledgeBaseId"
      WHERE ${this.expiredWhere(now)}
        AND (v.stage <> 'RETENTION_RETRY' OR v."updatedAt" <= ${new Date(now.getTime() - RETRY_DELAY_MS)})
      ORDER BY v."retiredAt", v.id LIMIT ${this.batchSize()}`;
    const batch: RetentionBatch = { scanned: candidates.length, cleaned: 0, skipped: 0, failed: 0 };
    for (const candidate of candidates) {
      try {
        if (await this.cleanVersion(candidate, now)) batch.cleaned++;
        else batch.skipped++;
      } catch {
        batch.failed++;
        // Persist cooldown so broken originals cannot monopolize the oldest batch on every instance.
        try {
          await this.prisma.$executeRaw`UPDATE document_versions v
            SET stage = 'RETENTION_RETRY', "updatedAt" = ${new Date()}
            FROM documents d, knowledge_bases kb
            WHERE v.id = ${candidate.id} AND d.id = v."documentId" AND kb.id = d."knowledgeBaseId"
              AND ${this.expiredWhere(now)}`;
        } catch { /* Backlog remains eligible if even persisting the cooldown is unavailable. */ }
        this.logger.warn('Knowledge history cleanup failed; expired version will be retried');
      }
    }
    return batch;
  }

  private async cleanVersion(candidate: ExpiredVersion, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      // Transaction-scoped advisory locks are released on rollback/crash; no permanent lease can strand a version.
      const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext(${`knowledge-retention:${candidate.id}`})) AS locked`;
      if (!lock.locked) return false;
      const documents = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM documents WHERE id = ${candidate.documentId} FOR UPDATE SKIP LOCKED`;
      if (!documents.length) return false;
      const document = await tx.document.findUnique({ where: { id: candidate.documentId }, include: { knowledgeBase: true } });
      const version = await tx.documentVersion.findUnique({ where: { id: candidate.id } });
      if (!document || !version || document.deletedAt || document.knowledgeBase.deletedAt || version.documentId !== document.id ||
        version.published || version.status !== 'READY' || version.stage === 'EXPIRED' || !version.retiredAt || version.retiredAt > now ||
        version.id === document.activeVersionId || version.id === document.latestVersionId) return false;

      // Legacy document projections may still point at the first original after replacement.
      let documentPath = document.storagePath;
      if (version.storagePath && documentPath === version.storagePath) {
        const current = await tx.documentVersion.findFirst({ where: {
          id: document.activeVersionId ?? document.latestVersionId ?? '', documentId: document.id,
          storagePath: { not: '' },
        }, select: { storagePath: true } });
        if (current && current.storagePath !== version.storagePath) {
          documentPath = current.storagePath;
          await tx.document.update({ where: { id: document.id }, data: { storagePath: documentPath } });
        }
      }
      if (version.storagePath && version.storagePath !== documentPath) {
        const original = await tx.document.findFirst({ where: { storagePath: version.storagePath }, select: { id: true } });
        const shared = await tx.documentVersion.findFirst({ where: { storagePath: version.storagePath,
          id: { not: version.id } }, select: { id: true } });
        if (!original && !shared) await this.storage.remove(version.storagePath);
      }
      // Unlink first: failure preserves the durable path for retry. ENOENT makes a post-unlink rollback safe.
      await tx.textChunk.deleteMany({ where: { versionId: version.id } });
      await tx.knowledgeParsedBlock.deleteMany({ where: { versionId: version.id } });
      await tx.documentVersion.update({ where: { id: version.id }, data: { stage: 'EXPIRED', storagePath: '' } });
      return true;
    }, { maxWait: 1000, timeout: 10_000 });
  }
}
