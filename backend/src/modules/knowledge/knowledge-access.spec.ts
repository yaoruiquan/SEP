import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DocumentService } from './document.service';
import { TextChunkService } from './text-chunk.service';

describe('Knowledge resource access boundaries', () => {
  it('does not allow a non-admin to upload a document', async () => {
    const prisma = { document: { create: jest.fn() } } as any;
    const context = {
      resolve: jest.fn().mockResolvedValue({ enterpriseId: 'ent-a', role: 'MEMBER' }),
      assertEnterpriseAdmin: jest.fn(() => {
        throw new ForbiddenException('仅企业管理员可执行此操作');
      }),
    } as any;
    const service = new DocumentService(
      prisma,
      {} as any,
      context,
      { invalidateCache: jest.fn() } as any,
    );

    await expect(service.uploadDocument('kb-a', {
      originalname: 'notes.txt',
      mimetype: 'text/plain',
      size: 5,
      buffer: Buffer.from('hello'),
    } as Express.Multer.File, 'user-a')).rejects.toThrow(ForbiddenException);
    expect(prisma.document.create).not.toHaveBeenCalled();
  });

  it('does not allow reading a knowledge base from another enterprise', async () => {
    const prisma = {
      knowledgeBase: { findFirst: jest.fn().mockResolvedValue(null) },
      textChunk: { findMany: jest.fn() },
    } as any;
    const context = {
      resolve: jest.fn().mockResolvedValue({ enterpriseId: 'ent-a', role: 'ENTERPRISE_ADMIN' }),
    } as any;
    const service = new TextChunkService(
      prisma,
      context,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.listTextChunks('kb-other', 'user-a')).rejects.toThrow(NotFoundException);
    expect(prisma.textChunk.findMany).not.toHaveBeenCalled();
  });

  it('does not expose the server storage path in document details', async () => {
    const prisma = {
      knowledgeBase: { findFirst: jest.fn().mockResolvedValue({ id: 'kb-a' }) },
      document: {
        findUnique: jest.fn().mockResolvedValue({ id: 'doc-a', storagePath: '/srv/uploads/doc-a.txt' }),
      },
    } as any;
    const context = {
      resolve: jest.fn().mockResolvedValue({ enterpriseId: 'ent-a', role: 'MEMBER' }),
    } as any;
    const service = new DocumentService(
      prisma,
      {} as any,
      context,
      {} as any,
    );

    await service.getDocumentForUser('kb-a', 'doc-a', 'user-a');

    expect(prisma.document.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.not.objectContaining({ storagePath: true }),
    }));
  });
});
