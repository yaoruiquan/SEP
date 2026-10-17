import { NotFoundException } from '@nestjs/common';
import { DocumentService } from './document.service';

describe('Document management transaction boundaries', () => {
  const file = { originalname: 'policy.txt', mimetype: 'text/plain', size: 8, buffer: Buffer.from('original') } as Express.Multer.File;
  const headers = { idempotencyKey: 'upload-request-1' };
  let service: DocumentService;
  let prisma: any;
  let tx: any;
  let policy: any;
  let storage: any;
  let committed: boolean;

  beforeEach(() => {
    committed = false;
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      enterpriseMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'member', enterpriseId: 'ent', role: 'ENTERPRISE_ADMIN' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'member', enterpriseId: 'ent', role: 'ENTERPRISE_ADMIN' }),
      },
      knowledgeBase: { findFirst: jest.fn().mockResolvedValue({ id: 'kb', enterpriseId: 'ent' }) },
      document: { create: jest.fn().mockResolvedValue({ id: 'doc' }), update: jest.fn().mockResolvedValue({}) },
      documentVersion: { create: jest.fn().mockResolvedValue({ id: 'v1' }) },
      knowledgeProcessingJob: { create: jest.fn().mockResolvedValue({}) },
      knowledgeIdempotency: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn(async run => { const result = await run(tx); committed = true; return result; }),
      document: {
        findUnique: jest.fn().mockResolvedValue({ id: 'doc', versions: [] }),
        findFirst: jest.fn().mockResolvedValue({ id: 'doc' }),
      },
      knowledgeParsedBlock: { findMany: jest.fn().mockResolvedValue([{ id: 'b', text: 'private', page: 1 }]), count: jest.fn().mockResolvedValue(1) },
      textChunk: { findMany: jest.fn().mockResolvedValue([{ id: 'c', content: 'legacy private' }]), count: jest.fn().mockResolvedValue(1) },
    };
    policy = {
      assertManage: jest.fn().mockResolvedValue(undefined), assertRead: jest.fn().mockResolvedValue(undefined),
      notFound: jest.fn(() => { throw new NotFoundException(); }),
    };
    service = new DocumentService(prisma, {} as any, policy, {} as any);
    storage = (service as any).storage;
    jest.spyOn(storage, 'prepare').mockResolvedValue({ data: file.buffer, sha256: 'hash', originalName: 'policy.txt', mimeType: 'text/plain', fileSize: 8 });
    jest.spyOn(storage, 'write').mockResolvedValue('/private/new');
    jest.spyOn(storage, 'remove').mockResolvedValue(undefined);
  });

  it('removes the original when durable job persistence rolls back', async () => {
    const failure = new Error('job insert failed');
    tx.knowledgeProcessingJob.create.mockRejectedValueOnce(failure);
    await expect(service.uploadDocument('kb', file, 'user', headers)).rejects.toBe(failure);
    expect(committed).toBe(false);
    expect(storage.remove).toHaveBeenCalledWith('/private/new');
    expect(prisma.document.findUnique).not.toHaveBeenCalled();
  });

  it('keeps a committed original even if the response read fails', async () => {
    policy.assertRead.mockRejectedValueOnce(new NotFoundException());
    await expect(service.uploadDocument('kb', file, 'user', headers)).rejects.toThrow(NotFoundException);
    expect(committed).toBe(true);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('discards only the extra original on same-key replay without persisting another job', async () => {
    await service.uploadDocument('kb', file, 'user', headers);
    const saved = tx.knowledgeIdempotency.create.mock.calls[0][0].data;
    tx.knowledgeIdempotency.findUnique.mockResolvedValue(saved);
    storage.write.mockResolvedValueOnce('/private/replay');
    await service.uploadDocument('kb', file, 'user', headers);
    expect(tx.document.create).toHaveBeenCalledTimes(1);
    expect(tx.knowledgeProcessingJob.create).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith('/private/replay');
  });

  it('discards the extra original on conflicting key reuse without persisting another job', async () => {
    tx.knowledgeIdempotency.findUnique.mockResolvedValue({ requestHash: 'different', result: { documentId: 'doc' } });
    await expect(service.uploadDocument('kb', file, 'user', headers)).rejects.toMatchObject({ status: 409 });
    expect(tx.document.create).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledWith('/private/new');
  });

  function readyPreview() {
    prisma.document.findFirst.mockResolvedValue({ id: 'doc', originalName: 'policy.txt', status: 'READY',
      activeVersionId: 'v1', versions: [{ id: 'v1' }] });
  }

  it('scopes parsed blocks and their count to an owned, READY, published version', async () => {
    readyPreview();
    const result = await service.preview('kb', 'doc', 'user', { page: 1, pageSize: 20, versionId: 'v1' });
    const where = { versionId: 'v1', version: { documentId: 'doc', status: 'READY', published: true } };
    expect(prisma.knowledgeParsedBlock.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(prisma.knowledgeParsedBlock.count).toHaveBeenCalledWith({ where });
    expect(result.items).toEqual([{ chunkId: 'b', text: 'private', page: 1 }]);
  });

  it('does not return parsed text after the active version loses publication', async () => {
    readyPreview();
    prisma.document.findFirst.mockResolvedValueOnce({ id: 'doc', status: 'READY', activeVersionId: 'v1' });
    prisma.document.findFirst.mockResolvedValueOnce({ id: 'doc', status: 'READY', activeVersionId: 'v1', versions: [] });
    await expect(service.preview('kb', 'doc', 'user', { page: 1, pageSize: 20 }))
      .rejects.toMatchObject({ status: 409, response: { code: 'DOCUMENT_NOT_READY' } });
  });

  it('does not return legacy text after the document leaves READY with an unchanged null pointer', async () => {
    prisma.document.findFirst.mockResolvedValueOnce({ id: 'doc', status: 'READY', activeVersionId: null });
    prisma.document.findFirst.mockResolvedValueOnce({ id: 'doc', status: 'FAILED', activeVersionId: null });
    await expect(service.preview('kb', 'doc', 'user', { page: 1, pageSize: 20 }))
      .rejects.toMatchObject({ status: 409, response: { code: 'DOCUMENT_NOT_READY' } });
  });

  it.each(['revoked', 'deleted', 'switched'])('rejects preview text before returning when %s mid-query', async change => {
    readyPreview();
    if (change === 'revoked') policy.assertRead.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new NotFoundException());
    if (change === 'deleted') prisma.document.findFirst.mockResolvedValueOnce({ id: 'doc', activeVersionId: 'v1' }).mockResolvedValueOnce(null);
    if (change === 'switched') prisma.document.findFirst.mockResolvedValueOnce({ id: 'doc', activeVersionId: 'v1' })
      .mockResolvedValueOnce({ id: 'doc', activeVersionId: 'v2' });
    await expect(service.preview('kb', 'doc', 'user', { page: 1, pageSize: 20 }))
      .rejects.toMatchObject({ status: change === 'switched' ? 409 : 404 });
  });
});
