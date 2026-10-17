import { NotFoundException } from '@nestjs/common';
import { KnowledgeReindexService } from './knowledge-reindex.service';

const profile = { model: 'model', dimension: 1024, tokenizer: 'tokenizer-v1', distance: 'cosine' as const };
const versioned = () => ({ id: 'chunk', content: 'published text', knowledgeBaseId: 'kb', documentId: 'doc',
  embeddingModel: profile.model,
  versionId: 'v1', indexGeneration: 2, knowledgeBase: { deletedAt: null },
  document: { id: 'doc', knowledgeBaseId: 'kb', deletedAt: null, activeVersionId: 'v1', status: 'FAILED' },
  version: { id: 'v1', documentId: 'doc', published: true, status: 'READY', generation: 2, profile } });
const published = () => ({ ...versioned(), versionId: null, version: null,
  document: { ...versioned().document, activeVersionId: null, status: 'READY' } });

describe('KnowledgeReindexService publication lifecycle', () => {
  let prisma: any;
  let tx: any;
  let embedding: any;
  let vector: any;
  let service: KnowledgeReindexService;
  beforeEach(() => {
    tx = { $queryRaw: jest.fn().mockResolvedValue([]),
      textChunk: { findMany: jest.fn().mockResolvedValue([published()]), update: jest.fn().mockResolvedValue({}) } };
    prisma = { knowledgeBase: { findFirst: jest.fn().mockResolvedValue({ id: 'kb', enterpriseId: 'ent' }) },
      textChunk: { findMany: jest.fn().mockResolvedValue([published()]) },
      $transaction: jest.fn(async callback => callback(tx)) };
    embedding = { isAvailable: jest.fn().mockResolvedValue(true), getModel: () => 'model', getDimension: () => 1024,
      getBatchSize: () => 16, embedBatch: jest.fn().mockResolvedValue([{ embedding: new Float32Array(1024) }]) };
    vector = { upsertVector: jest.fn().mockResolvedValue(undefined), invalidateCache: jest.fn() };
    service = new KnowledgeReindexService(prisma, embedding, vector, { tokenize: () => ['text'] } as any,
      { resolve: jest.fn().mockResolvedValue({ enterpriseId: 'ent' }), assertEnterpriseAdmin: jest.fn() } as any);
  });

  it('reindexes legacy READY chunks and writes both vector representations in one transaction', async () => {
    await expect(service.reindex('user', 'kb')).resolves.toMatchObject({ total: 1, indexed: 1, failed: 0 });
    expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('knowledge_bases');
    expect(tx.$queryRaw.mock.calls[1][0].join('')).toContain('documents');
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.textChunk.findMany.mock.invocationCallOrder[0]);
    expect(vector.upsertVector).toHaveBeenCalledWith('chunk', expect.any(Float32Array), tx);
    expect(tx.textChunk.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ embeddingModel: 'model' }) }));
  });

  it.each([profile, { ...profile, tokenizer: 'other' }])('rejects published version reindex without replacing its profile', async storedProfile => {
    const chunk = versioned();
    prisma.textChunk.findMany.mockResolvedValue([{ ...chunk, version: { ...chunk.version, profile: storedProfile } }]);
    await expect(service.reindex('user', 'kb')).rejects.toMatchObject({ status: 409,
      response: { code: 'KNOWLEDGE_VERSION_REINDEX_REQUIRED' } });
    expect(embedding.embedBatch).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.textChunk.update).not.toHaveBeenCalled();
    expect(vector.upsertVector).not.toHaveBeenCalled();
  });

  it('rejects a mixed legacy/versioned KB before embedding or partially writing any legacy chunks', async () => {
    prisma.textChunk.findMany.mockResolvedValue([published(), { ...versioned(), id: 'versioned-chunk' }]);
    await expect(service.reindex('user', 'kb')).rejects.toMatchObject({ status: 409,
      response: { code: 'KNOWLEDGE_VERSION_REINDEX_REQUIRED' } });
    expect(embedding.embedBatch).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.textChunk.update).not.toHaveBeenCalled();
    expect(vector.upsertVector).not.toHaveBeenCalled();
  });

  it.each([
    { ...published(), indexGeneration: 1 },
    { ...published(), document: { ...published().document, activeVersionId: 'v2' } },
    versioned(),
    { ...published(), document: { ...published().document, status: 'FAILED' } },
    { ...published(), knowledgeBase: { deletedAt: new Date() } },
    { ...published(), document: { ...published().document, deletedAt: new Date() } },
    { ...published(), content: 'different content' },
    { ...published(), indexGeneration: 3 },
  ])('does not write when publication changes while embedding is in flight', async current => {
    tx.textChunk.findMany.mockResolvedValue([current]);
    await expect(service.reindex('user', 'kb')).resolves.toMatchObject({ total: 1, indexed: 0, failed: 1 });
    expect(tx.textChunk.update).not.toHaveBeenCalled();
    expect(vector.upsertVector).not.toHaveBeenCalled();
  });

  it('excludes unpublished candidates before embedding', async () => {
    prisma.textChunk.findMany.mockResolvedValue([{ ...versioned(), indexGeneration: 1 }]);
    await expect(service.reindex('user', 'kb')).resolves.toMatchObject({ total: 0, indexed: 0, failed: 0 });
    expect(embedding.embedBatch).not.toHaveBeenCalled();
  });

  it('rejects deleted or foreign KBs before loading chunks', async () => {
    prisma.knowledgeBase.findFirst.mockResolvedValue(null);
    await expect(service.reindex('user', 'kb')).rejects.toThrow(NotFoundException);
    expect(prisma.knowledgeBase.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'kb', enterpriseId: 'ent', deletedAt: null },
    }));
    expect(prisma.textChunk.findMany).not.toHaveBeenCalled();
  });

  it('does not report success if native vector persistence fails', async () => {
    vector.upsertVector.mockRejectedValue(new Error('native write failed'));
    await expect(service.reindex('user', 'kb')).resolves.toMatchObject({ total: 1, indexed: 0, failed: 1 });
  });
});
