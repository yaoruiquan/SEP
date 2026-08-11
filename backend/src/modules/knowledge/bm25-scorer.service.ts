import { Injectable } from '@nestjs/common';

/**
 * BM25 评分算法
 * 用于词法检索的相关性排序
 */

interface Document {
  id: string;
  tokens: string[];
}

interface BM25Result {
  id: string;
  score: number;
}

@Injectable()
export class BM25Scorer {
  private k1 = 1.2; // term frequency saturation parameter
  private b = 0.75; // length normalization parameter

  private corpus: Document[] = [];
  private avgDocLength = 0;
  private docFreq: Map<string, number> = new Map();
  private idf: Map<string, number> = new Map();

  /**
   * 构建语料库索引
   */
  buildIndex(corpus: Document[]): void {
    this.corpus = corpus;

    // 计算平均文档长度
    const totalTokens = corpus.reduce((sum, doc) => sum + doc.tokens.length, 0);
    this.avgDocLength = corpus.length > 0 ? totalTokens / corpus.length : 0;

    // 计算文档频率（DF）
    this.docFreq.clear();
    for (const doc of corpus) {
      const uniqueTokens = new Set(doc.tokens);
      for (const token of uniqueTokens) {
        this.docFreq.set(token, (this.docFreq.get(token) || 0) + 1);
      }
    }

    // 计算逆文档频率（IDF）
    this.idf.clear();
    const N = corpus.length;
    for (const [term, df] of this.docFreq.entries()) {
      // IDF = log((N - df + 0.5) / (df + 0.5) + 1)
      const idfValue = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      this.idf.set(term, idfValue);
    }
  }

  /**
   * 对所有文档打分
   */
  scoreAll(queryTokens: string[]): BM25Result[] {
    const results: BM25Result[] = [];

    for (const doc of this.corpus) {
      const score = this.score(queryTokens, doc.tokens);
      results.push({ id: doc.id, score });
    }

    // 按分数降序排序
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /**
   * 计算单个文档的 BM25 分数
   */
  private score(queryTokens: string[], docTokens: string[]): number {
    let totalScore = 0;

    // 计算文档中每个词的频率
    const termFreq = new Map<string, number>();
    for (const token of docTokens) {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    }

    const docLength = docTokens.length;
    const normFactor = 1 - this.b + this.b * (docLength / this.avgDocLength);

    for (const qToken of queryTokens) {
      const idf = this.idf.get(qToken) || 0;
      const tf = termFreq.get(qToken) || 0;

      // BM25 公式
      const numerator = tf * (this.k1 + 1);
      const denominator = tf + this.k1 * normFactor;
      const termScore = idf * (numerator / denominator);

      totalScore += termScore;
    }

    return totalScore;
  }

  /**
   * 获取前 K 个结果
   */
  topK(queryTokens: string[], k: number): BM25Result[] {
    const allResults = this.scoreAll(queryTokens);
    return allResults.slice(0, k);
  }
}
