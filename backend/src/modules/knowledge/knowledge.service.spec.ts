import { BadRequestException, ForbiddenException, GoneException } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeAccessPolicy } from './knowledge-access-policy';

const ADMIN = { enterpriseId: 'ent-a', id: 'm-admin', memberId: 'm-admin', role: 'ENTERPRISE_ADMIN', departmentId: null };

describe('KnowledgeService member contracts', () => {
  let prisma: any;
  let tx: any;
  let service: KnowledgeService;
  beforeEach(() => {
    tx = {
      enterpriseMember: { findFirst: jest.fn().mockResolvedValue(ADMIN),
        findUnique: jest.fn().mockResolvedValue({ ...ADMIN, user: { name: '管理员' } }),
        findMany: jest.fn().mockResolvedValue([{ id: 'm-1' }, { id: 'm-2' }]) },
      knowledgeBase: { findFirst: jest.fn().mockResolvedValue({ id: 'kb-a' }), update: jest.fn().mockResolvedValue({}) },
      knowledgeMemberGrant: { createMany: jest.fn().mockResolvedValue({ count: 1 }), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      document: { findMany: jest.fn().mockResolvedValue([{ id: 'doc' }, { id: 'already-deleted' }]), updateMany: jest.fn() },
      documentVersion: { updateMany: jest.fn() },
      knowledgeProcessingJob: { updateMany: jest.fn(), createMany: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    prisma = {
      knowledgeBase: { findFirst: jest.fn().mockResolvedValue({ id: 'kb-a' }),
        findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      document: { count: jest.fn().mockResolvedValue(0) },
      knowledgeGrant: { create: jest.fn(), delete: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(async callback => callback(tx)),
    };
    const context = { resolve: jest.fn().mockResolvedValue(ADMIN) } as any;
    service = new KnowledgeService(prisma, new KnowledgeAccessPolicy(prisma, context), { invalidateCache: jest.fn() } as any);
  });

  it('filters deleted KBs and document counts before pagination and presentation', async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([{ id: 'kb-a', name: 'KB', revision: 1, _count: { documents: 1 } }]);
    await service.list('u-admin');
    expect(prisma.knowledgeBase.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ deletedAt: null }),
      select: expect.objectContaining({ _count: { select: { documents: { where: { deletedAt: null } } } } }),
    }));
    expect(prisma.knowledgeBase.count).toHaveBeenCalledWith({ where: expect.objectContaining({ deletedAt: null }) });
    expect(prisma.document.count).toHaveBeenCalledWith({ where: expect.objectContaining({
      deletedAt: null, knowledgeBase: { deletedAt: null },
    }) });
  });

  it('locks and soft-deletes the KB, unpublishes versions and fences jobs before creating durable cleanup', async () => {
    await service.delete('u-admin', 'kb-a');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('knowledge_bases');
    expect(tx.$queryRaw.mock.calls[1][0].join('')).toContain('documents');
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.document.updateMany.mock.invocationCallOrder[0]);
    expect(tx.knowledgeBase.update).toHaveBeenCalledWith({ where: { id: 'kb-a' }, data: { deletedAt: expect.any(Date), revision: { increment: 1 } } });
    expect(tx.document.updateMany).toHaveBeenCalledWith({ where: { knowledgeBaseId: 'kb-a' },
      data: { deletedAt: expect.any(Date), activeVersionId: null, revision: { increment: 1 } } });
    expect(tx.documentVersion.updateMany).toHaveBeenCalledWith({ where: { document: { knowledgeBaseId: 'kb-a' } }, data: { published: false } });
    expect(tx.knowledgeProcessingJob.updateMany).toHaveBeenCalledWith({
      where: { document: { knowledgeBaseId: 'kb-a' }, status: { in: ['PENDING', 'RUNNING'] } },
      data: { status: 'CANCELLED', fence: { increment: 1 }, leaseUntil: null },
    });
    expect(tx.knowledgeProcessingJob.createMany).toHaveBeenCalledWith({ data: [
      { documentId: 'doc', kind: 'CLEANUP' }, { documentId: 'already-deleted', kind: 'CLEANUP' },
    ] });
    expect(tx.knowledgeProcessingJob.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(tx.knowledgeProcessingJob.createMany.mock.invocationCallOrder[0]);
  });

  it('rolls back instead of unlinking files or invalidating after cleanup persistence fails', async () => {
    tx.knowledgeProcessingJob.createMany.mockRejectedValue(new Error('job insert failed'));
    await expect(service.delete('u-admin', 'kb-a')).rejects.toThrow('job insert failed');
    expect((service as any).vector.invalidateCache).not.toHaveBeenCalled();
  });

  it('rechecks admin and KB deletion status after taking the KB lock', async () => {
    tx.enterpriseMember.findFirst.mockResolvedValueOnce({ ...ADMIN, role: 'MEMBER' });
    await expect(service.delete('u-admin', 'kb-a')).rejects.toThrow(ForbiddenException);
    expect(tx.document.updateMany).not.toHaveBeenCalled();
    tx.knowledgeBase.findFirst.mockResolvedValue(null);
    await expect(service.delete('u-admin', 'kb-a')).rejects.toMatchObject({ status: 404 });
    expect(tx.knowledgeProcessingJob.createMany).not.toHaveBeenCalled();
  });

  it('filters grants by undeleted KB for both list and count', async () => {
    prisma.knowledgeMemberGrant = { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) };
    await service.listGrants('u-admin', 'kb-a');
    for (const method of ['findMany', 'count']) expect(prisma.knowledgeMemberGrant[method]).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ knowledgeBase: { deletedAt: null } }) }),
    );
  });

  it('returns pagination envelope with real-member viewer and capabilities', async () => {
    const result = await service.list('u-admin');
    expect(result).toMatchObject({ items: [], page: 1, pageSize: 20, total: 0,
      viewer: { memberId: 'm-admin', enterpriseId: 'ent-a', role: 'ADMIN' },
      capabilities: { canCreateKnowledgeBase: true, canListGrantCandidates: true } });
    expect(result.limits.allowedExtensions).toEqual(['.pdf', '.docx', '.txt', '.md']);
  });

  it('ordinary-member list query counts only explicit grants before pagination', async () => {
    const policy = new KnowledgeAccessPolicy(prisma, { resolve: jest.fn().mockResolvedValue({ ...ADMIN, role: 'MEMBER' }) } as any);
    service = new KnowledgeService(prisma, policy, {} as any);
    const result = await service.list('u-a', { page: 2, pageSize: 10, keyword: 'policy' });
    expect(prisma.knowledgeBase.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 10, take: 10, where: expect.objectContaining({ enterpriseId: 'ent-a', memberGrants: { some: { memberId: 'm-admin' } } }),
    }));
    expect(result.capabilities.canCreateKnowledgeBase).toBe(false);
  });

  it('validates the entire grant batch before any insert', async () => {
    tx.enterpriseMember.findMany.mockResolvedValue([{ id: 'm-1' }]);
    await expect(service.createGrant('u-admin', 'kb-a', { memberIds: ['m-1', 'foreign'] })).rejects.toThrow(BadRequestException);
    expect(tx.knowledgeMemberGrant.createMany).not.toHaveBeenCalled();
    expect(tx.knowledgeBase.update).not.toHaveBeenCalled();
  });

  it('uses a single transaction and unique conflict skipping for repeated grants', async () => {
    tx.knowledgeMemberGrant.createMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(service.createGrant('u-admin', 'kb-a', { memberIds: ['m-1', 'm-2'] })).resolves.toEqual({
      addedMemberIds: ['m-1'], existingMemberIds: ['m-2'],
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.knowledgeMemberGrant.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(prisma.knowledgeGrant.create).not.toHaveBeenCalled();
  });

  it('rechecks membership inside grant transaction and returns 403 before writing', async () => {
    tx.enterpriseMember.findFirst.mockResolvedValue(null);
    await expect(service.createGrant('u-admin', 'kb-a', { memberIds: ['m-1'] })).rejects.toThrow(ForbiddenException);
    expect(tx.knowledgeMemberGrant.createMany).not.toHaveBeenCalled();
  });

  it('rejects admin demotion observed after locking before grant or revoke writes', async () => {
    tx.enterpriseMember.findUnique.mockResolvedValue({ ...ADMIN, role: 'MEMBER' });
    await expect(service.createGrant('u-admin', 'kb-a', { memberIds: ['m-1'] })).rejects.toThrow(ForbiddenException);
    await expect(service.revokeMemberGrant('u-admin', 'kb-a', 'm-1')).rejects.toThrow(ForbiddenException);
    expect(tx.knowledgeMemberGrant.createMany).not.toHaveBeenCalled();
    expect(tx.knowledgeMemberGrant.deleteMany).not.toHaveBeenCalled();
  });

  it('validates target members only after shared row locks and does not revise duplicate-only batches', async () => {
    tx.knowledgeMemberGrant.createMany.mockResolvedValue({ count: 0 });
    await service.createGrant('u-admin', 'kb-a', { memberIds: ['m-1', 'm-2'] });
    const lockOrder = tx.$queryRaw.mock.invocationCallOrder[1];
    expect(lockOrder).toBeLessThan(tx.enterpriseMember.findMany.mock.invocationCallOrder[0]);
    expect(tx.knowledgeBase.update).not.toHaveBeenCalled();
  });

  it('does not allow legacy grant endpoints to read or mutate old audit rows', async () => {
    await expect(service.listGrantsBySubscription('u-admin', 'sub-a')).rejects.toThrow(GoneException);
    await expect(service.deleteGrant('u-admin', 'old-g')).rejects.toThrow(GoneException);
    expect(prisma.knowledgeGrant.findMany).not.toHaveBeenCalled();
    expect(prisma.knowledgeGrant.delete).not.toHaveBeenCalled();
  });
});
