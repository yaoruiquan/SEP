import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTextChunkDto, UpdateTextChunkDto } from './dto/text-chunk.dto';

@Injectable()
export class TextChunkService {
  constructor(private prisma: PrismaService) {}

  /**
   * 创建文本片段
   */
  async createTextChunk(
    knowledgeBaseId: string,
    data: CreateTextChunkDto,
    userId: string,
  ) {
    // 验证知识库是否存在
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
    });

    if (!kb) {
      throw new NotFoundException('Knowledge base not found');
    }

    const textChunk = await this.prisma.textChunk.create({
      data: {
        knowledgeBaseId,
        title: data.title || null,
        content: data.content,
        source: 'manual', // 手动创建的标记为 manual
        tags: data.tags || [],
        createdBy: userId,
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

    return textChunk;
  }

  /**
   * 获取知识库的文本片段列表
   */
  async listTextChunks(knowledgeBaseId: string, search?: string) {
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
  async getTextChunk(id: string) {
    const textChunk = await this.prisma.textChunk.findUnique({
      where: { id },
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
  async updateTextChunk(id: string, data: UpdateTextChunkDto) {
    const textChunk = await this.prisma.textChunk.findUnique({
      where: { id },
    });

    if (!textChunk) {
      throw new NotFoundException('Text chunk not found');
    }

    const updated = await this.prisma.textChunk.update({
      where: { id },
      data: {
        title: data.title !== undefined ? data.title : undefined,
        content: data.content,
        tags: data.tags !== undefined ? data.tags : undefined,
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

    return updated;
  }

  /**
   * 删除文本片段
   */
  async deleteTextChunk(id: string) {
    const textChunk = await this.prisma.textChunk.findUnique({
      where: { id },
    });

    if (!textChunk) {
      throw new NotFoundException('Text chunk not found');
    }

    await this.prisma.textChunk.delete({
      where: { id },
    });
  }
}
