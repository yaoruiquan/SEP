import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { VectorService } from './vector.service';

export interface SearchResult {
  content: string;
  source: string;
  score: number;
  knowledgeBaseId: string;
  chunkId: string;
}

export interface SearchResponse {
  count: number;
  results: SearchResult[];
}

@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);

  constructor(
    private prisma: PrismaService,
    private embedding: EmbeddingService,
    private vector: VectorService,
  ) {}

  /**
   * 检索知识库内容
   * @param query 用户查询
   * @param instanceId 数字员工实例 ID
   * @param topK 返回结果数量
   * @param scoreThreshold 相似度阈值
   */
  async search(
    query: string,
    instanceId: string,
    topK: number = 5,
    scoreThreshold: number = 0.7,
  ): Promise<SearchResponse> {
    this.logger.log(`Searching for: "${query}" (instance: ${instanceId})`);

    // 1. 获取该员工实例授权的知识库列表
    const grants = await this.prisma.knowledgeGrant.findMany({
      where: { instanceId },
      include: { knowledgeBase: true },
    });

    if (grants.length === 0) {
      this.logger.warn(`No knowledge bases granted to instance ${instanceId}`);
      return { count: 0, results: [] };
    }

    const knowledgeBaseIds = grants.map((g) => g.knowledgeBaseId);
    this.logger.log(`Searching across ${knowledgeBaseIds.length} knowledge bases`);

    // 2. 如果向量服务不可用，使用全文搜索回退
    if (!this.vector.isAvailable() || !this.embedding.isAvailable()) {
      this.logger.warn('Vector/Embedding service unavailable, using fallback text search');
      const results = await this.fallbackTextSearch(query, knowledgeBaseIds, topK);
      return { count: results.length, results };
    }

    // 3. 将查询向量化
    const queryVector = await this.embedding.embedText(query);

    // 4. 在向量数据库中搜索
    const vectorResults = await this.vector.search(
      queryVector,
      knowledgeBaseIds,
      topK,
      scoreThreshold,
    );

    // 5. 转换结果格式
    const results = vectorResults.map((result) => ({
      content: result.metadata.content,
      source: result.metadata.source,
      score: result.score,
      knowledgeBaseId: result.metadata.knowledgeBaseId,
      chunkId: result.metadata.chunkId,
    }));

    return { count: results.length, results };
  }

  /**
   * 回退到全文搜索（当向量服务不可用时）
   */
  private async fallbackTextSearch(
    query: string,
    knowledgeBaseIds: string[],
    topK: number,
  ): Promise<SearchResult[]> {
    const chunks = await this.prisma.textChunk.findMany({
      where: {
        knowledgeBaseId: { in: knowledgeBaseIds },
        OR: [
          { content: { contains: query, mode: 'insensitive' } },
          { title: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: topK,
      orderBy: { createdAt: 'desc' },
    });

    return chunks.map((chunk) => ({
      content: chunk.content,
      source: chunk.source,
      score: 0.8, // 固定分数
      knowledgeBaseId: chunk.knowledgeBaseId,
      chunkId: chunk.id,
    }));
  }

  /** 向量检索是否可用（用于 UI 显示当前策略） */
  isVectorAvailable(): boolean {
    return this.vector.isAvailable() && this.embedding.isAvailable();
  }

  /**
   * 直接按知识库 ID 搜索（不检查授权）
   */
  async searchByKnowledgeBase(
    query: string,
    knowledgeBaseIds: string[],
    topK: number = 5,
    scoreThreshold: number = 0.7,
  ): Promise<SearchResult[]> {
    if (!this.vector.isAvailable() || !this.embedding.isAvailable()) {
      return this.fallbackTextSearch(query, knowledgeBaseIds, topK);
    }

    const queryVector = await this.embedding.embedText(query);
    const results = await this.vector.search(
      queryVector,
      knowledgeBaseIds,
      topK,
      scoreThreshold,
    );

    return results.map((result) => ({
      content: result.metadata.content,
      source: result.metadata.source,
      score: result.score,
      knowledgeBaseId: result.metadata.knowledgeBaseId,
      chunkId: result.metadata.chunkId,
    }));
  }
}
