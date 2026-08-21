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

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.provider = this.config.get('EMBEDDING_PROVIDER', 'tei');
    this.baseUrl = this.config
      .get('EMBEDDING_BASE_URL', 'http://localhost:8080')
      .replace(/\/+$/, '');
    this.model = this.config.get('EMBEDDING_MODEL', 'BAAI/bge-small-zh-v1.5');
    this.dimension = parseInt(this.config.get('EMBEDDING_DIMENSION', '512'), 10);

    if (!['tei', 'openai', 'wasm'].includes(this.provider)) {
      throw new Error(`Unsupported embedding provider: ${this.provider}`);
    }
    if (!Number.isInteger(this.dimension) || this.dimension <= 0) {
      throw new Error(`Invalid EMBEDDING_DIMENSION: ${this.dimension}`);
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

    try {
      switch (this.provider) {
        case 'tei':
          return await this.embedWithTEI(texts);
        case 'openai':
          return await this.embedWithOpenAI(texts);
        case 'wasm':
          return await this.embedWithWASM(texts);
        default:
          throw new Error(`Unsupported embedding provider: ${this.provider}`);
      }
    } catch (error) {
      this.logger.error(`Embedding failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * TEI 容器 embedding（主要方案）
   */
  private async embedWithTEI(texts: string[]): Promise<EmbeddingResponse[]> {
    const response = await fetch(`${this.baseUrl}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
        return Boolean(
          this.config.get('EMBEDDING_API_KEY')
          || this.config.get('OPENAI_API_KEY')
          || this.config.get('SUB2API_API_KEY'),
        );
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
