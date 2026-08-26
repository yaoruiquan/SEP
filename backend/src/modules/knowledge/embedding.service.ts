import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Embedding 服务 - Phase 2 重构
 * 独立于 sub2api，支持 TEI 容器部署
 */

export interface EmbeddingResponse {
  embedding: Float32Array;
  model: string;
}

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);

  private provider: string;
  private baseUrl: string;
  private model: string;
  private dimension: number;
  private batchSize: number;
  private timeoutMs: number;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.provider = this.config.get('EMBEDDING_PROVIDER') ?? 'openai';
    this.baseUrl = (this.config
      .get('EMBEDDING_BASE_URL') ?? 'http://127.0.0.1:11434/v1')
      .replace(/\/+$/, '');
    this.model = this.config.get('EMBEDDING_MODEL') ?? 'bge-m3:latest';
    this.dimension = parseInt(this.config.get('EMBEDDING_DIMENSION') ?? '1024', 10);
    this.batchSize = parseInt(this.config.get('EMBEDDING_BATCH_SIZE') ?? '32', 10);
    this.timeoutMs = parseInt(this.config.get('EMBEDDING_TIMEOUT_MS') ?? '30000', 10);

    if (!['tei', 'openai', 'wasm'].includes(this.provider)) {
      throw new Error(`Unsupported embedding provider: ${this.provider}`);
    }
    if (!Number.isInteger(this.dimension) || this.dimension <= 0) {
      throw new Error(`Invalid EMBEDDING_DIMENSION: ${this.dimension}`);
    }
    if (!Number.isInteger(this.batchSize) || this.batchSize <= 0) {
      throw new Error(`Invalid EMBEDDING_BATCH_SIZE: ${this.batchSize}`);
    }
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error(`Invalid EMBEDDING_TIMEOUT_MS: ${this.timeoutMs}`);
    }

    this.logger.log(
      `EmbeddingService initialized: provider=${this.provider}, model=${this.model}, dimension=${this.dimension}`
    );
  }

  /**
   * 单条文本 embedding
   */
  async embed(text: string): Promise<EmbeddingResponse> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  /**
   * 批量 embedding
   */
  async embedBatch(texts: string[]): Promise<EmbeddingResponse[]> {
    if (texts.length === 0) {
      return [];
    }

    const results: EmbeddingResponse[] = [];
    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      const batch = texts.slice(offset, offset + this.batchSize);
      try {
        results.push(...(await this.embedProviderBatch(batch)));
      } catch (error) {
        this.logger.error(`Embedding failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }
    return results;
  }

  private async embedProviderBatch(texts: string[]): Promise<EmbeddingResponse[]> {
    switch (this.provider) {
      case 'tei':
        return this.embedWithTEI(texts);
      case 'openai':
        return this.embedWithOpenAI(texts);
      case 'wasm':
        return this.embedWithWASM(texts);
      default:
        throw new Error(`Unsupported embedding provider: ${this.provider}`);
    }
  }

  /**
   * TEI 容器 embedding（主要方案）
   */
  private async embedWithTEI(texts: string[]): Promise<EmbeddingResponse[]> {
    const response = await fetch(`${this.baseUrl}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({ inputs: texts }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`TEI embedding failed: ${response.statusText} - ${error}`);
    }

    const data = await response.json();

    // TEI 返回格式：[[0.1, 0.2, ...], [...]]
    return this.validateEmbeddings(data.map((embedding: number[]) => ({
      embedding: new Float32Array(embedding),
      model: this.model,
    })));
  }

  /**
   * OpenAI API embedding（备用方案）
   */
  private async embedWithOpenAI(texts: string[]): Promise<EmbeddingResponse[]> {
    const apiKey = this.config.get('EMBEDDING_API_KEY')
      || this.config.get('OPENAI_API_KEY')
      || this.config.get('SUB2API_API_KEY');
    if (!apiKey) {
      throw new Error('EMBEDDING_API_KEY not configured for OpenAI provider');
    }

    const endpoint = this.baseUrl.endsWith('/v1')
      ? `${this.baseUrl}/embeddings`
      : `${this.baseUrl}/v1/embeddings`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding failed: ${response.statusText} - ${error}`);
    }

    const data = await response.json();

    // OpenAI 返回格式：{data: [{embedding: [...]}]}
    return this.validateEmbeddings(data.data.map((item: any) => ({
      embedding: new Float32Array(item.embedding),
      model: this.model,
    })));
  }

  /**
   * WASM embedding（降级方案，使用 @xenova/transformers）
   */
  private async embedWithWASM(texts: string[]): Promise<EmbeddingResponse[]> {
    // 动态导入以避免初始化开销
    const { pipeline } = await import('@xenova/transformers');

    const extractor = await pipeline('feature-extraction', this.model);
    const results = await extractor(texts, { pooling: 'mean', normalize: true });

    return this.validateEmbeddings(texts.map((_, i) => ({
      embedding: new Float32Array(results[i].data),
      model: this.model,
    })));
  }

  /**
   * 获取当前 embedding 维度
   */
  getDimension(): number {
    return this.dimension;
  }

  /**
   * 获取当前模型标识
   */
  getModel(): string {
    return this.model;
  }

  getBatchSize(): number {
    return this.batchSize;
  }

  /**
   * 检查服务是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      if (this.provider === 'tei') {
        const response = await fetch(`${this.baseUrl}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(2000),
        });
        return response.ok;
      }
      if (this.provider === 'openai') {
        const apiKey = this.config.get('EMBEDDING_API_KEY')
          || this.config.get('OPENAI_API_KEY')
          || this.config.get('SUB2API_API_KEY');
        if (!apiKey) return false;

        const endpoint = this.baseUrl.endsWith('/v1')
          ? `${this.baseUrl}/embeddings`
          : `${this.baseUrl}/v1/embeddings`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model: this.model, input: ['健康检查'] }),
          signal: AbortSignal.timeout(Math.min(this.timeoutMs, 5000)),
        });
        if (!response.ok) return false;
        const data = await response.json() as { data?: Array<{ embedding?: number[] }> };
        const vector = data.data?.[0]?.embedding;
        return Array.isArray(vector) && vector.length === this.dimension;
      }
      return this.provider === 'wasm';
    } catch {
      return false;
    }
  }

  private validateEmbeddings(results: EmbeddingResponse[]): EmbeddingResponse[] {
    for (const result of results) {
      if (result.embedding.length !== this.dimension) {
        throw new Error(
          `Embedding dimension mismatch for ${this.model}: expected ${this.dimension}, got ${result.embedding.length}`,
        );
      }
    }
    return results;
  }
}
