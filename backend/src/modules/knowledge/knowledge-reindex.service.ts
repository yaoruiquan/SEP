import { ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { VectorService } from './vector.service';
import { TextTokenizer } from './text-tokenizer.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { Prisma } from '@prisma/client';
import { isPublishedChunk, publicationSelect, publishedChunkWhere } from './knowledge-publication';

export interface KnowledgeReindexResult {
  knowledgeBaseId: string;
  model: string;
  dimension: number;
  total: number;
  indexed: number;
  failed: number;
}

/** Rebuilds all vectors in one knowledge base with the active embedding model. */
@Injectable()
export class KnowledgeReindexService {
  private readonly logger = new Logger(KnowledgeReindexService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
    private readonly vector: VectorService,
    private readonly tokenizer: TextTokenizer,
    private readonly enterpriseContext: EnterpriseContextService,
  ) {}

  async reindex(userId: string, knowledgeBaseId: string): Promise<KnowledgeReindexResult> {
    const context = await this.enterpriseContext.resolve(userId);
    this.enterpriseContext.assertEnterpriseAdmin(context);
    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, deletedAt: null, enterpriseId: context.enterpriseId },
      select: { id: true, enterpriseId: true },
    });
    if (!knowledgeBase || knowledgeBase.enterpriseId !== context.enterpriseId) {
      throw new NotFoundException('Knowledge base not found');
    }

    if (!(await this.embedding.isAvailable())) {
      throw new ServiceUnavailableException(
        `Embedding 服务不可用：请确认 ${this.embedding.getModel()} 已启动且返回 ${this.embedding.getDimension()} 维向量`,
      );
    }

    const candidates = await this.prisma.textChunk.findMany({
      where: { knowledgeBaseId, ...publishedChunkWhere({ id: knowledgeBaseId, enterpriseId: context.enterpriseId }) },
      select: { id: true, content: true, knowledgeBaseId: true, ...publicationSelect },
      orderBy: { id: 'asc' },
    });
    const chunks = candidates.filter(isPublishedChunk);
    if (chunks.some(chunk => chunk.versionId !== null)) {
      throw new ConflictException({ code: 'KNOWLEDGE_VERSION_REINDEX_REQUIRED',
        message: '已发布版本不能原地重建，请通过新版本 generation 重新处理并发布' });
    }
    const model = this.embedding.getModel();
    const dimension = this.embedding.getDimension();
    let indexed = 0;
    let failed = 0;

    const batchSize = this.embedding.getBatchSize();
    for (let offset = 0; offset < chunks.length; offset += batchSize) {
      const batch = chunks.slice(offset, offset + batchSize);
      try {
        const embeddings = await this.embedding.embedBatch(batch.map((chunk) => chunk.content));
        if (embeddings.length !== batch.length) {
          throw new Error(`Embedding result count mismatch: expected ${batch.length}, got ${embeddings.length}`);
        }
        const written = await this.prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM knowledge_bases WHERE id = ${knowledgeBaseId} FOR UPDATE`;
          const documentIds = [...new Set(batch.map(chunk => chunk.documentId!))].sort();
          await tx.$queryRaw`SELECT id FROM documents WHERE id IN (${Prisma.join(documentIds)}) ORDER BY id FOR UPDATE`;
          const current = await tx.textChunk.findMany({
            where: { id: { in: batch.map(chunk => chunk.id) }, knowledgeBaseId,
              ...publishedChunkWhere({ id: knowledgeBaseId, enterpriseId: context.enterpriseId }) },
            select: { id: true, content: true, knowledgeBaseId: true, ...publicationSelect },
          });
          const live = new Map(current.filter(isPublishedChunk).map(chunk => [chunk.id, chunk]));
          let count = 0;
          for (const [index, chunk] of batch.entries()) {
            const fresh = live.get(chunk.id);
            if (fresh?.versionId !== null) continue;
            if (!fresh || fresh.documentId !== chunk.documentId || fresh.versionId !== chunk.versionId
              || fresh.indexGeneration !== chunk.indexGeneration || fresh.content !== chunk.content) continue;
            await tx.textChunk.update({ where: { id: chunk.id }, data: {
              embedding: Buffer.from(embeddings[index].embedding.buffer) as any,
              embeddingModel: model, tokens: this.tokenizer.tokenize(chunk.content),
            } });
            await this.vector.upsertVector(chunk.id, embeddings[index].embedding, tx);
            count += 1;
          }
          return count;
        }, { timeout: 30_000 });
        indexed += written;
        failed += batch.length - written;
      } catch (error) {
        failed += batch.length;
        this.logger.error(`Failed to reindex ${batch.length} chunks: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    this.vector.invalidateCache(knowledgeBase.enterpriseId, knowledgeBaseId);

    return { knowledgeBaseId, model, dimension, total: chunks.length, indexed, failed };
  }
}
