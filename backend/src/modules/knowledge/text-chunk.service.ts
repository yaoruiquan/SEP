import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTextChunkDto, UpdateTextChunkDto } from './dto/text-chunk.dto';
import { KnowledgeAccessPolicy } from './knowledge-access-policy';

const chunkSelect = {
  id: true, knowledgeBaseId: true, documentId: true, title: true, content: true,
  source: true, tags: true, createdAt: true, updatedAt: true,
};

@Injectable()
export class TextChunkService {
  constructor(private prisma: PrismaService, private policy: KnowledgeAccessPolicy) {}

  private async retired(knowledgeBaseId: string, userId: string): Promise<never> {
    await this.policy.assertRead(userId, knowledgeBaseId);
    throw new GoneException({ code: 'KNOWLEDGE_OPERATION_RETIRED', message: '手工片段写入已停用' });
  }

  async createTextChunk(knowledgeBaseId: string, _data: CreateTextChunkDto, userId: string) {
    return this.retired(knowledgeBaseId, userId);
  }

  async listTextChunks(knowledgeBaseId: string, userId: string, search?: string) {
    await this.policy.assertRead(userId, knowledgeBaseId);
    return this.prisma.textChunk.findMany({
      where: { knowledgeBaseId, document: { status: 'READY' }, ...(search ? { OR: [
        { title: { contains: search, mode: 'insensitive' as const } },
        { content: { contains: search, mode: 'insensitive' as const } }, { tags: { has: search } },
      ] } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], select: chunkSelect,
    });
  }

  async getTextChunk(knowledgeBaseId: string, id: string, userId: string) {
    await this.policy.assertRead(userId, knowledgeBaseId);
    const chunk = await this.prisma.textChunk.findFirst({
      where: { id, knowledgeBaseId, document: { status: 'READY' } }, select: chunkSelect,
    });
    if (!chunk) throw new NotFoundException({ code: 'KNOWLEDGE_RESOURCE_NOT_FOUND', message: '片段不存在或不可访问' });
    return chunk;
  }

  async updateTextChunk(knowledgeBaseId: string, _id: string, _data: UpdateTextChunkDto, userId: string) {
    return this.retired(knowledgeBaseId, userId);
  }

  async deleteTextChunk(knowledgeBaseId: string, _id: string, userId: string) {
    return this.retired(knowledgeBaseId, userId);
  }
}
