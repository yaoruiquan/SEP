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
    );
    const durationMs = Date.now() - start;

    const strategy = dto.strategy || 'auto';

    // 记录检索日志（isTest=true）
    await this.prisma.knowledgeSearchLog.create({
      data: {
        knowledgeBaseId,
        enterpriseId,
        query: dto.query,
        topK: dto.topK,
        hitCount: results.length,
        topScore: results.length > 0 ? results[0].score : null,
        strategy,
        isTest: true,
        durationMs,
      },
    });

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

    const documents = await this.prisma.document.findMany({
      where: { knowledgeBaseId },
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
      },
    });

    const counts = documents.reduce(
      (acc, doc) => {
        const key = doc.status.toLowerCase() as keyof typeof acc;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      { pending: 0, processing: 0, ready: 0, failed: 0 },
    );

    return {
      total: documents.length,
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
