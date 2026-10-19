import { Prisma } from '@prisma/client';
import { LexicalSearchService } from './lexical-search.service';

describe('LexicalSearchService publication boundary', () => {
  const active = () => ({ id: 'chunk', content: 'current content', tokens: ['current'], source: 'doc',
    knowledgeBaseId: 'kb', documentId: 'doc', versionId: 'v1', indexGeneration: 3,
    knowledgeBase: { deletedAt: null },
    document: { id: 'doc', knowledgeBaseId: 'kb', deletedAt: null, activeVersionId: 'v1', status: 'FAILED' },
    version: { id: 'v1', documentId: 'doc', published: true, status: 'READY', generation: 3 } });
  let prisma: any;
  let scorer: any;
  let service: LexicalSearchService;
  beforeEach(() => {
    prisma = { $queryRaw: jest.fn().mockResolvedValue([{ ...active(), content: 'old candidate' }]),
      textChunk: { findMany: jest.fn().mockResolvedValue([active()]) } };
    scorer = { rank: jest.fn().mockReturnValue([{ id: 'chunk', score: 1 }]) };
    service = new LexicalSearchService(prisma, { tokenize: jest.fn().mockReturnValue(['current']) } as any, scorer);
  });

  it('uses exact SQL publication predicates and reloads content before scoring', async () => {
    await expect(service.search('current', 'ent', ['kb'], 5)).resolves.toEqual([{
      chunkId: 'chunk', content: 'current content', source: 'doc', score: 1, knowledgeBaseId: 'kb',
    }]);
    const call = prisma.$queryRaw.mock.calls[0];
    const sql = Prisma.sql(call[0], ...call.slice(1)).sql;
    expect(sql).toContain('LEFT JOIN document_versions dv');
    expect(sql).toContain('kb."deletedAt" IS NULL');
    expect(sql).toContain('d."deletedAt" IS NULL');
    expect(sql).toContain('tc."versionId" = d."activeVersionId"');
    expect(sql).toContain('dv.generation = tc."indexGeneration"');
    expect(sql).not.toContain("d.id AND d.status = 'READY'");
  });

  it.each([
    { ...active(), indexGeneration: 2 },
    { ...active(), document: { ...active().document, activeVersionId: 'v2' } },
    { ...active(), knowledgeBase: { deletedAt: new Date() } },
    { ...active(), document: { ...active().document, deletedAt: new Date() } },
  ])('rejects candidates that cease to be published during recall', async row => {
    prisma.textChunk.findMany.mockResolvedValue([row]);
    await expect(service.search('current', 'ent', ['kb'], 5)).resolves.toEqual([]);
    expect(scorer.rank).not.toHaveBeenCalled();
  });
});
