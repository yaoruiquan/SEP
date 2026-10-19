import { DocumentProcessorService } from './document-processor.service';
import { KnowledgeRetentionService, knowledgeHistoryRetentionDays } from './knowledge-retention.service';

const deadline = new Date('2026-09-01T00:00:00Z');
const candidate = { id: 'old-version', documentId: 'document', retiredAt: deadline };

function setup(values: Record<string, unknown> = {}) {
  const version = { ...candidate, published: false, status: 'READY', stage: 'DONE', storagePath: '/private/old' };
  const document = { id: 'document', deletedAt: null, activeVersionId: 'active', latestVersionId: 'latest',
    storagePath: '/private/current', knowledgeBase: { deletedAt: null } };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ locked: true, id: 'document' }]),
    document: { findUnique: jest.fn().mockResolvedValue(document), findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}) },
    documentVersion: { findUnique: jest.fn().mockResolvedValue(version), findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    textChunk: { deleteMany: jest.fn().mockResolvedValue({ count: 4 }) },
    knowledgeParsedBlock: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    knowledgeProcessingJob: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([candidate]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn().mockImplementation(async fn => fn(tx)),
    knowledgeProcessingJob: { count: jest.fn().mockResolvedValue(0) },
  };
  const config = { get: jest.fn((key: string) => values[key]) };
  const service = new KnowledgeRetentionService(prisma as any, config as any);
  const remove = jest.spyOn((service as any).storage, 'remove').mockResolvedValue(undefined);
  return { service, prisma, tx, document, version, remove, config };
}

