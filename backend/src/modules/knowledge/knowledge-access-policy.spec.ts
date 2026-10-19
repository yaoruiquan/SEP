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

  describe('readBoundary transaction integration', () => {
    let tx: any;
    let order: string[];
    const currentMember = { id: 'm-a', userId: 'u-a', enterpriseId: 'ent-a', role: 'MEMBER', departmentId: 'dept-current' };

    beforeEach(() => {
      order = [];
      tx = {
        $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
          const sql = strings.join('?').replace(/\s+/g, ' ');
          if (sql.includes('FROM enterprise_members')) order.push('member-lock');
          else if (sql.includes('FROM knowledge_member_grants')) order.push('grants-lock');
          else if (sql.includes('FROM knowledge_bases')) order.push('kb-lock');
          else if (sql.includes('FROM documents')) order.push('document-lock');
          else throw new Error(`Unexpected lock SQL: ${sql}`);
          expect(sql).toContain('FOR SHARE');
          return [];
        }),
        enterpriseMember: { findUnique: jest.fn(async () => { order.push('member-read'); return currentMember; }) },
      };
      prisma.$transaction = jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(tx));
    });

    it('locks member -> grants -> KB -> document before reading, in deterministic ID order', async () => {
      context.resolve.mockResolvedValue({ ...member, role: 'ENTERPRISE_ADMIN' });
      const read = jest.fn(async (transaction, viewer) => {
        order.push('read');
        expect(transaction).toBe(tx);
        expect(viewer).toEqual({ enterpriseId: 'ent-a', memberId: 'm-a', role: 'MEMBER', departmentId: 'dept-current' });
        expect(policy.readableWhere(viewer)).toHaveProperty('memberGrants.some.memberId', 'm-a');
        return { authorized: true };
      });
      const baseIds = ['kb-z', 'kb-a'];
      const chunkIds = ['chunk-z', 'chunk-a', 'chunk-z'];
      await expect(policy.readBoundary('u-a', baseIds, chunkIds, read)).resolves.toEqual({ authorized: true });
      expect(order).toEqual(['member-lock', 'member-read', 'grants-lock', 'kb-lock', 'document-lock', 'read']);
      expect(context.resolve).toHaveBeenCalledWith('u-a');
      expect(tx.enterpriseMember.findUnique).toHaveBeenCalledWith({ where: { id: 'm-a' } });
      expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['m-a']);
      const grantLock = tx.$queryRaw.mock.calls[1];
      expect(grantLock[1]).toBe('m-a');
      expect(grantLock[2].values).toEqual(['kb-a', 'kb-z']);
      expect(tx.$queryRaw.mock.calls[2][1].values).toEqual(['kb-a', 'kb-z']);
      expect(tx.$queryRaw.mock.calls[3][1].values).toEqual(['chunk-a', 'chunk-z']);
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 10_000 });
      expect(baseIds).toEqual(['kb-z', 'kb-a']);
      expect(chunkIds).toEqual(['chunk-z', 'chunk-a', 'chunk-z']);
      expect(read).toHaveBeenCalledTimes(1);
    });

    it.each([
      null,
      { ...currentMember, userId: 'different-user' },
      { ...currentMember, enterpriseId: 'different-enterprise' },
    ])('returns hidden 404 without reading data if locked membership is invalid: %j', async row => {
      tx.enterpriseMember.findUnique.mockImplementation(async () => { order.push('member-read'); return row; });
      const read = jest.fn();
      const error = await policy.readBoundary('u-a', ['kb-a'], ['chunk-a'], read).catch(error => error);
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({ code: 'KNOWLEDGE_RESOURCE_NOT_FOUND' });
      expect(order).toEqual(['member-lock', 'member-read']);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(read).not.toHaveBeenCalled();
    });

    it('rereads a newly promoted member role instead of using the initial context', async () => {
      tx.enterpriseMember.findUnique.mockResolvedValue({ ...currentMember, role: 'ENTERPRISE_ADMIN' });
      const read = jest.fn(async (_transaction, viewer) => policy.readableWhere(viewer));
      await expect(policy.readBoundary('u-a', [], [], read)).resolves.toEqual({ enterpriseId: 'ent-a', deletedAt: null });
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledWith(tx, expect.objectContaining({ role: 'ENTERPRISE_ADMIN' }));
    });
  });
});
