import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentParserService } from './document-parser.service';
import { EmbeddingService } from './embedding.service';
import { VectorService } from './vector.service';
import { TextTokenizer } from './text-tokenizer.service';
import { TextChunker } from './text-chunker.util';

@Injectable()
export class DocumentProcessorService {
  private readonly logger = new Logger(DocumentProcessorService.name);

  constructor(
    private prisma: PrismaService,
    private parser: DocumentParserService,
    private embedding: EmbeddingService,
    private vector: VectorService,
    private tokenizer: TextTokenizer,
  ) {}

  /**
   * 处理文档：解析 → 分块 → 向量化 → 存储（Phase 2 重构）
   */
  async processDocument(documentId: string) {
    this.logger.log(`Processing document: ${documentId}`);

    try {
      // 1. 获取文档信息
      const document = await this.prisma.document.findUnique({
        where: { id: documentId },
      });

      if (!document) {
        throw new Error('Document not found');
      }

      // 更新状态为处理中（并清除上一次的失败原因）
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'PROCESSING', lastError: null },
      });

      // 2. 解析文档
      this.logger.log(`Parsing document: ${document.originalName}`);
      const parsed = await this.parser.parseDocument(
        document.storagePath,
        document.mimeType,
      );

      // 清理文本
      const cleanedText = this.parser.cleanText(parsed.text);

      if (!cleanedText || cleanedText.length < 10) {
        throw new Error('Document contains no meaningful text');
      }

      this.logger.log(`Extracted ${cleanedText.length} characters`);

      // 3. 文本分块
      const chunks = TextChunker.chunkByParagraphs(cleanedText, 1000);
      this.logger.log(`Split into ${chunks.length} chunks`);

      if (chunks.length === 0) {
        throw new Error('Failed to chunk document');
      }

      // BullMQ 重试可能发生在上一次部分写入之后，先清理旧片段保证幂等。
      await this.prisma.textChunk.deleteMany({ where: { documentId } });

      // 删除旧片段后立即失效缓存，避免后续降级或失败时仍返回旧向量。
      const kb = await this.prisma.knowledgeBase.findUnique({
        where: { id: document.knowledgeBaseId },
        select: { enterpriseId: true },
      });
      if (kb) {
        this.vector.invalidateCache(kb.enterpriseId, document.knowledgeBaseId);
      }

      // 4. 检查 Embedding 服务是否可用
      const embeddingAvailable = await this.embedding.isAvailable();

      if (!embeddingAvailable) {
        this.logger.warn('Embedding service not available, storing chunks without vectors');
        await this.storeChunksWithoutVectors(document, chunks);
        return;
      }

      // 5. 生成向量
      this.logger.log('Generating embeddings...');
      const embeddingResults = await this.embedding.embedBatch(chunks);
      const model = this.embedding.getModel();

      // 6. 分词（用于 BM25）
      const tokenizedChunks = chunks.map((chunk) => this.tokenizer.tokenize(chunk));

      // 7. 存储文本片段 + 向量到数据库（Phase 2：单一存储）
      await Promise.all(
        chunks.map((content, index) => {
          const embeddingBuffer = Buffer.from(embeddingResults[index].embedding.buffer) as any;

          return this.prisma.textChunk.create({
            data: {
              knowledgeBaseId: document.knowledgeBaseId,
              documentId: document.id,
              content,
              source: document.filename,
              tags: [],
              createdBy: document.uploadedBy,
              embedding: embeddingBuffer,
              embeddingModel: model,
              tokens: tokenizedChunks[index],
            },
          });
        }),
      );

      this.logger.log(`Stored ${chunks.length} text chunks with embeddings and tokens`);

      // 8. 更新文档状态为完成
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'READY',
          lastError: null,
          processedAt: new Date(),
          embeddingModel: model,
        },
      });

      this.logger.log(`Document processing completed: ${documentId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to process document ${documentId}: ${message}`);

      // 更新文档状态为失败 + 记录失败原因
      await this.prisma.document.updateMany({
        where: { id: documentId },
        data: { status: 'FAILED', lastError: message.slice(0, 2000) },
      });

      throw error;
    }
  }

  /**
   * 当 Embedding 服务不可用时，只存储文本片段 + tokens
   */
  private async storeChunksWithoutVectors(document: any, chunks: string[]) {
    const tokenizedChunks = chunks.map((chunk) => this.tokenizer.tokenize(chunk));

    await Promise.all(
      chunks.map((content, index) =>
        this.prisma.textChunk.create({
          data: {
            knowledgeBaseId: document.knowledgeBaseId,
            documentId: document.id,
            content,
            source: document.filename,
            tags: [],
            createdBy: document.uploadedBy,
            tokens: tokenizedChunks[index],
          },
        }),
      ),
    );

    const degradationReason = 'Embedding 服务不可用，已降级为仅词法检索存储（无向量）';
    await this.prisma.document.update({
      where: { id: document.id },
      data: {
        status: 'READY',
        lastError: degradationReason,
        processedAt: new Date(),
        embeddingModel: null,
      },
    });

    // B3：可用性可见性 —— 记录降级原因（日志 + lastError）
    this.logger.warn(
      `[embedding unavailable] Document ${document.id} stored without vectors: ${degradationReason}`,
    );
  }

  /**
   * 重新处理文档（Phase A2：状态守卫 + 原子抢占）
   *
   * 仅 READY / FAILED 可重处理；PROCESSING 直接抛 409。
   * 用 updateMany 条件更新原子抢占为 PROCESSING，count=0 视为抢占失败，
   * 避免与正在处理中的任务竞态产生脏 chunks。
   */
  async reprocessDocument(documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { knowledgeBase: true },
    });

    if (!document) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }

    // 状态守卫 + 原子抢占（仅当 READY / FAILED 时才允许）
    const claimed = await this.prisma.document.updateMany({
      where: { id: documentId, status: { in: ['READY', 'FAILED'] } },
      data: { status: 'PROCESSING', lastError: null },
    });

    if (claimed.count === 0) {
      throw new ConflictException('文档正在处理中');
    }

    // 删除关联的文本片段（Phase 2：通过 documentId 删除）
    await this.prisma.textChunk.deleteMany({
      where: { documentId },
    });

    // 使缓存失效
    this.vector.invalidateCache(document.knowledgeBase.enterpriseId, document.knowledgeBaseId);

    // 重新处理（processDocument 内部会幂等地再次置为 PROCESSING）
    await this.processDocument(documentId);
  }
}
