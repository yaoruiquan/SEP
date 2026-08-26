import { Module } from '@nestjs/common';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { TextChunkController } from './text-chunk.controller';
import { TextChunkService } from './text-chunk.service';
import { SearchController } from './search.controller';
import { KnowledgeTestController } from './knowledge-test.controller';
import { VectorService } from './vector.service';
import { EmbeddingService } from './embedding.service';
import { DocumentParserService } from './document-parser.service';
import { DocumentProcessorService } from './document-processor.service';
import { KnowledgeQueueService } from './knowledge-queue.service';
import { KnowledgeSearchService } from './knowledge-search.service';
import { KnowledgeTestService } from './knowledge-test.service';
import { KnowledgeAnalyticsService } from './knowledge-analytics.service';
import { TextTokenizer } from './text-tokenizer.service';
import { BM25Scorer } from './bm25-scorer.service';
import { LexicalSearchService } from './lexical-search.service';
import { KnowledgeReindexService } from './knowledge-reindex.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { EnterpriseModule } from '../enterprise/enterprise.module';

@Module({
  imports: [PrismaModule, EnterpriseModule],
  controllers: [
    KnowledgeController,
    KnowledgeTestController,  // Must be before DocumentController to match /documents/status
    DocumentController,
    TextChunkController,
    SearchController,
  ],
  providers: [
    KnowledgeService,
    DocumentService,
    TextChunkService,
    VectorService,
    EmbeddingService,
    DocumentParserService,
    DocumentProcessorService,
    KnowledgeQueueService,
    KnowledgeSearchService,
    KnowledgeTestService,
    KnowledgeAnalyticsService,
    TextTokenizer,
    BM25Scorer,
    LexicalSearchService,
    KnowledgeReindexService,
  ],
  exports: [
    KnowledgeService,
    DocumentService,
    TextChunkService,
    VectorService,
    EmbeddingService,
    DocumentParserService,
    DocumentProcessorService,
    KnowledgeQueueService,
    KnowledgeSearchService,
    KnowledgeTestService,
    KnowledgeAnalyticsService,
    TextTokenizer,
    BM25Scorer,
    LexicalSearchService,
    KnowledgeReindexService,
  ],
})
export class KnowledgeModule {}
