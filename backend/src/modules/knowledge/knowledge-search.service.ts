import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { VectorService } from './vector.service';
import { LexicalSearchService } from './lexical-search.service';

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
  strategy: 'lexical' | 'vector' | 'hybrid';
  durationMs?: number;
}

type SearchStrategy = 'lexical' | 'vector' | 'hybrid' | 'auto';

@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);

  constructor(
    private prisma: PrismaService,
    private embedding: EmbeddingService,
    private vector: VectorService,
    private lexical: LexicalSearchService,
  ) {}

  /**
   * 检索知识库内容（Phase 2 重构）
   */
  async search(
    query: string,
    instanceId: string,
    topK: number = 5,
    scoreThreshold: number = 0.7,
    strategy: SearchStrategy = 'auto',
  ): Promise<SearchResponse> {
    const startTime = Date.now();
    this.logger.log(`Searching: "${query}" (instance: ${instanceId}, strategy: ${strategy})`);

    // 1. 安全边界：获取授权 + 企业隔离
    const instance = await this.prisma.employeeInstance.findUnique({
      where: { id: instanceId },
    });

    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    const enterpriseId = instance.enterpriseId;

    // 2. 获取授权的知识库（企业前置过滤）
    const grants = await this.prisma.knowledgeGrant.findMany({
      where: {
        instanceId,
        knowledgeBase: { enterpriseId },
      },
      select: { knowledgeBaseId: true },
    });

    if (grants.length === 0) {
      this.logger.warn(`No knowledge bases granted to instance ${instanceId}`);
      return { count: 0, results: [], strategy: 'lexical', durationMs: Date.now() - startTime };
    }

    const kbIds = grants.map((g) => g.knowledgeBaseId);

    // 3. 策略选择
    const actualStrategy = await this.resolveStrategy(strategy);

    // 4. 执行检索
    let results: SearchResult[];

    switch (actualStrategy) {
      case 'lexical':
        results = await this.searchLexical(query, enterpriseId, kbIds, topK);
        break;
      case 'vector':
        results = await this.searchVector(query, enterpriseId, kbIds, topK, scoreThreshold);
        break;
      case 'hybrid':
        results = await this.searchHybrid(query, enterpriseId, kbIds, topK, scoreThreshold);
        break;
    }

    const durationMs = Date.now() - startTime;
    this.logger.log(`Search completed in ${durationMs}ms (${results.length} results, strategy: ${actualStrategy})`);

    return { count: results.length, results, strategy: actualStrategy, durationMs };
  }

  /**
   * 策略解析：auto → 实际策略
   */
  private async resolveStrategy(strategy: SearchStrategy): Promise<'lexical' | 'vector' | 'hybrid'> {
    if (strategy !== 'auto') {
      return strategy;
    }

    // auto 模式：优先 hybrid，降级 lexical
    const embeddingAvailable = await this.embedding.isAvailable();
    return embeddingAvailable ? 'hybrid' : 'lexical';
  }

  /**
   * 词法检索
   */
  private async searchLexical(
    query: string,
    enterpriseId: string,
    kbIds: string[],
    topK: number,
  ): Promise<SearchResult[]> {
    const lexicalResults = await this.lexical.search(query, enterpriseId, kbIds, topK);

    return lexicalResults.map((r) => ({
      chunkId: r.chunkId,
      content: r.content,
      source: 'lexical',
      knowledgeBaseId: '',
      score: r.score,
    }));
  }

  /**
   * 向量检索
   */
  private async searchVector(
    query: string,
    enterpriseId: string,
    kbIds: string[],
    topK: number,
    scoreThreshold: number,
  ): Promise<SearchResult[]> {
    // 检查服务可用性
    const embeddingAvailable = await this.embedding.isAvailable();
    if (!embeddingAvailable) {
      this.logger.warn('Embedding service unavailable, returning empty results');
      return [];
    }

    const embeddingResult = await this.embedding.embed(query);
    const queryVector = embeddingResult.embedding;

    const vectorResults = await this.vector.search(queryVector, enterpriseId, kbIds, topK);

    // 过滤低分
    const filtered = vectorResults.filter((r) => r.score >= scoreThreshold);

    // 补充 chunk 内容
    const chunkIds = filtered.map((r) => r.chunkId);
    const chunks = await this.prisma.textChunk.findMany({
      where: { id: { in: chunkIds } },
      select: { id: true, content: true, source: true, knowledgeBaseId: true },
    });

    const chunkMap = new Map(chunks.map((c) => [c.id, c]));

    return filtered
      .map((r) => {
        const chunk = chunkMap.get(r.chunkId);
        if (!chunk) return null;
        return {
          chunkId: r.chunkId,
          content: chunk.content,
          source: chunk.source,
          knowledgeBaseId: chunk.knowledgeBaseId,
          score: r.score,
        };
      })
      .filter((r): r is SearchResult => r !== null);
  }

  /**
   * 混合检索：Lexical + Vector + RRF Fusion
   */
  private async searchHybrid(
    query: string,
    enterpriseId: string,
    kbIds: string[],
    topK: number,
    scoreThreshold: number,
  ): Promise<SearchResult[]> {
    // 检查服务可用性，降级为 lexical
    const embeddingAvailable = await this.embedding.isAvailable();
    if (!embeddingAvailable) {
      this.logger.warn('Embedding service unavailable, falling back to lexical search');
      return this.searchLexical(query, enterpriseId, kbIds, topK);
    }

    // 并行执行词法和向量检索
    const [lexicalResults, vectorResults] = await Promise.all([
      this.lexical.search(query, enterpriseId, kbIds, topK * 2),
      (async () => {
        const embeddingResult = await this.embedding.embed(query);
        return this.vector.search(embeddingResult.embedding, enterpriseId, kbIds, topK * 2);
      })(),
    ]);

    // RRF 融合
    const merged = this.reciprocalRankFusion(
      lexicalResults.map((r) => ({ chunkId: r.chunkId, score: r.score })),
      vectorResults.map((r) => ({ chunkId: r.chunkId, score: r.score })),
    );

    // 取 top K
    const topResults = merged.slice(0, topK);

    // 批量加载 chunk 内容
    const chunkIds = topResults.map((r) => r.chunkId);
    const chunks = await this.prisma.textChunk.findMany({
      where: { id: { in: chunkIds } },
      select: { id: true, content: true, source: true, knowledgeBaseId: true },
    });

    const chunkMap = new Map(chunks.map((c) => [c.id, c]));

    return topResults
      .map((r) => {
        const chunk = chunkMap.get(r.chunkId);
        if (!chunk) return null;
        return {
          chunkId: r.chunkId,
          content: chunk.content,
          source: chunk.source,
          knowledgeBaseId: chunk.knowledgeBaseId,
          score: r.score,
        };
      })
      .filter((r): r is SearchResult => r !== null);
  }

  /**
   * Reciprocal Rank Fusion (RRF)
   * 公式：score(d) = Σ 1 / (k + rank(d))
   */
  private reciprocalRankFusion(
    lexicalResults: Array<{ chunkId: string; score: number }>,
    vectorResults: Array<{ chunkId: string; score: number }>,
  ): Array<{ chunkId: string; score: number }> {
    const k = 60; // RRF 常数
    const fusedScores = new Map<string, number>();

    // Lexical 排名贡献
    lexicalResults.forEach((r, index) => {
      const rank = index + 1;
      const score = 1 / (k + rank);
      fusedScores.set(r.chunkId, (fusedScores.get(r.chunkId) || 0) + score);
    });

    // Vector 排名贡献
    vectorResults.forEach((r, index) => {
      const rank = index + 1;
      const score = 1 / (k + rank);
      fusedScores.set(r.chunkId, (fusedScores.get(r.chunkId) || 0) + score);
    });

    // 排序
    const sorted = Array.from(fusedScores.entries())
      .map(([chunkId, score]) => ({ chunkId, score }))
      .sort((a, b) => b.score - a.score);

    return sorted;
  }

  /**
   * 直接按知识库 ID 搜索（不检查授权，用于测试）
   */
  async searchByKnowledgeBase(
    query: string,
    knowledgeBaseIds: string[],
    topK: number = 5,
    scoreThreshold: number = 0.7,
    strategy: SearchStrategy = 'auto',
  ): Promise<SearchResult[]> {
    // 获取企业 ID（用于缓存键）
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: { in: knowledgeBaseIds } },
      select: { enterpriseId: true },
    });

    if (!kb) {
      return [];
    }

    // 策略解析
    const actualStrategy = await this.resolveStrategy(strategy);

    // 执行检索
    switch (actualStrategy) {
      case 'lexical':
        return this.searchLexical(query, kb.enterpriseId, knowledgeBaseIds, topK);
      case 'vector':
        return this.searchVector(query, kb.enterpriseId, knowledgeBaseIds, topK, scoreThreshold);
      case 'hybrid':
        return this.searchHybrid(query, kb.enterpriseId, knowledgeBaseIds, topK, scoreThreshold);
    }
  }
}
