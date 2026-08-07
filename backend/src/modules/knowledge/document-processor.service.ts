import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentParserService } from './document-parser.service';
import { EmbeddingService } from './embedding.service';
import { VectorService } from './vector.service';
import { TextChunker } from './text-chunker.util';

@Injectable()
export class DocumentProcessorService {
  private readonly logger = new Logger(DocumentProcessorService.name);

  constructor(
    private prisma: PrismaService,
    private parser: DocumentParserService,
    private embedding: EmbeddingService,
    private vector: VectorService,
  ) {}

  /**
   * 处理文档：解析 → 分块 → 向量化 → 存储
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

      // 更新状态为处理中
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'PENDING' },
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

      // 4. 生成向量
      if (!this.embedding.isAvailable()) {
        this.logger.warn('Embedding service not available, storing chunks without vectors');
        await this.storeChunksWithoutVectors(document, chunks);
        return;
      }

      this.logger.log('Generating embeddings...');
      const embeddings = await this.embedding.embedBatch(chunks);

      // 5. 存储文本片段到数据库
      const textChunks = await Promise.all(
        chunks.map((content, index) =>
          this.prisma.textChunk.create({
            data: {
              knowledgeBaseId: document.knowledgeBaseId,
              content,
              source: document.filename,
              tags: [],
              createdBy: document.uploadedBy,
            },
          }),
        ),
      );

      this.logger.log(`Stored ${textChunks.length} text chunks`);

      // 6. 存储向量到 Pinecone
      if (this.vector.isAvailable()) {
        const vectors = textChunks.map((chunk, index) => ({
          id: chunk.id,
          values: embeddings[index],
          metadata: {
            knowledgeBaseId: document.knowledgeBaseId,
            chunkId: chunk.id,
            content: chunk.content.substring(0, 500), // 只存储前 500 字符作为预览
            source: document.filename,
          },
        }));

        await this.vector.upsertVectors(vectors);
        this.logger.log(`Upserted ${vectors.length} vectors to Pinecone`);
      }

      // 7. 更新文档状态为完成
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'READY' },
      });

      this.logger.log(`Document processing completed: ${documentId}`);
    } catch (error) {
      this.logger.error(`Failed to process document ${documentId}: ${error.message}`);

      // 更新文档状态为失败
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'FAILED' },
      });

      throw error;
    }
  }

  /**
   * 当 Embedding 服务不可用时，只存储文本片段
   */
  private async storeChunksWithoutVectors(document: any, chunks: string[]) {
    await Promise.all(
      chunks.map((content) =>
        this.prisma.textChunk.create({
          data: {
            knowledgeBaseId: document.knowledgeBaseId,
            content,
            source: document.filename,
            tags: [],
            createdBy: document.uploadedBy,
          },
        }),
      ),
    );

    await this.prisma.document.update({
      where: { id: document.id },
      data: { status: 'READY' },
    });

    this.logger.log('Stored chunks without vectors (embedding service unavailable)');
  }

  /**
   * 重新处理文档
   */
  async reprocessDocument(documentId: string) {
    // 删除旧的文本片段和向量
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { knowledgeBase: true },
    });

    if (!document) {
      throw new Error('Document not found');
    }

    // 删除关联的文本片段
    await this.prisma.textChunk.deleteMany({
      where: {
        knowledgeBaseId: document.knowledgeBaseId,
        source: document.filename,
      },
    });

    // 删除向量
    if (this.vector.isAvailable()) {
      await this.vector.deleteByDocument(document.knowledgeBaseId, document.id);
    }

    // 重新处理
    await this.processDocument(documentId);
  }
}
