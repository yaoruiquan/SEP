import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentProcessorService } from './document-processor.service';
import { resolveRedisOptions } from '../../redis/redis-connection';
import { KnowledgePrivateStorage } from './knowledge-private-storage';

const QUEUE_NAME = 'knowledge-version-processing';

/** The durable DB job is the outbox; periodic delivery is deliberately at-least-once. */
@Injectable()
export class KnowledgeQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KnowledgeQueueService.name);
  private queue?: Queue<{ jobId: string }>;
  private worker?: Worker<{ jobId: string }>;
  private timer?: ReturnType<typeof setInterval>;
  private dispatching?: Promise<void>;
  private ready = false;
  private lastMaintenance = 0;
  private readonly storage = new KnowledgePrivateStorage();
  constructor(private config: ConfigService, private prisma: PrismaService, private processor: DocumentProcessorService) {}
  isReady() { return this.ready; }
  async onModuleInit() {
    const connection = resolveRedisOptions(this.config);
    this.queue = new Queue(QUEUE_NAME, { connection });
    this.worker = new Worker(QUEUE_NAME, job => this.processor.processJob(job.data.jobId), { connection, concurrency: 2 });
    this.queue.on('error', () => { this.ready = false; });
    this.worker.on('error', () => { this.ready = false; });
    this.worker.on('failed', () => this.logger.warn('Knowledge delivery failed; durable job remains recoverable'));
    this.timer = setInterval(() => this.dispatch(), 5000);
    this.timer.unref();
    this.dispatch();
  }
  private dispatch() {
    if (this.dispatching) return;
    this.dispatching = this.deliver().catch(() => { this.ready = false; })
      .finally(() => { this.dispatching = undefined; });
  }
  async deliver() {
    if (!this.queue) return;
    try { await this.maintain(); }
    catch { this.logger.warn('Knowledge maintenance failed; continuing durable job delivery'); }
    // Expired last attempts must reach a visible terminal state, not remain RUNNING forever.
    const expired = await this.prisma.knowledgeProcessingJob.findMany({ where: {
      status: 'RUNNING', leaseUntil: { lte: new Date() }, attempts: { gte: 3 },
    }, take: 100 });
    for (const job of expired) {
      await this.prisma.$transaction(async tx => {
        const changed = await tx.knowledgeProcessingJob.updateMany({ where: { id: job.id, status: 'RUNNING',
          fence: job.fence, leaseUntil: { lte: new Date() } }, data: { status: 'FAILED', leaseUntil: null, fence: { increment: 1 }, errorCode: 'LEASE_EXHAUSTED' } });
        if (changed.count && job.versionId) await tx.documentVersion.updateMany({ where: { id: job.versionId, generation: job.generation, published: false },
          data: { status: 'FAILED', stage: 'FAILED', errorCode: 'LEASE_EXHAUSTED', lastError: '任务多次中断，请重试', retryable: true } });
      });
    }
    const jobs = await this.prisma.knowledgeProcessingJob.findMany({ where: { attempts: { lt: 3 }, OR: [
      { status: 'PENDING', nextRunAt: { lte: new Date() } }, { status: 'RUNNING', leaseUntil: { lte: new Date() } },
    ] }, orderBy: { nextRunAt: 'asc' }, take: 100 });
    for (const job of jobs) {
      // A fresh delivery id avoids a failed/completed Bull job blocking lease recovery.
      await this.queue.add('process-version', { jobId: job.id }, { removeOnComplete: true, removeOnFail: true });
    }
    this.ready = true;
  }
  private async maintain() {
    if (Date.now() - this.lastMaintenance < 60 * 60 * 1000) return;
    // Deployment must stop old workers first. Do not let old in-place tasks remain stuck forever.
    await this.prisma.document.updateMany({ where: { deletedAt: null, latestVersionId: null,
      status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: 'FAILED',
      lastError: '旧处理任务已停止，请通过版本重试重新处理' } });
    await this.storage.sweepUnreferenced(async storagePath => {
      const [original, version] = await Promise.all([
        this.prisma.document.findFirst({ where: { storagePath }, select: { id: true } }),
        this.prisma.documentVersion.findFirst({ where: { storagePath }, select: { id: true } }),
      ]);
      return !!(original || version);
    });
    this.lastMaintenance = Date.now();
  }
  async enqueue(_documentId: string) {
    throw new ServiceUnavailableException('旧文档队列已停用，请使用持久化版本作业');
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.dispatching;
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
  }
}
