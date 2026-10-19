import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { KnowledgeSearchService } from './knowledge-search.service';
import { DocumentProcessorService } from './document-processor.service';
import type { TestSearchDto, BatchReprocessDto } from 'shared';

// ── 检索测试 ──────────────────────────────────────────────────────────────────

export interface TestSearchResult {
  chunkId: string;
  content: string;
  source: string;
  score: number;
  knowledgeBaseId: string;
  documentId?: string;
  documentName?: string;
}

export interface TestSearchResponse {
  query: string;
  topK: number;
  scoreThreshold: number;
  strategy: string;
  hitCount: number;
  durationMs: number;
  results: TestSearchResult[];
}

// ── 文档状态 ──────────────────────────────────────────────────────────────────

export interface DocumentStatusSummary {
  total: number;
  vectorized: number;
  pending: number;
  processing: number;
  ready: number;
  failed: number;
  documents: {
    id: string;
    originalName: string;
    status: string;
    lastError: string | null;
    processedAt: Date | null;
    embeddingModel: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }[];
}

// ── 批量重处理 ────────────────────────────────────────────────────────────────

export interface BatchReprocessResponse {
  queued: number;
  skipped: number;
  documentIds: string[];
}

@Injectable()
export class KnowledgeTestService {
  private readonly logger = new Logger(KnowledgeTestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly searchService: KnowledgeSearchService,
    private readonly processor: DocumentProcessorService,
  ) {}

  // ── 检索测试 ────────────────────────────────────────────────────────────────

  async testSearch(
    knowledgeBaseId: string,
    enterpriseId: string,
    dto: TestSearchDto,
    userId: string,
  ): Promise<TestSearchResponse> {
    // 验证知识库归属
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, enterpriseId },
    });
    if (!kb) throw new NotFoundException('知识库不存在或无权访问');

    const start = Date.now();
    const results = await this.searchService.searchByKnowledgeBase(
      dto.query,
      [knowledgeBaseId],
      dto.topK,
      dto.scoreThreshold,
      dto.strategy || 'auto',
      userId,
    );
    const durationMs = Date.now() - start;

    const strategy = dto.strategy || 'auto';

    // 记录检索日志（isTest=true）
    await this.prisma.knowledgeSearchLog.create({
      data: {
        knowledgeBaseId,
        enterpriseId,
        query: '[REDACTED]',
        topK: dto.topK,
        hitCount: results.length,
        topScore: results.length > 0 ? results[0].score : null,
        strategy,
        isTest: true,
        durationMs,
      },
    }).catch(() => this.logger.warn('Failed to record knowledge test search log'));

    return {
      query: dto.query,
      topK: dto.topK,
      scoreThreshold: dto.scoreThreshold,
      strategy,
      hitCount: results.length,
      durationMs,
      results: results.map((r) => ({
        chunkId: r.chunkId,
        content: r.content,
        source: r.source,
        score: r.score,
        knowledgeBaseId: r.knowledgeBaseId,
        documentId: r.documentId,
        documentName: r.documentName,
      })),
    };
  }

  // ── 文档处理状态 ────────────────────────────────────────────────────────────

  async getDocumentStatus(
    knowledgeBaseId: string,
    enterpriseId: string,
  ): Promise<DocumentStatusSummary> {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, enterpriseId },
    });
    if (!kb) throw new NotFoundException('知识库不存在或无权访问');

    const rows = await this.prisma.document.findMany({
      where: { knowledgeBaseId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        originalName: true,
        status: true,
        lastError: true,
        processedAt: true,
        embeddingModel: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        activeVersionId: true,
        latestVersionId: true,
        revision: true,
        versions: { select: { id: true, version: true, status: true, stage: true, errorCode: true, lastError: true,
          retryable: true, attempts: true, processedChunks: true, totalChunks: true } },
      },
    });

    const documents = rows.map(({ versions, ...doc }) => {
      const latest = versions.find(v => v.id === doc.latestVersionId);
      return { ...doc, status: latest?.status ?? doc.status, version: latest?.version ?? doc.version,
        stage: latest?.stage ?? null, retryable: latest?.retryable ?? doc.status === 'FAILED',
        lastError: latest?.lastError ?? (doc.status === 'FAILED' ? '文档处理失败，请重试或更换文件' : null),
        errorCode: latest?.errorCode ?? null, processedChunks: latest?.processedChunks ?? 0,
        totalChunks: latest?.totalChunks ?? null, embeddingModel: null };
    });

    const counts = documents.reduce(
      (acc, doc) => {
        const key = doc.status.toLowerCase() as keyof typeof acc;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      { pending: 0, processing: 0, ready: 0, failed: 0 },
    );

    const vectorized = rows.filter((doc) => doc.embeddingModel !== null).length;

    return {
      total: documents.length,
      vectorized,
      ...counts,
      documents,
    };
  }

  // ── 单文档重处理 ────────────────────────────────────────────────────────────

  async reprocessDocument(documentId: string, enterpriseId: string): Promise<void> {
    const doc = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        knowledgeBase: { enterpriseId },
      },
    });
    if (!doc) throw new NotFoundException('文档不存在或无权访问');

    this.logger.log(`Reprocessing document ${documentId} (enterprise ${enterpriseId})`);
    // 异步执行，不阻塞响应
    this.processor.reprocessDocument(documentId).catch((err) => {
      this.logger.error(`Reprocess failed for ${documentId}: ${err.message}`);
    });
  }

  // ── 批量重处理 ──────────────────────────────────────────────────────────────

  async batchReprocess(
    knowledgeBaseId: string,
    enterpriseId: string,
    dto: BatchReprocessDto,
  ): Promise<BatchReprocessResponse> {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, enterpriseId },
    });
    if (!kb) throw new NotFoundException('知识库不存在或无权访问');

    const statusFilter = dto.statuses ?? ['FAILED'];

    const whereClause: any = {
      knowledgeBaseId,
      status: { in: statusFilter },
    };
    if (dto.documentIds?.length) {
      whereClause.id = { in: dto.documentIds };
    }

    const docs = await this.prisma.document.findMany({
      where: whereClause,
      select: { id: true, status: true },
    });

    // 过滤掉已在处理中的文档，避免重复触发
    const toProcess = docs.filter((d) => d.status !== 'PROCESSING');
    const skipped = docs.length - toProcess.length;

    for (const doc of toProcess) {
      this.processor.reprocessDocument(doc.id).catch((err) => {
        this.logger.error(`Batch reprocess failed for ${doc.id}: ${err.message}`);
      });
    }

    return {
      queued: toProcess.length,
      skipped,
      documentIds: toProcess.map((d) => d.id),
    };
  }
}
