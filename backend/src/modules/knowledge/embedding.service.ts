import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private openai: OpenAI;
  private model: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get('OPENAI_API_KEY');

    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not configured, embedding disabled');
      return;
    }

    this.openai = new OpenAI({
      apiKey,
      baseURL: this.configService.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1',
    });

    // 使用 text-embedding-3-small 模型（性价比高）
    this.model = this.configService.get('OPENAI_EMBEDDING_MODEL') || 'text-embedding-3-small';

    this.logger.log(`EmbeddingService initialized with model: ${this.model}`);
  }

  /**
   * 检查服务是否可用
   */
  isAvailable(): boolean {
    return !!this.openai;
  }

  /**
   * 将单个文本转换为向量
   * @param text 输入文本
   * @param modelOverride 可选：覆盖默认模型（如企业配置的 embeddingModel）
   */
  async embedText(text: string, modelOverride?: string): Promise<number[]> {
    if (!this.isAvailable()) {
      throw new Error('Embedding service not available');
    }

    const model = modelOverride || this.model;

    try {
      const response = await this.openai.embeddings.create({
        model,
        input: text,
      });

      return response.data[0].embedding;
    } catch (error) {
      this.logger.error(`Failed to embed text: ${error.message}`);
      throw error;
    }
  }

  /**
   * 批量将文本转换为向量
   * @param texts 文本数组
   * @param modelOverride 可选：覆盖默认模型（如企业配置的 embeddingModel）
   * @param batchSizeOverride 可选：覆盖默认批次大小（如企业配置的 embeddingBatchSize）
   * @returns 向量数组
   */
  async embedBatch(
    texts: string[],
    modelOverride?: string,
    batchSizeOverride?: number,
  ): Promise<number[][]> {
    if (!this.isAvailable()) {
      throw new Error('Embedding service not available');
    }

    if (texts.length === 0) {
      return [];
    }

    const model = modelOverride || this.model;
    // OpenAI API 支持批量处理，但有限制（最多 2048 个输入）
    const batchSize = batchSizeOverride ?? 100;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      try {
        const response = await this.openai.embeddings.create({
          model,
          input: batch,
        });

        const embeddings = response.data.map((item) => item.embedding);
        results.push(...embeddings);

        this.logger.log(`Embedded batch ${i / batchSize + 1}: ${batch.length} texts`);
      } catch (error) {
        this.logger.error(`Failed to embed batch starting at ${i}: ${error.message}`);
        throw error;
      }

      // 添加小延迟避免触发速率限制
      if (i + batchSize < texts.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * 获取向量维度（text-embedding-3-small 是 1536 维）
   */
  getVectorDimension(): number {
    if (this.model === 'text-embedding-3-small') {
      return 1536;
    } else if (this.model === 'text-embedding-3-large') {
      return 3072;
    } else if (this.model === 'text-embedding-ada-002') {
      return 1536;
    }
    return 1536; // 默认
  }
}
