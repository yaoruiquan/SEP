import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { KnowledgeAccessPolicy } from './knowledge-access-policy';

describe('KnowledgeAccessPolicy member boundary', () => {
  const member = { enterpriseId: 'ent-a', memberId: 'm-a', role: 'MEMBER', departmentId: null };
  let prisma: any;
  let context: any;
  let policy: KnowledgeAccessPolicy;

  beforeEach(() => {
    prisma = { knowledgeBase: { findFirst: jest.fn() } };
    context = { resolve: jest.fn().mockResolvedValue(member) };
    policy = new KnowledgeAccessPolicy(prisma, context);
  });

  it('filters ordinary members by explicit member grant, never legacy grants', async () => {
    const viewer = await policy.resolve('u-a');
    expect(policy.readableWhere(viewer)).toEqual({
      enterpriseId: 'ent-a', deletedAt: null, memberGrants: { some: { memberId: 'm-a' } },
    });
  });

  it('allows only enterprise administrators implicit full-enterprise access', () => {
    expect(policy.readableWhere({ ...member, role: 'ENTERPRISE_ADMIN' } as any))
      .toEqual({ enterpriseId: 'ent-a', deletedAt: null });
    expect(policy.readableWhere({ ...member, role: 'DEPT_MANAGER' } as any))
      .toHaveProperty('memberGrants');
  });

  it('hides both cross-enterprise and ungranted bases as 404', async () => {
    prisma.knowledgeBase.findFirst.mockResolvedValue(null);
    await expect(policy.assertRead('u-a', 'kb-secret')).rejects.toThrow(NotFoundException);
    await expect(policy.assertManage('u-a', 'kb-secret')).rejects.toThrow(NotFoundException);
  });

  it('denies mutations to a member who can read', async () => {
    prisma.knowledgeBase.findFirst.mockResolvedValue({ id: 'kb-a' });
    await expect(policy.assertManage('u-a', 'kb-a')).rejects.toThrow(ForbiddenException);
  });

  it('requires an actual enterprise membership', async () => {
    context.resolve.mockRejectedValue(new ForbiddenException());
    await expect(policy.resolve('platform-admin')).rejects.toThrow(ForbiddenException);
  });
});
