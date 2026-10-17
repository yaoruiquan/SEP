import { GoneException, NotFoundException } from '@nestjs/common';
import { DocumentService } from './document.service';
import { TextChunkService } from './text-chunk.service';
import { KnowledgeAccessPolicy } from './knowledge-access-policy';

describe('Knowledge resource access boundaries', () => {
  let prisma: any;
  let context: any;
  let policy: KnowledgeAccessPolicy;
  beforeEach(() => {
    prisma = {
      knowledgeBase: { findFirst: jest.fn().mockResolvedValue({ id: 'kb-a' }) },
      document: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
      textChunk: { findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    };
    context = { resolve: jest.fn().mockResolvedValue({ enterpriseId: 'ent-a', memberId: 'm-a', role: 'MEMBER' }) };
    policy = new KnowledgeAccessPolicy(prisma, context);
  });

  it('rejects empty files on the server before creating files or processing tasks', async () => {
    context.resolve.mockResolvedValue({ enterpriseId: 'ent-a', memberId: 'm-admin', role: 'ENTERPRISE_ADMIN' });
    const queue = { enqueue: jest.fn() };
    const service = new DocumentService(prisma, queue as any, policy, {} as any);
    for (const file of [
      { originalname: 'empty.txt', mimetype: 'text/plain', size: 0, buffer: Buffer.alloc(0) },
      { originalname: 'empty.txt', mimetype: 'text/plain', size: 10, buffer: Buffer.alloc(0) },
    ]) {
      await expect(service.uploadDocument('kb-a', file as Express.Multer.File, 'u-admin'))
        .rejects.toMatchObject({ status: 400, response: { code: 'VALIDATION_ERROR', message: '不能上传空文件' } });
    }
    expect(prisma.document.create).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('rejects ungranted and cross-tenant document reads before fetching content', async () => {
    prisma.knowledgeBase.findFirst.mockResolvedValue(null);
    const service = new DocumentService(prisma, {} as any, policy, {} as any);
    await expect(service.getDocumentForUser('kb-other', 'doc-a', 'u-a')).rejects.toThrow(NotFoundException);
    expect(prisma.document.findUnique).not.toHaveBeenCalled();
  });

  it('does not expose server paths or unsafe processing errors in details', async () => {
    prisma.document.findUnique.mockResolvedValue({ id: 'doc-a' });
    const service = new DocumentService(prisma, {} as any, policy, {} as any);
    await service.getDocumentForUser('kb-a', 'doc-a', 'u-a');
    const select = prisma.document.findUnique.mock.calls[0][0].select;
    expect(select.storagePath).not.toBe(true);
    expect(select.lastError).not.toBe(true);
    expect(select.embeddingModel).not.toBe(true);
  });

  it('document list and detail do not select uploader account identifiers or email', async () => {
    prisma.document.findUnique.mockResolvedValue({ id: 'doc-a' });
    const service = new DocumentService(prisma, {} as any, policy, {} as any);
    await service.listDocumentsForUser('kb-a', 'u-a');
    await service.getDocumentForUser('kb-a', 'doc-a', 'u-a');
    for (const call of [prisma.document.findMany.mock.calls[0], prisma.document.findUnique.mock.calls[0]]) {
      const select = call[0].select;
      expect(select.uploadedBy).not.toBe(true);
      expect(select.uploader?.select.id).not.toBe(true);
      expect(select.uploader?.select.email).not.toBe(true);
    }
  });

  it('retired download never accesses original files', async () => {
    const service = new DocumentService(prisma, {} as any, policy, {} as any);
    await expect(service.downloadDocument('kb-a', 'doc-a', 'u-a')).rejects.toThrow(GoneException);
    expect(prisma.document.findUnique).not.toHaveBeenCalled();
  });

  it('retired manual writes have zero storage or index effects', async () => {
    const service = new TextChunkService(prisma, policy);
    await expect(service.createTextChunk('kb-a', { content: 'x' } as any, 'u-a')).rejects.toThrow(GoneException);
    await expect(service.updateTextChunk('kb-a', 'chunk-a', { content: 'x' } as any, 'u-a')).rejects.toThrow(GoneException);
    await expect(service.deleteTextChunk('kb-a', 'chunk-a', 'u-a')).rejects.toThrow(GoneException);
    expect(prisma.textChunk.create).not.toHaveBeenCalled();
    expect(prisma.textChunk.update).not.toHaveBeenCalled();
    expect(prisma.textChunk.delete).not.toHaveBeenCalled();
  });

  it('preview returns the exact transitional page, without invented version or locations', async () => {
    prisma.document.findFirst.mockResolvedValue({ id: 'doc-a', originalName: '政策.txt', status: 'READY' });
    prisma.textChunk.findMany.mockResolvedValue([{ id: 'c-a', content: '<script>plain text</script>' }]);
    prisma.textChunk.count.mockResolvedValue(1);
    const service = new DocumentService(prisma, {} as any, policy, {} as any);
    await expect(service.preview('kb-a', 'doc-a', 'u-a', { page: 1, pageSize: 20 })).resolves.toEqual({
      documentId: 'doc-a', documentName: '政策.txt', previewKind: 'PROCESSED_CHUNKS', versionId: null,
      items: [{ chunkId: 'c-a', text: '<script>plain text</script>' }], page: 1, pageSize: 20, total: 1,
    });
  });

  it('unready previews fail with safe 409 before any chunk query', async () => {
    prisma.document.findFirst.mockResolvedValue({ id: 'doc-a', status: 'FAILED' });
    const service = new DocumentService(prisma, {} as any, policy, {} as any);
    await expect(service.preview('kb-a', 'doc-a', 'u-a', { page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 409 });
    expect(prisma.textChunk.findMany).not.toHaveBeenCalled();
  });
});
