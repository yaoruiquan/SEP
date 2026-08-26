import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { VectorService } from './vector.service';
import { TextTokenizer } from './text-tokenizer.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';

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
    const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { id: true, enterpriseId: true },
    });
    if (!knowledgeBase || knowledgeBase.enterpriseId !== context.enterpriseId) {
      throw new NotFoundException('Knowledge base not found');
    }

    if (!(await this.embedding.isAvailable())) {
      throw new Error('Embedding service is unavailable');
    }

    const chunks = await this.prisma.textChunk.findMany({
      where: { knowledgeBaseId },
      select: { id: true, content: true },
      orderBy: { id: 'asc' },
    });
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
        await this.prisma.$transaction(
          batch.map((chunk, index) => this.prisma.textChunk.update({
            where: { id: chunk.id },
            data: {
              embedding: Buffer.from(embeddings[index].embedding.buffer) as any,
              embeddingModel: model,
              tokens: this.tokenizer.tokenize(chunk.content),
            },
          })),
        );
        await Promise.all(batch.map((chunk, index) => this.vector.upsertVector(chunk.id, embeddings[index].embedding)));
        indexed += batch.length;
      } catch (error) {
        failed += batch.length;
        this.logger.error(`Failed to reindex ${batch.length} chunks: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    this.vector.invalidateCache(knowledgeBase.enterpriseId, knowledgeBaseId);

    return { knowledgeBaseId, model, dimension, total: chunks.length, indexed, failed };
  }
}
