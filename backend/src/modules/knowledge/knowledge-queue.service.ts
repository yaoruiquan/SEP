import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentProcessorService } from './document-processor.service';
import { resolveRedisOptions } from '../../redis/redis-connection';

/**
 * 知识库文档处理队列（Phase A1）
 *
 * 用 BullMQ 队列替代原来 fire-and-forget 的并发处理：
 *   - 上传成功后仅入队，由 Worker 串行消费（concurrency=2），
 *     避免并发上传同时打爆单实例 TEI。
 *   - 进程重启后，启动时扫描卡死在 PROCESSING 超过 10 分钟的文档重新入队。
 *
 * 队列名：knowledge-processing；job = { documentId }；失败重试 2 次（共 3 次尝试）。
 */

export interface KnowledgeProcessingJob {
  documentId: string;
}

const QUEUE_NAME = 'knowledge-processing';
const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 分钟

@Injectable()
export class KnowledgeQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KnowledgeQueueService.name);

  private queue: Queue<KnowledgeProcessingJob>;
  private worker: Worker<KnowledgeProcessingJob>;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly processor: DocumentProcessorService,
  ) {}

  onModuleInit() {
    const connection = resolveRedisOptions(this.config);

    this.queue = new Queue<KnowledgeProcessingJob>(QUEUE_NAME, { connection });

    this.worker = new Worker<KnowledgeProcessingJob>(
      QUEUE_NAME,
      async (job: Job<KnowledgeProcessingJob>) => {
        this.logger.log(`Worker picked up document ${job.data.documentId}`);
        await this.processor.processDocument(job.data.documentId);
      },
      {
        connection,
        concurrency: 2, // 2 核 CPU，蓝图设计值
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Document ${job.data.documentId} processed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Document ${job?.data?.documentId} finally failed: ${err.message}`,
      );
      // 安全兜底：极端情况下（例如文档已被删除导致 processor 自身 catch 无法落库），
      // 在此把终态落库为 FAILED + lastError。
      if (job?.data?.documentId) {
        this.markFailed(job.data.documentId, err).catch((markErr) =>
          this.logger.error(
            `Failed to mark document ${job.data.documentId} FAILED: ${markErr.message}`,
          ),
        );
      }
    });

    this.logger.log(
      `Knowledge processing queue initialized (concurrency=2, queue=${QUEUE_NAME})`,
    );

    // 启动时恢复卡死任务（fire-and-forget，不阻塞启动）
    void this.recoverStuckDocuments().catch((err) =>
      this.logger.error(`Failed to recover stuck documents: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await Promise.allSettled([
      this.worker?.close(),
      this.queue?.close(),
    ]);
  }

  /**
   * 将文档入队处理。
   * 失败重试 2 次（共 3 次尝试），指数退避 2s。
   */
  async enqueue(documentId: string) {
    return this.queue.add(
      'process-document',
      { documentId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100, // 保留最近 100 个成功任务
        removeOnFail: 500, // 保留最近 500 个失败任务
      },
    );
  }

  /**
   * 把文档标记为 FAILED + lastError（兜底）。
   */
  private async markFailed(documentId: string, err: Error): Promise<void> {
    await this.prisma.document
      .updateMany({
        where: { id: documentId },
        data: {
          status: 'FAILED',
          lastError: err?.message ? String(err.message).slice(0, 2000) : 'Processing failed',
        },
      })
      .catch(() => undefined); // 文档不存在时静默，避免掩盖原始错误
  }

  /**
   * 恢复卡死任务：扫描 PROCESSING 超过 10 分钟的文档，重置为 PENDING 并重新入队。
   */
  private async recoverStuckDocuments(): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

    const stuck = await this.prisma.document.findMany({
      where: {
        status: 'PROCESSING',
        updatedAt: { lt: cutoff },
      },
      select: { id: true, updatedAt: true },
    });

    if (stuck.length === 0) {
      return;
    }

    this.logger.warn(`Found ${stuck.length} stuck PROCESSING document(s), re-enqueueing`);

    for (const doc of stuck) {
      // 先重置为 PENDING，避免 UI 长期显示「处理中」
      await this.prisma.document.updateMany({
        where: { id: doc.id },
        data: { status: 'PENDING', lastError: null },
      });
      await this.enqueue(doc.id);
      this.logger.log(`Re-enqueued stuck document ${doc.id}`);
    }
  }
}
