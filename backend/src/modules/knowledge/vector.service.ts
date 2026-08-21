import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Vector 存储服务 - Phase 2 重构
 * LRU 缓存（内存）+ Postgres bytea（持久化）
 */

interface SearchResult {
  chunkId: string;
  score: number;
}

interface CachedVector {
  knowledgeBaseId: string;
  vector: Float32Array;
}

@Injectable()
export class VectorService {
  private readonly logger = new Logger(VectorService.name);

  // LRU 缓存：enterpriseId + 授权知识库集合 -> Map<chunkId, vector>
  private cache = new Map<string, Map<string, CachedVector>>();
  private cacheOrder = new Map<string, number>();
  private readonly maxCacheSize = 5; // 最多缓存 5 个企业
  private readonly maxMemoryMB = 600; // 最大内存占用 600MB

  constructor(private prisma: PrismaService) {}

  /**
   * 向量检索（热路径）
   */
  async search(
    queryVector: Float32Array,
    enterpriseId: string,
    knowledgeBaseIds: string[],
    topK: number,
  ): Promise<SearchResult[]> {
    const startTime = Date.now();

    // 1. 尝试从缓存读取
    const cacheKey = this.buildCacheKey(enterpriseId, knowledgeBaseIds);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache HIT for scope ${cacheKey}`);
      this.updateCacheOrder(cacheKey);
      return this.searchInMemory(queryVector, cached, knowledgeBaseIds, topK);
    }

    // 2. 缓存未命中，从 Postgres 加载
    this.logger.debug(`Cache MISS for enterprise ${enterpriseId}, loading from DB`);
    const vectors = await this.loadVectorsFromDB(enterpriseId, knowledgeBaseIds);

    // 3. 写入缓存
    this.addToCache(cacheKey, vectors);

    // 4. 执行检索
    const results = this.searchInMemory(queryVector, vectors, knowledgeBaseIds, topK);

    this.logger.log(
      `Vector search completed in ${Date.now() - startTime}ms (${results.length} results)`
    );

    return results;
  }

  /**
   * 从 Postgres 加载向量
   */
  private async loadVectorsFromDB(
    enterpriseId: string,
    knowledgeBaseIds: string[],
  ): Promise<Map<string, CachedVector>> {
    const chunks = await this.prisma.textChunk.findMany({
      where: {
        knowledgeBase: {
          enterpriseId,
          id: { in: knowledgeBaseIds },
        },
        embedding: { not: null },
      },
      select: {
        id: true,
        embedding: true,
        knowledgeBaseId: true,
      },
    });

    const vectorMap = new Map<string, CachedVector>();

    for (const chunk of chunks) {
      if (chunk.embedding) {
        // Buffer → Float32Array
        const vector = new Float32Array(
          new Uint8Array(chunk.embedding).buffer
        );
        vectorMap.set(chunk.id, { knowledgeBaseId: chunk.knowledgeBaseId, vector });
      }
    }

    this.logger.log(
      `Loaded ${vectorMap.size} vectors from DB for enterprise ${enterpriseId}`
    );

    return vectorMap;
  }

  /**
   * 内存中向量检索（brute-force cosine similarity）
   */
  private searchInMemory(
    queryVector: Float32Array,
    vectors: Map<string, CachedVector>,
    knowledgeBaseIds: string[],
    topK: number,
  ): SearchResult[] {
    const results: SearchResult[] = [];

    const allowedKnowledgeBases = new Set(knowledgeBaseIds);
    for (const [chunkId, cached] of vectors.entries()) {
      if (!allowedKnowledgeBases.has(cached.knowledgeBaseId)) continue;
      const score = this.cosineSimilarity(queryVector, cached.vector);
      results.push({ chunkId, score });
    }

    // 按分数降序排序
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK);
  }

  /**
   * 余弦相似度计算
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Vector dimension mismatch');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * 添加到 LRU 缓存
   */
  private addToCache(cacheKey: string, vectors: Map<string, CachedVector>): void {
    // 检查内存占用
    const vectorSizeMB = Array.from(vectors.values()).reduce(
      (bytes, item) => bytes + item.vector.byteLength,
      0,
    ) / (1024 * 1024);

    if (vectorSizeMB > this.maxMemoryMB) {
      this.logger.warn(
        `Vector scope ${cacheKey} too large (${vectorSizeMB.toFixed(2)}MB), skipping cache`
      );
      return;
    }

    // LRU 驱逐
    if (this.cache.size >= this.maxCacheSize) {
      const oldestKey = this.getOldestCacheKey();
      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.cacheOrder.delete(oldestKey);
        this.logger.debug(`Evicted enterprise ${oldestKey} from cache`);
      }
    }

    this.cache.set(cacheKey, vectors);
    this.cacheOrder.set(cacheKey, Date.now());
  }

  /**
   * 更新缓存访问时间
   */
  private updateCacheOrder(cacheKey: string): void {
    this.cacheOrder.set(cacheKey, Date.now());
  }

  /**
   * 获取最久未使用的缓存键
   */
  private getOldestCacheKey(): string | undefined {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, time] of this.cacheOrder.entries()) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   * 使缓存失效（文档更新后调用）
   */
  invalidateCache(enterpriseId: string, knowledgeBaseId?: string): void {
    if (knowledgeBaseId) {
      this.logger.log(`Invalidating cache for KB ${knowledgeBaseId}`);
    } else {
      this.logger.log(`Invalidating cache for enterprise ${enterpriseId}`);
    }

    for (const key of this.cache.keys()) {
      if (key.startsWith(`${enterpriseId}:`)) {
        this.cache.delete(key);
        this.cacheOrder.delete(key);
      }
    }
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    const entries = Array.from(this.cache.entries()).map(([scope, vectors]) => ({
      scope,
      vectorCount: vectors.size,
      sizeMB: (Array.from(vectors.values()).reduce(
        (bytes, item) => bytes + item.vector.byteLength,
        0,
      ) / (1024 * 1024)).toFixed(2),
    }));

    return {
      cachedEnterprises: this.cache.size,
      maxSize: this.maxCacheSize,
      entries,
    };
  }

  private buildCacheKey(enterpriseId: string, knowledgeBaseIds: string[]): string {
    return `${enterpriseId}:${[...new Set(knowledgeBaseIds)].sort().join(',')}`;
  }
}
