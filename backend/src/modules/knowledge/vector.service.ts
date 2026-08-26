import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
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
  private readonly maxLegacyFallbackCandidates = 10_000;
  private pgvectorMode: 'unknown' | 'native' | 'compatibility-fallback' | 'legacy' = 'unknown';
  private pgvectorSearchCount = 0;
  private pgvectorFallbackCount = 0;
  private pgvectorFailureCount = 0;
  private lastPgvectorError: string | null = null;

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
    embeddingModel?: string,
  ): Promise<SearchResult[]> {
    const startTime = Date.now();

    // The database-native path is the default after the pgvector migration.
    // Keeping the legacy path makes rolling upgrades and old test databases safe.
    if (typeof (this.prisma as any).$queryRaw === 'function') {
      try {
        const results = await this.searchWithPgVector(
          queryVector,
          enterpriseId,
          knowledgeBaseIds,
          topK,
          embeddingModel,
        );
        this.logger.log(
          `pgvector search completed in ${Date.now() - startTime}ms (${results.length} results)`,
        );
        this.pgvectorMode = 'native';
        this.pgvectorSearchCount += 1;
        return results;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastPgvectorError = message;
        this.pgvectorFailureCount += 1;
        if (!this.isCompatibilityError(error)) {
          this.logger.error(`pgvector search failed; refusing BYTEA fallback: ${message}`);
          throw error;
        }
        this.pgvectorMode = 'compatibility-fallback';
        this.pgvectorFallbackCount += 1;
        this.logger.warn(
          `pgvector schema is not ready, falling back to bounded BYTEA scan: ${message}`,
        );
      }
    } else {
      this.pgvectorMode = 'legacy';
    }

    // 1. 尝试从缓存读取
    const cacheKey = this.buildCacheKey(enterpriseId, knowledgeBaseIds, embeddingModel);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache HIT for scope ${cacheKey}`);
      this.updateCacheOrder(cacheKey);
      return this.searchInMemory(queryVector, cached, knowledgeBaseIds, topK);
    }

    // 2. 缓存未命中，从 Postgres 加载
    this.logger.debug(`Cache MISS for enterprise ${enterpriseId}, loading from DB`);
    const vectors = await this.loadVectorsFromDB(enterpriseId, knowledgeBaseIds, embeddingModel);

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
   * HNSW-backed cosine search. The vector literal is generated locally from
   * the already validated Float32Array and passed as a SQL parameter.
   */
  private async searchWithPgVector(
    queryVector: Float32Array,
    enterpriseId: string,
    knowledgeBaseIds: string[],
    topK: number,
    embeddingModel?: string,
  ): Promise<SearchResult[]> {
    if (queryVector.length !== 1024) {
      throw new Error(`pgvector expects 1024 dimensions, got ${queryVector.length}`);
    }
    const literal = this.toVectorLiteral(queryVector);
    if (embeddingModel) {
      const filteredRows = await (this.prisma as any).$queryRaw<Array<{ id: string; knowledgeBaseId: string; score: number }>>`
        SELECT
          tc.id,
          tc."knowledgeBaseId",
          1 - (tc."embeddingVector" <=> ${literal}::vector) AS score
        FROM text_chunks tc
        INNER JOIN knowledge_bases kb ON tc."knowledgeBaseId" = kb.id
        WHERE kb."enterpriseId" = ${enterpriseId}
          AND kb.id = ANY(${knowledgeBaseIds}::text[])
          AND tc."embeddingVector" IS NOT NULL
          AND tc."embeddingModel" = ${embeddingModel}
        ORDER BY tc."embeddingVector" <=> ${literal}::vector
        LIMIT ${topK}
      `;
      return filteredRows.map((row) => ({
        chunkId: row.id,
        knowledgeBaseId: row.knowledgeBaseId,
        score: Number(row.score),
      } as SearchResult));
    }

    const rows = await (this.prisma as any).$queryRaw<Array<{ id: string; knowledgeBaseId: string; score: number }>>`
      SELECT
        tc.id,
        tc."knowledgeBaseId",
        1 - (tc."embeddingVector" <=> ${literal}::vector) AS score
      FROM text_chunks tc
      INNER JOIN knowledge_bases kb ON tc."knowledgeBaseId" = kb.id
      WHERE kb."enterpriseId" = ${enterpriseId}
        AND kb.id = ANY(${knowledgeBaseIds}::text[])
        AND tc."embeddingVector" IS NOT NULL
      ORDER BY tc."embeddingVector" <=> ${literal}::vector
      LIMIT ${topK}
    `;

    return rows.map((row) => ({
      chunkId: row.id,
      knowledgeBaseId: row.knowledgeBaseId,
      score: Number(row.score),
    } as SearchResult));
  }

  /** Store a vector in the native pgvector column after the Prisma row exists. */
  async upsertVector(chunkId: string, vector: Float32Array): Promise<void> {
    if (vector.length !== 1024 || typeof (this.prisma as any).$executeRaw !== 'function') {
      if (vector.length !== 1024) {
        throw new Error(`pgvector expects 1024 dimensions, got ${vector.length}`);
      }
      return;
    }
    const literal = this.toVectorLiteral(vector);
    try {
      await (this.prisma as any).$executeRaw`
        UPDATE text_chunks SET "embeddingVector" = ${literal}::vector WHERE id = ${chunkId}
      `;
    } catch (error) {
      if (!this.isCompatibilityError(error)) throw error;
      this.logger.warn(`pgvector column unavailable for chunk ${chunkId}; keeping BYTEA compatibility storage`);
    }
  }

  async clearVector(chunkId: string): Promise<void> {
    if (typeof (this.prisma as any).$executeRaw !== 'function') return;
    try {
      await (this.prisma as any).$executeRaw`
        UPDATE text_chunks SET "embeddingVector" = NULL WHERE id = ${chunkId}
      `;
    } catch (error) {
      if (!this.isCompatibilityError(error)) throw error;
      this.logger.warn(`pgvector column unavailable while clearing chunk ${chunkId}`);
    }
  }

  private toVectorLiteral(vector: Float32Array): string {
    return `[${Array.from(vector, (value) => {
      if (!Number.isFinite(value)) throw new Error('Embedding contains a non-finite value');
      return String(value);
    }).join(',')}]`;
  }

  /**
   * 从 Postgres 加载向量
   */
  private async loadVectorsFromDB(
    enterpriseId: string,
    knowledgeBaseIds: string[],
    embeddingModel?: string,
  ): Promise<Map<string, CachedVector>> {
    const chunks = await this.prisma.textChunk.findMany({
      where: {
        knowledgeBase: {
          enterpriseId,
          id: { in: knowledgeBaseIds },
        },
        embedding: { not: null },
        ...(embeddingModel ? { embeddingModel } : {}),
      },
      select: {
        id: true,
        embedding: true,
        knowledgeBaseId: true,
      },
      take: this.maxLegacyFallbackCandidates + 1,
    });

    if (chunks.length > this.maxLegacyFallbackCandidates) {
      throw new ServiceUnavailableException(
        `pgvector 未完成迁移，旧版 BYTEA 回退候选超过 ${this.maxLegacyFallbackCandidates} 个；请先执行 prisma migrate deploy 后再检索`,
      );
    }

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
      pgvector: {
        mode: this.pgvectorMode,
        searchCount: this.pgvectorSearchCount,
        fallbackCount: this.pgvectorFallbackCount,
        failureCount: this.pgvectorFailureCount,
        maxLegacyFallbackCandidates: this.maxLegacyFallbackCandidates,
        lastError: this.lastPgvectorError,
      },
      entries,
    };
  }

  private buildCacheKey(enterpriseId: string, knowledgeBaseIds: string[], embeddingModel?: string): string {
    return `${enterpriseId}:${embeddingModel ?? '*'}:${[...new Set(knowledgeBaseIds)].sort().join(',')}`;
  }

  private isCompatibilityError(error: unknown): boolean {
    const candidate = error as { code?: string; meta?: { code?: string } };
    const codes = [candidate?.code, candidate?.meta?.code];
    if (codes.some((code) => code === 'P2021' || code === '42703' || code === '42704')) {
      return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    return /embeddingVector.*(does not exist|不存在)|type [\"']?vector[\"']?.*does not exist/i.test(message);
  }
}
