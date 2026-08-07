import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pinecone } from '@pinecone-database/pinecone';

interface VectorMetadata {
  knowledgeBaseId: string;
  chunkId: string;
  content: string;
  source: string;
}

interface SearchResult {
  id: string;
  score: number;
  metadata: VectorMetadata;
}

@Injectable()
export class VectorService implements OnModuleInit {
  private readonly logger = new Logger(VectorService.name);
  private pinecone: Pinecone;
  private indexName: string;

  constructor(private configService: ConfigService) {
    this.indexName = this.configService.get('PINECONE_INDEX') || 'sep-knowledge';
  }

  async onModuleInit() {
    const apiKey = this.configService.get('PINECONE_API_KEY');

    if (!apiKey) {
      this.logger.warn('PINECONE_API_KEY not configured, vector search disabled');
      return;
    }

    try {
      this.pinecone = new Pinecone({
        apiKey,
      });

      this.logger.log('Pinecone initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Pinecone', error);
    }
  }

  /**
   * 检查向量数据库是否可用
   */
  isAvailable(): boolean {
    return !!this.pinecone;
  }

  /**
   * 插入或更新向量
   */
  async upsertVectors(vectors: Array<{
    id: string;
    values: number[];
    metadata: VectorMetadata;
  }>) {
    if (!this.isAvailable()) {
      throw new Error('Vector service not available');
    }

    const index = this.pinecone.index(this.indexName);

    await index.upsert({ records: vectors as any });

    this.logger.log(`Upserted ${vectors.length} vectors to ${this.indexName}`);
  }

  /**
   * 查询相似向量
   */
  async search(
    queryVector: number[],
    knowledgeBaseIds: string[],
    topK: number = 5,
    scoreThreshold: number = 0.7,
  ): Promise<SearchResult[]> {
    if (!this.isAvailable()) {
      this.logger.warn('Vector service not available, returning empty results');
      return [];
    }

    const index = this.pinecone.index(this.indexName);

    // 构建过滤条件：只搜索指定知识库的向量
    const filter = {
      knowledgeBaseId: { $in: knowledgeBaseIds },
    };

    const queryResponse = await index.query({
      vector: queryVector,
      topK,
      filter,
      includeMetadata: true,
    });

    // 过滤低分结果
    const results = queryResponse.matches
      .filter((match) => match.score >= scoreThreshold)
      .map((match) => ({
        id: match.id,
        score: match.score,
        metadata: match.metadata as unknown as VectorMetadata,
      }));

    this.logger.log(
      `Search completed: ${results.length}/${queryResponse.matches.length} results above threshold ${scoreThreshold}`,
    );

    return results;
  }

  /**
   * 删除向量（按 ID）
   */
  async deleteVectors(ids: string[]) {
    if (!this.isAvailable()) {
      throw new Error('Vector service not available');
    }

    const index = this.pinecone.index(this.indexName);

    await index.deleteMany(ids);

    this.logger.log(`Deleted ${ids.length} vectors from ${this.indexName}`);
  }

  /**
   * 删除知识库的所有向量
   */
  async deleteByKnowledgeBase(knowledgeBaseId: string) {
    if (!this.isAvailable()) {
      throw new Error('Vector service not available');
    }

    const index = this.pinecone.index(this.indexName);

    await index.deleteMany({
      filter: { knowledgeBaseId },
    });

    this.logger.log(`Deleted all vectors for knowledge base ${knowledgeBaseId}`);
  }

  /**
   * 删除文档的所有向量（通过 source 前缀匹配）
   */
  async deleteByDocument(knowledgeBaseId: string, documentId: string) {
    if (!this.isAvailable()) {
      throw new Error('Vector service not available');
    }

    const index = this.pinecone.index(this.indexName);

    // 使用 metadata 过滤删除
    await index.deleteMany({
      filter: {
        knowledgeBaseId,
        source: documentId,
      },
    });

    this.logger.log(
      `Deleted all vectors for document ${documentId} in knowledge base ${knowledgeBaseId}`,
    );
  }
}
