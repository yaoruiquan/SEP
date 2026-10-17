import { NotFoundException } from '@nestjs/common';
import { TextChunkService } from './text-chunk.service';

const active = () => ({
  id: 'chunk', knowledgeBaseId: 'kb', documentId: 'doc', title: null, content: 'Published policy',
  source: 'policy.txt', tags: [], createdAt: new Date(0), updatedAt: new Date(0),
  versionId: 'v1', indexGeneration: 2, embeddingModel: 'model', knowledgeBase: { deletedAt: null },
  document: { id: 'doc', knowledgeBaseId: 'kb', originalName: 'policy.txt', status: 'READY',
    activeVersionId: 'v1', deletedAt: null },
  version: { id: 'v1', documentId: 'doc', status: 'READY', published: true, generation: 2,
    profile: null },
});

describe('legacy chunk read publication boundary', () => {
  let prisma: any;
  let policy: any;
  let service: TextChunkService;
  beforeEach(() => {
    prisma = { textChunk: { findMany: jest.fn(), findFirst: jest.fn() } };
    policy = { assertRead: jest.fn().mockResolvedValue({ enterpriseId: 'enterprise' }) };
    service = new TextChunkService(prisma, policy);
  });

  const hidden = () => [
    { ...active(), version: { ...active().version, published: false } },
    { ...active(), document: { ...active().document, activeVersionId: 'v2' } },
    { ...active(), indexGeneration: 1 },
    { ...active(), document: { ...active().document, deletedAt: new Date() } },
    { ...active(), knowledgeBase: { deletedAt: new Date() } },
  ];

  it('lists only published active generations and keeps publication metadata private', async () => {
    prisma.textChunk.findMany.mockResolvedValue([active(), ...hidden()]);
    const result = await service.listTextChunks('kb', 'user', 'policy');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'chunk', content: 'Published policy' });
    expect(result[0]).not.toHaveProperty('version');
    expect(result[0]).not.toHaveProperty('embeddingModel');
    expect(result[0]).not.toHaveProperty('document');
    expect(prisma.textChunk.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      knowledgeBaseId: 'kb', document: { deletedAt: null }, AND: expect.any(Array),
    }) }));
  });

  it.each([0, 1, 2, 3, 4])('rejects direct reads of hidden chunks (%s)', async index => {
    prisma.textChunk.findFirst.mockResolvedValue(hidden()[index]);
    await expect(service.getTextChunk('kb', 'chunk', 'user')).rejects.toThrow(NotFoundException);
  });

  it('keeps the old active content readable when the latest version fails', async () => {
    const row = { ...active(), document: { ...active().document, status: 'FAILED' } };
    prisma.textChunk.findMany.mockResolvedValue([row]);
    prisma.textChunk.findFirst.mockResolvedValue(row);
    expect(await service.listTextChunks('kb', 'user')).toHaveLength(1);
    expect(await service.getTextChunk('kb', 'chunk', 'user')).toMatchObject({ id: 'chunk' });
  });

  it('does not return content if read permission is revoked while the query runs', async () => {
    prisma.textChunk.findMany.mockResolvedValue([active()]);
    policy.assertRead.mockResolvedValueOnce({}).mockRejectedValueOnce(new NotFoundException());
    await expect(service.listTextChunks('kb', 'user')).rejects.toThrow(NotFoundException);
  });
});
