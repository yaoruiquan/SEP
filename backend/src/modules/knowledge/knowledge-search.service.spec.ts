import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { KnowledgeSearchService } from './knowledge-search.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { VectorService } from './vector.service';
import { LexicalSearchService } from './lexical-search.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';

describe('KnowledgeSearchService authorization and logging', () => {
  let service: KnowledgeSearchService;
  let prisma: any;
  let context: any;
  let lexical: any;

  beforeEach(async () => {
    prisma = {
      subscription: { findFirst: jest.fn() },
      knowledgeGrant: { findMany: jest.fn() },
      knowledgeSearchLog: { create: jest.fn().mockResolvedValue({}) },
      textChunk: { findMany: jest.fn() },
    };
    context = {
      resolve: jest.fn().mockResolvedValue({
        enterpriseId: 'ent-a',
        departmentId: 'dept-a',
      }),
    };
    lexical = { search: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        KnowledgeSearchService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmbeddingService, useValue: { isAvailable: jest.fn() } },
        { provide: VectorService, useValue: {} },
        { provide: LexicalSearchService, useValue: lexical },
        { provide: EnterpriseContextService, useValue: context },
      ],
    }).compile();

    service = module.get(KnowledgeSearchService);
  });

  it('rejects a subscription belonging to another enterprise before reading grants', async () => {
    // Prisma's enterpriseId predicate hides a cross-tenant row as not found.
    prisma.subscription.findFirst.mockResolvedValue(null);

    await expect(service.search('退款政策', 'user-a', 'sub-b', 5, 0.7, 'lexical'))
      .rejects.toThrow(ForbiddenException);

    expect(prisma.knowledgeGrant.findMany).not.toHaveBeenCalled();
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
      where: { id: 'sub-b', enterpriseId: 'ent-a' },
    });
  });

  it('filters grants by enterprise and records a real search result', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ enterpriseId: 'ent-a' });
    prisma.knowledgeGrant.findMany.mockResolvedValue([{ knowledgeBaseId: 'kb-a' }]);
    lexical.search.mockResolvedValue([{
      chunkId: 'chunk-a',
      content: '退款规则',
      source: 'doc-a',
      knowledgeBaseId: 'kb-a',
      score: 0.92,
    }]);

    const result = await service.search('退款政策', 'user-a', 'sub-a', 5, 0.7, 'lexical');

    expect(result.results[0]).toEqual(expect.objectContaining({
      source: 'doc-a',
      knowledgeBaseId: 'kb-a',
    }));
    expect(prisma.knowledgeGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        knowledgeBase: { enterpriseId: 'ent-a' },
      }),
    }));
    expect(prisma.knowledgeSearchLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        knowledgeBaseId: 'kb-a',
        enterpriseId: 'ent-a',
        hitCount: 1,
        strategy: 'lexical',
      }),
    }));
  });
});
