import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { KnowledgeSearchService } from './knowledge-search.service';
import { KnowledgeAccessPolicy } from './knowledge-access-policy';

const MEMBER = { enterpriseId: 'ent-a', memberId: 'm-a', role: 'MEMBER', departmentId: 'dept-a' };
const candidate = { chunkId: 'c-a', content: 'stale cache', source: 'doc-a', knowledgeBaseId: 'kb-a', score: 0.9 };

describe('KnowledgeSearchService authorization and logging', () => {
  let service: KnowledgeSearchService;
  let prisma: any;
  let context: any;
  let lexical: any;
  beforeEach(() => {
    prisma = {
      subscription: { findFirst: jest.fn() },
      knowledgeGrant: { findMany: jest.fn().mockResolvedValue([{ knowledgeBaseId: 'kb-a' }]) },
      knowledgeBase: { findMany: jest.fn().mockResolvedValue([{ id: 'kb-a' }]) },
      knowledgeSearchLog: { create: jest.fn().mockResolvedValue({}) },
      textChunk: { findMany: jest.fn().mockResolvedValue([{
        id: 'c-a', content: '退款规则', source: 'doc-a', knowledgeBaseId: 'kb-a',
        document: { id: 'doc-a', originalName: '政策.txt' },
      }]) },
    };
    context = { resolve: jest.fn().mockResolvedValue(MEMBER) };
    lexical = { search: jest.fn().mockResolvedValue([candidate]) };
    service = new KnowledgeSearchService(prisma, { isAvailable: jest.fn().mockResolvedValue(false) } as any,
      {} as any, lexical, context, new KnowledgeAccessPolicy(prisma, context));
  });

  it('rejects a foreign subscription before reading legacy knowledge grants', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    await expect(service.search('退款', 'u-a', 'sub-b', 5, 0.7, 'lexical')).rejects.toThrow(ForbiddenException);
    expect(prisma.knowledgeGrant.findMany).not.toHaveBeenCalled();
  });

  it('intersects old chat subscription grants with current member-readable bases', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ enterpriseId: 'ent-a' });
    const result = await service.search('退款', 'u-a', 'sub-a', 5, 0.7, 'lexical');
    expect(prisma.knowledgeGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      knowledgeBase: { enterpriseId: 'ent-a', memberGrants: { some: { memberId: 'm-a' } } },
    }) }));
    expect(result.results[0]).toMatchObject({ content: '退款规则', documentId: 'doc-a', documentName: '政策.txt' });
  });

  it('rejects the entire explicit scope if any base is ungranted or foreign', async () => {
    await expect(service.searchForMember('u-a', { query: '退款', knowledgeBaseIds: ['kb-a', 'secret'], topK: 5 }))
      .rejects.toThrow(NotFoundException);
    expect(lexical.search).not.toHaveBeenCalled();
  });

  it('searches all member-readable bases without a subscription', async () => {
    const result = await service.searchForMember('u-a', { query: '退款', topK: 5 });
    expect(result.results[0]).toMatchObject({ documentId: 'doc-a', documentName: '政策.txt' });
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
    expect(prisma.knowledgeGrant.findMany).not.toHaveBeenCalled();
    expect(prisma.knowledgeBase.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      enterpriseId: 'ent-a', memberGrants: { some: { memberId: 'm-a' } },
    } }));
  });

  it('does not return cache content after revoke or a document losing READY status', async () => {
    prisma.textChunk.findMany.mockResolvedValue([]);
    const result = await service.searchForMember('u-a', { query: '退款', topK: 5 });
    expect(result.results).toEqual([]);
    expect(prisma.textChunk.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      document: { status: 'READY' }, knowledgeBase: { enterpriseId: 'ent-a', memberGrants: { some: { memberId: 'm-a' } } },
    }) }));
  });

  it('closes the internal direct search bypass unless a current member identity is provided', async () => {
    await expect(service.searchByKnowledgeBase('q', ['kb-a'])).rejects.toThrow(ForbiddenException);
    expect(lexical.search).not.toHaveBeenCalled();
  });

  it('reports dependency failure as 503 instead of a successful empty result', async () => {
    lexical.search.mockRejectedValue(new Error('database credentials or internal error'));
    await expect(service.searchForMember('u-a', { query: '退款', topK: 5 })).rejects.toMatchObject({
      status: 503, response: { code: 'KNOWLEDGE_SERVICE_UNAVAILABLE', message: '知识库检索暂时不可用' },
    });
  });
});
