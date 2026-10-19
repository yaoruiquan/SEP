import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { isVectorCompatibleChunk, publicationSelect, publishedChunkSql, vectorChunkWhere, vectorProfileSql } from './knowledge-publication';
import type { EmbeddingProfile } from './embedding.service';

/**
 * Vector 存储服务 - Phase 2 重构
 * pgvector + bounded BYTEA compatibility search, without cross-request publication caches.
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

  constructor(private prisma: PrismaService) {}

  /**
   * 向量检索（热路径）
   */
  async search(
    queryVector: Float32Array,
    enterpriseId: string,
    knowledgeBaseIds: string[],
    topK: number,
    profile?: EmbeddingProfile,
  ): Promise<SearchResult[]> {
    const startTime = Date.now();
    if (profile && (profile.dimension !== queryVector.length || profile.distance !== 'cosine'
      || !profile.model || !profile.tokenizer)) {
      throw new ServiceUnavailableException('Embedding query profile is incompatible with the query vector');
    }

    // The database-native path is the default after the pgvector migration.
    // Keeping the legacy path makes rolling upgrades and old test databases safe.
    if (typeof (this.prisma as any).$queryRaw === 'function') {
      try {
        const results = await this.searchWithPgVector(
          queryVector,
          enterpriseId,
          knowledgeBaseIds,
          topK,
          profile,
        );
        this.logger.log(
          `pgvector search completed in ${Date.now() - startTime}ms (${results.length} results)`,
        );
        this.pgvectorMode = 'native';
        this.pgvectorSearchCount += 1;
        return results;
      } catch (error) {
        this.lastPgvectorError = this.isCompatibilityError(error) ? 'PGVECTOR_SCHEMA_UNAVAILABLE' : 'PGVECTOR_SEARCH_UNAVAILABLE';
        this.pgvectorFailureCount += 1;
        if (!this.isCompatibilityError(error)) {
          this.logger.error('pgvector search failed; refusing BYTEA fallback');
          throw error;
        }
        this.pgvectorMode = 'compatibility-fallback';
        this.pgvectorFallbackCount += 1;
        this.logger.warn(
          'pgvector schema is not ready, falling back to bounded BYTEA scan',
        );
      }
    } else {
      this.pgvectorMode = 'legacy';
    }

    // Publication can change in another process. Never reuse a local publication snapshot.
    const vectors = await this.loadVectorsFromDB(enterpriseId, knowledgeBaseIds, queryVector.length, profile);
    const results = this.searchInMemory(queryVector, vectors, knowledgeBaseIds, topK);

    this.logger.log(
      `Vector search completed in ${Date.now() - startTime}ms (${results.length} results)`
    );

    return this.recheckResults(results, enterpriseId, knowledgeBaseIds, profile);
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
    profile?: EmbeddingProfile,
  ): Promise<SearchResult[]> {
    if (queryVector.length !== 1024) {
      throw new Error(`pgvector expects 1024 dimensions, got ${queryVector.length}`);
    }
    const literal = this.toVectorLiteral(queryVector);
    const rows = await (this.prisma as any).$queryRaw<Array<{ id: string; knowledgeBaseId: string; score: number }>>`
      SELECT
        tc.id,
        tc."knowledgeBaseId",
        1 - (tc."embeddingVector" <=> ${literal}::vector) AS score
      FROM text_chunks tc
      INNER JOIN knowledge_bases kb ON tc."knowledgeBaseId" = kb.id
      INNER JOIN documents d ON tc."documentId" = d.id
      LEFT JOIN document_versions dv ON tc."versionId" = dv.id
      WHERE kb."enterpriseId" = ${enterpriseId}
        AND kb.id = ANY(${knowledgeBaseIds}::text[])
        AND ${publishedChunkSql}
        AND ${vectorProfileSql(profile)}
        AND tc."embeddingVector" IS NOT NULL
      ORDER BY tc."embeddingVector" <=> ${literal}::vector
      LIMIT ${topK}
    `;

    return this.recheckResults(rows.map((row) => ({
      chunkId: row.id,
      knowledgeBaseId: row.knowledgeBaseId,
      score: Number(row.score),
    } as SearchResult)), enterpriseId, knowledgeBaseIds, profile);
  }

  private async recheckResults(results: SearchResult[], enterpriseId: string, knowledgeBaseIds: string[], profile?: EmbeddingProfile) {
    if (!results.length) return [];
    const chunks = await this.prisma.textChunk.findMany({
      where: { ...vectorChunkWhere({ enterpriseId, id: { in: knowledgeBaseIds } }, profile),
        id: { in: results.map(result => result.chunkId) } },
      select: { id: true, knowledgeBaseId: true, ...publicationSelect },
    });
    const allowed = new Set(chunks.filter(chunk => isVectorCompatibleChunk(chunk, profile)).map(chunk => chunk.id));
    return results.filter(result => allowed.has(result.chunkId));
  }

  /** Store a vector in the native pgvector column after the Prisma row exists. */
  async upsertVector(chunkId: string, vector: Float32Array, executor: Pick<Prisma.TransactionClient, '$executeRaw'> = this.prisma): Promise<void> {
    if (vector.length !== 1024 || typeof executor.$executeRaw !== 'function') {
      if (vector.length !== 1024) {
        throw new Error(`pgvector expects 1024 dimensions, got ${vector.length}`);
      }
      return;
    }
    const literal = this.toVectorLiteral(vector);
    try {
      await executor.$executeRaw`
        UPDATE text_chunks SET "embeddingVector" = ${literal}::vector WHERE id = ${chunkId}
      `;
    } catch (error) {
      // A failed statement aborts a PostgreSQL transaction; the caller must roll it back.
      if (executor !== this.prisma) throw error;
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
    dimension: number,
    profile?: EmbeddingProfile,
  ): Promise<Map<string, CachedVector>> {
    const chunks = await this.prisma.textChunk.findMany({
      where: {
        ...vectorChunkWhere({ enterpriseId, id: { in: knowledgeBaseIds } }, profile),
        embedding: { not: null },
      },
      select: {
        id: true,
        embedding: true,
        knowledgeBaseId: true,
        ...publicationSelect,
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
      if (chunk.embedding && isVectorCompatibleChunk(chunk, profile)) {
        // Buffer → Float32Array
        const vector = new Float32Array(
          new Uint8Array(chunk.embedding).buffer
        );
        if (vector.length === dimension) vectorMap.set(chunk.id, { knowledgeBaseId: chunk.knowledgeBaseId, vector });
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

  /** Retained for callers; publication-sensitive caches are disabled. */
  invalidateCache(enterpriseId: string, knowledgeBaseId?: string): void {
    if (knowledgeBaseId) {
      this.logger.log(`Invalidating cache for KB ${knowledgeBaseId}`);
    } else {
      this.logger.log(`Invalidating cache for enterprise ${enterpriseId}`);
    }
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return {
      cacheEnabled: false,
      cachedEnterprises: 0,
      maxSize: 0,
      pgvector: {
        mode: this.pgvectorMode,
        searchCount: this.pgvectorSearchCount,
        fallbackCount: this.pgvectorFallbackCount,
        failureCount: this.pgvectorFailureCount,
        maxLegacyFallbackCandidates: this.maxLegacyFallbackCandidates,
        lastError: this.lastPgvectorError,
      },
      entries: [],
    };
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
