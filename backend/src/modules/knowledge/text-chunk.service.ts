import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTextChunkDto, UpdateTextChunkDto } from './dto/text-chunk.dto';
import { KnowledgeAccessPolicy } from './knowledge-access-policy';
import { isPublishedChunk, publicationSelect, publishedChunkWhere } from './knowledge-publication';

const chunkSelect = {
  id: true, knowledgeBaseId: true, documentId: true, title: true, content: true,
  source: true, tags: true, createdAt: true, updatedAt: true,
} satisfies Prisma.TextChunkSelect;
const publishedSelect = { ...chunkSelect, ...publicationSelect } satisfies Prisma.TextChunkSelect;

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
    const chunks = await this.prisma.textChunk.findMany({
      where: { knowledgeBaseId, ...publishedChunkWhere({ id: knowledgeBaseId }), ...(search ? { AND: [{ OR: [
        { title: { contains: search, mode: 'insensitive' as const } },
        { content: { contains: search, mode: 'insensitive' as const } }, { tags: { has: search } },
      ] }] } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], select: publishedSelect,
    });
    await this.policy.assertRead(userId, knowledgeBaseId);
    return chunks.filter(isPublishedChunk).map(chunk => this.present(chunk));
  }

  async getTextChunk(knowledgeBaseId: string, id: string, userId: string) {
    await this.policy.assertRead(userId, knowledgeBaseId);
    const chunk = await this.prisma.textChunk.findFirst({
      where: { id, knowledgeBaseId, ...publishedChunkWhere({ id: knowledgeBaseId }) }, select: publishedSelect,
    });
    await this.policy.assertRead(userId, knowledgeBaseId);
    if (!chunk || !isPublishedChunk(chunk)) throw new NotFoundException({ code: 'KNOWLEDGE_RESOURCE_NOT_FOUND', message: '片段不存在或不可访问' });
    return this.present(chunk);
  }

  private present(chunk: Prisma.TextChunkGetPayload<{ select: typeof chunkSelect }>) {
    const { id, knowledgeBaseId, documentId, title, content, source, tags, createdAt, updatedAt } = chunk;
    return { id, knowledgeBaseId, documentId, title, content, source, tags, createdAt, updatedAt };
  }

  async updateTextChunk(knowledgeBaseId: string, _id: string, _data: UpdateTextChunkDto, userId: string) {
    return this.retired(knowledgeBaseId, userId);
  }

  async deleteTextChunk(knowledgeBaseId: string, _id: string, userId: string) {
    return this.retired(knowledgeBaseId, userId);
  }
}
