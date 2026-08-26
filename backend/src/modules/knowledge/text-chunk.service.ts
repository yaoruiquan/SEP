import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTextChunkDto, UpdateTextChunkDto } from './dto/text-chunk.dto';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { VectorService } from './vector.service';
import { EmbeddingService } from './embedding.service';
import { TextTokenizer } from './text-tokenizer.service';

@Injectable()
export class TextChunkService {
  constructor(
    private prisma: PrismaService,
    private enterpriseContext: EnterpriseContextService,
    private vector: VectorService,
    private embedding: EmbeddingService,
    private tokenizer: TextTokenizer,
  ) {}

  /**
   * 创建文本片段
   */
  async createTextChunk(
    knowledgeBaseId: string,
    data: CreateTextChunkDto,
    userId: string,
  ) {
    await this.assertAdminAccess(knowledgeBaseId, userId);

    const content = data.content;
    const tokens = this.tokenizer.tokenize(content);
    let embedding: any;
    let embeddingModel: string | undefined;
    let embeddingVector: Float32Array | undefined;
    if (await this.embedding.isAvailable()) {
      try {
        const result = await this.embedding.embed(content);
        embedding = Buffer.from(result.embedding.buffer) as any;
        embeddingModel = result.model;
        embeddingVector = result.embedding;
      } catch {
        // 手动片段仍可通过词法检索使用，状态由 embeddingModel=null 表示降级。
      }
    }

    const textChunk = await this.prisma.textChunk.create({
      data: {
        knowledgeBaseId,
        title: data.title || null,
        content,
        source: 'manual', // 手动创建的标记为 manual
        tags: data.tags || [],
        createdBy: userId,
        tokens,
        embedding,
        embeddingModel,
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (embeddingVector) {
      await this.vector.upsertVector(textChunk.id, embeddingVector);
    }

    return textChunk;
  }

  /**
   * 获取知识库的文本片段列表
   */
  async listTextChunks(knowledgeBaseId: string, userId: string, search?: string) {
    await this.assertReadAccess(knowledgeBaseId, userId);
    const where: any = { knowledgeBaseId };

    // 如果有搜索关键词，在标题和内容中搜索
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
        { tags: { has: search } },
      ];
    }

    const textChunks = await this.prisma.textChunk.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        content: true,
        source: true,
        tags: true,
        createdAt: true,
        updatedAt: true,
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return textChunks;
  }

  /**
   * 获取单个文本片段详情
   */
  async getTextChunk(knowledgeBaseId: string, id: string, userId: string) {
    await this.assertReadAccess(knowledgeBaseId, userId);
    const textChunk = await this.prisma.textChunk.findUnique({
      where: { id, knowledgeBaseId },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!textChunk) {
      throw new NotFoundException('Text chunk not found');
    }

    return textChunk;
  }

  /**
   * 更新文本片段
   */
  async updateTextChunk(knowledgeBaseId: string, id: string, data: UpdateTextChunkDto, userId: string) {
    await this.assertAdminAccess(knowledgeBaseId, userId);
    const textChunk = await this.prisma.textChunk.findUnique({
      where: { id, knowledgeBaseId },
    });

    if (!textChunk) {
      throw new NotFoundException('Text chunk not found');
    }

    const searchFields = data.content !== undefined
      ? await this.buildSearchFields(data.content)
      : { fields: {}, vector: undefined };
    const updated = await this.prisma.textChunk.update({
      where: { id },
      data: {
        title: data.title !== undefined ? data.title : undefined,
        content: data.content,
        tags: data.tags !== undefined ? data.tags : undefined,
        ...searchFields.fields,
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (data.content !== undefined) {
      if (searchFields.vector) {
        await this.vector.upsertVector(updated.id, searchFields.vector);
      } else {
        await this.vector.clearVector(updated.id);
      }
    }

    this.vector.invalidateCache(
      (await this.enterpriseContext.resolve(userId)).enterpriseId,
      knowledgeBaseId,
    );

    return updated;
  }

  /**
   * 删除文本片段
   */
  async deleteTextChunk(knowledgeBaseId: string, id: string, userId: string) {
    await this.assertAdminAccess(knowledgeBaseId, userId);
    const textChunk = await this.prisma.textChunk.findUnique({
      where: { id, knowledgeBaseId },
    });

    if (!textChunk) {
      throw new NotFoundException('Text chunk not found');
    }

    await this.prisma.textChunk.delete({
      where: { id },
    });

    const context = await this.enterpriseContext.resolve(userId);
    this.vector.invalidateCache(context.enterpriseId, knowledgeBaseId);
  }

  private async assertAdminAccess(knowledgeBaseId: string, userId: string): Promise<void> {
    const context = await this.enterpriseContext.resolve(userId);
    this.enterpriseContext.assertEnterpriseAdmin(context);
    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, enterpriseId: context.enterpriseId },
      select: { id: true },
    });
    if (!knowledgeBase) throw new NotFoundException('Knowledge base not found');
  }

  private async buildSearchFields(content: string): Promise<{ fields: any; vector?: Float32Array }> {
    const fields: any = {
      tokens: this.tokenizer.tokenize(content),
    };
    let vector: Float32Array | undefined;
    if (await this.embedding.isAvailable()) {
      try {
        const result = await this.embedding.embed(content);
        fields.embedding = Buffer.from(result.embedding.buffer) as any;
        fields.embeddingModel = result.model;
        vector = result.embedding;
      } catch {
        fields.embedding = null;
        fields.embeddingModel = null;
      }
    }
    return { fields, vector };
  }

  private async assertReadAccess(knowledgeBaseId: string, userId: string): Promise<void> {
    const context = await this.enterpriseContext.resolve(userId);
    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, enterpriseId: context.enterpriseId },
      select: { id: true },
    });
    if (!knowledgeBase) throw new NotFoundException('Knowledge base not found');
  }
}