describe('knowledge history retention', () => {
  it('defaults to 30 days and validates configuration', () => {
    expect(knowledgeHistoryRetentionDays()).toBe(30);
    for (const value of [0, -1, 'bad', 1.5, Infinity, '']) {
      expect(knowledgeHistoryRetentionDays({ get: () => value } as any)).toBe(30);
    }
    expect(knowledgeHistoryRetentionDays({ get: () => '7' } as any)).toBe(7);
  });

  it('purges expired chunks, blocks and private originals while retaining version metadata', async () => {
    const { service, tx, remove } = setup();
    const result = await service.runOnce();
    expect(result).toMatchObject({ scanned: 1, cleaned: 1, failed: 0 });
    expect(remove).toHaveBeenCalledWith('/private/old');
    expect(tx.textChunk.deleteMany).toHaveBeenCalledWith({ where: { versionId: 'old-version' } });
    expect(tx.knowledgeParsedBlock.deleteMany).toHaveBeenCalledWith({ where: { versionId: 'old-version' } });
    expect(tx.documentVersion.update).toHaveBeenCalledWith({ where: { id: 'old-version' },
      data: { stage: 'EXPIRED', storagePath: '' } });
  });

  it.each(['active', 'latest', 'published', 'future', 'processing', 'deleted', 'base-deleted', 'expired', 'missing'])
  ('rechecks %s protection under the document lock', async kind => {
    const { service, document, version, tx, remove } = setup();
    if (kind === 'active') document.activeVersionId = version.id;
    if (kind === 'latest') document.latestVersionId = version.id;
    if (kind === 'published') version.published = true;
    if (kind === 'future') version.retiredAt = new Date(Date.now() + 100000);
    if (kind === 'processing') version.status = 'PROCESSING';
    if (kind === 'deleted') document.deletedAt = new Date() as any;
    if (kind === 'base-deleted') document.knowledgeBase.deletedAt = new Date() as any;
    if (kind === 'expired') version.stage = 'EXPIRED';
    if (kind === 'missing') tx.documentVersion.findUnique.mockResolvedValue(null);
    expect(await service.runOnce()).toMatchObject({ cleaned: 0, failed: 0, skipped: 1 });
    expect(remove).not.toHaveBeenCalled();
    expect(tx.textChunk.deleteMany).not.toHaveBeenCalled();
  });

  it.each(['document', 'version'])('never removes an original shared by another %s', async kind => {
    const { service, tx, remove } = setup();
    if (kind === 'document') tx.document.findFirst.mockResolvedValue({ id: 'other-document' } as any);
    else tx.documentVersion.findFirst.mockResolvedValue({ id: 'other-version' } as any);
    expect(await service.runOnce()).toMatchObject({ cleaned: 1 });
    expect(remove).not.toHaveBeenCalled();
    expect(tx.documentVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { storagePath: '/private/old', id: { not: 'old-version' } },
    }));
  });

  it('moves a legacy original pointer to the active version before reclaiming an old original', async () => {
    const { service, tx, document, remove } = setup();
    document.storagePath = '/private/old';
    tx.documentVersion.findFirst.mockResolvedValueOnce({ id: 'active', storagePath: '/private/current' } as any)
      .mockResolvedValueOnce(null);
    expect(await service.runOnce()).toMatchObject({ cleaned: 1 });
    expect(tx.document.update).toHaveBeenCalledWith({ where: { id: 'document' }, data: { storagePath: '/private/current' } });
    expect(remove).toHaveBeenCalledWith('/private/old');
  });

  it('keeps an original if the legacy document pointer cannot be moved safely', async () => {
    const { service, document, remove } = setup();
    document.storagePath = '/private/old';
    expect(await service.runOnce()).toMatchObject({ cleaned: 1 });
    expect(remove).not.toHaveBeenCalled();
  });

  it.each(['advisory', 'document'])('skips competing %s locks instead of blocking publication or another instance', async kind => {
    const { service, tx, remove } = setup();
    tx.$queryRaw.mockReset();
    if (kind === 'advisory') tx.$queryRaw.mockResolvedValueOnce([{ locked: false }]);
    else tx.$queryRaw.mockResolvedValueOnce([{ locked: true }]).mockResolvedValueOnce([]);
    expect(await service.runOnce()).toMatchObject({ cleaned: 0, skipped: 1 });
    expect(remove).not.toHaveBeenCalled();
  });

  it('does not erase references on file failure and retries on the next eligible batch', async () => {
    const { service, prisma, tx, remove } = setup();
    remove.mockRejectedValueOnce(new Error('private disk unavailable')).mockResolvedValueOnce(undefined);
    expect(await service.runOnce()).toMatchObject({ cleaned: 0, failed: 1 });
    expect(tx.documentVersion.update).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(await service.runOnce()).toMatchObject({ cleaned: 1, failed: 0 });
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('continues with the remaining candidates after a failed version', async () => {
    const { service, prisma, remove } = setup();
    prisma.$queryRaw.mockResolvedValue([candidate, { ...candidate, id: 'next-version' }]);
    remove.mockRejectedValueOnce(new Error('unlink failed'));
    expect(await service.runOnce()).toMatchObject({ scanned: 2, cleaned: 1, failed: 1 });
  });

  it('caps database candidate batches and applies persistent failure cooldown in SQL', async () => {
    const { service, prisma } = setup({ KNOWLEDGE_RETENTION_BATCH_SIZE: '9999' });
    await service.runOnce();
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0];
    const query = `${strings.join('')} ${values.map(value => typeof value === 'object' ? JSON.stringify(value) : value).join(' ')}`;
    expect(query).toMatch(/RETENTION_RETRY/);
    expect(query).toMatch(/IS DISTINCT FROM/);
    expect(query).toMatch(/ORDER BY/);
    expect(query).toMatch(/LIMIT/);
    expect(query).toMatch(/100/);
  });

  it('deduplicates overlapping runs in one process', async () => {
    const { service, prisma } = setup();
    let release!: (value: unknown[]) => void;
    prisma.$queryRaw.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const first = service.runOnce();
    const second = service.runOnce();
    release([]);
    await Promise.all([first, second]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('reports persisted backlog and lag plus local batch health without exposing contents or paths', async () => {
    const { service, prisma } = setup({ KNOWLEDGE_HISTORY_RETENTION_DAYS: '7' });
    await service.runOnce();
    prisma.$queryRaw.mockResolvedValue([{ count: 3n, oldest: deadline }]);
    prisma.knowledgeProcessingJob.count.mockResolvedValue(2);
    const status = await service.getStatus();
    expect(status).toMatchObject({ retentionDays: 7, pendingVersions: 3, oldestExpiredAt: deadline,
      failedDeletionJobs: 2, running: false, lastBatch: { cleaned: 1 }, lastError: null });
    expect(status.lagMs).toBeGreaterThan(0);
    expect(status.lastSuccessAt).toBeInstanceOf(Date);
    expect(JSON.stringify(status)).not.toMatch(/private|old-version|document/);
  });

  it('records infrastructure failure and contains scheduled errors', async () => {
    const { service, prisma } = setup();
    prisma.$queryRaw.mockRejectedValue(new Error('database password secret'));
    await expect(service.maintain()).resolves.toBeUndefined();
    prisma.$queryRaw.mockResolvedValue([{ count: 0n, oldest: null }]);
    expect(await service.getStatus()).toMatchObject({ running: false, lastError: 'RETENTION_UNAVAILABLE', lastSuccessAt: null });
  });

  it('is idempotent when an already cleaned candidate is delivered again', async () => {
    const { service, version, remove } = setup();
    await service.runOnce();
    version.stage = 'EXPIRED';
    version.storagePath = '';
    expect(await service.runOnce()).toMatchObject({ cleaned: 0, skipped: 1 });
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('deleted knowledge document cleanup', () => {
  function setupCleanup() {
    const state = setup();
    const { tx, document } = state;
    document.deletedAt = new Date() as any;
    const versions = [{ id: 'old-version', storagePath: '/private/old' }, { id: 'active', storagePath: '/private/current' }];
    tx.document.findUnique.mockResolvedValue({ ...document, versions } as any);
    const service = new DocumentProcessorService({} as any, {} as any, {} as any, {} as any, {} as any);
    jest.spyOn(service as any, 'guarded').mockImplementation(async (...args: any[]) => args[1](tx));
    const remove = jest.spyOn((service as any).storage, 'remove').mockResolvedValue(undefined);
    return { ...state, service, remove };
  }

  it('keeps shared originals and clears deleted-document references after successful cleanup', async () => {
    const { service, tx, remove } = setupCleanup();
    tx.documentVersion.findFirst.mockResolvedValueOnce({ id: 'external-shared-version' } as any).mockResolvedValueOnce(null);
    await (service as any).cleanup({ id: 'cleanup-job', documentId: 'document' });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(tx.documentVersion.findFirst).toHaveBeenCalledWith({ where: { storagePath: '/private/current', documentId: { not: 'document' } }, select: { id: true } });
    expect(tx.documentVersion.updateMany).toHaveBeenCalledWith({ where: { documentId: 'document' }, data: { storagePath: '' } });
    expect(tx.document.update).toHaveBeenCalledWith({ where: { id: 'document' }, data: { storagePath: '' } });
    expect(tx.knowledgeProcessingJob.update).toHaveBeenCalledWith({ where: { id: 'cleanup-job' }, data: { status: 'DONE', leaseUntil: null } });
  });

  it('retains cleanup state for retry when physical removal fails', async () => {
    const { service, tx, remove } = setupCleanup();
    remove.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect((service as any).cleanup({ id: 'cleanup-job', documentId: 'document' })).rejects.toThrow();
    expect(tx.documentVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.knowledgeProcessingJob.update).not.toHaveBeenCalled();
  });
});
