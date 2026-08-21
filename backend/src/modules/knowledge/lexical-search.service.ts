import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TextTokenizer } from './text-tokenizer.service';
import { BM25Scorer } from './bm25-scorer.service';

/**
 * 词法检索服务 - Phase 2
 * pg_trgm 候选召回 + BM25 打分
 */

interface LexicalSearchResult {
  chunkId: string;
  score: number;
  content: string;
  source: string;
  knowledgeBaseId: string;
}

@Injectable()
export class LexicalSearchService {
  private readonly logger = new Logger(LexicalSearchService.name);

  constructor(
    private prisma: PrismaService,
    private tokenizer: TextTokenizer,
    private bm25Scorer: BM25Scorer,
  ) {}

  /**
   * 词法检索（两阶段：召回 → 排序）
   */
  async search(
    query: string,
    enterpriseId: string,
    knowledgeBaseIds: string[],
    topK: number,
  ): Promise<LexicalSearchResult[]> {
    const startTime = Date.now();

    // 1. 分词
    const queryTokens = this.tokenizer.tokenize(query);
    if (queryTokens.length === 0) {
      return [];
    }

    this.logger.debug(`Query tokens: ${queryTokens.join(', ')}`);

    // 2. 候选召回（pg_trgm）
    const candidates = await this.recallCandidates(
      query,
      enterpriseId,
      knowledgeBaseIds,
      topK * 5, // 召回 5 倍候选
    );

    if (candidates.length === 0) {
      this.logger.warn('No candidates found');
      return [];
    }

    // 3. BM25 打分
    const corpus = candidates.map((c) => ({
      id: c.id,
      tokens: c.tokens || [],
    }));

    this.bm25Scorer.buildIndex(corpus);
    const scored = this.bm25Scorer.topK(queryTokens, topK);

    // 4. 组装结果
    const results: LexicalSearchResult[] = scored
      .map((s) => {
        const chunk = candidates.find((c) => c.id === s.id);
        if (!chunk) return null;
        return {
          chunkId: chunk.id,
          score: s.score,
          content: chunk.content,
          source: chunk.source,
          knowledgeBaseId: chunk.knowledgeBaseId,
        };
      })
      .filter((r): r is LexicalSearchResult => r !== null);

    this.logger.log(
      `Lexical search completed in ${Date.now() - startTime}ms (${results.length} results from ${candidates.length} candidates)`
    );

    return results;
  }

  /**
   * 候选召回：使用 pg_trgm 的相似度匹配
   */
  private async recallCandidates(
    query: string,
    enterpriseId: string,
    knowledgeBaseIds: string[],
    limit: number,
  ) {
    // 使用 pg_trgm 的相似度函数
    const chunks = await this.prisma.$queryRaw<
      Array<{
        id: string;
        content: string;
        tokens: string[];
        source: string;
        knowledgeBaseId: string;
        similarity: number;
      }>
    >`
      SELECT
        tc.id,
        tc.content,
        tc.tokens,
        tc.source,
        tc."knowledgeBaseId",
        similarity(tc.content, ${query}) as similarity
      FROM text_chunks tc
      INNER JOIN knowledge_bases kb ON tc."knowledgeBaseId" = kb.id
      WHERE kb."enterpriseId" = ${enterpriseId}
        AND kb.id = ANY(${knowledgeBaseIds}::text[])
        AND tc.tokens IS NOT NULL
        AND similarity(tc.content, ${query}) > 0.01
      ORDER BY similarity DESC
      LIMIT ${limit}
    `;

    return chunks;
  }
}
