/**
 * 企业成员服务测试。
 *
 * 重点覆盖两类**会把企业锁死**的操作：
 *   ① 移除/降级最后一名管理员 → 企业永久失去管理能力
 *      （没人能加成员、建部门、订阅，也没人能把自己提回管理员）
 *   ② 管理员降低自己的角色 → 一步把自己锁在门外
 * 以及多租户越权：跨企业读写成员、把成员分配到别家企业的部门。
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MemberService } from './member.service';

const ACME = {
  enterpriseId: 'ent-acme',
  memberId: 'mem-boss',
  role: 'ENTERPRISE_ADMIN' as const,
  departmentId: null,
};

describe('MemberService', () => {
  let prisma: any;
  let ctxSvc: any;
  let svc: MemberService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      department: { findUnique: jest.fn() },
      enterpriseMember: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn((a: any) => Promise.resolve({ id: 'mem-new', ...a.data })),
        update: jest.fn((a: any) => Promise.resolve({ id: a.where.id, ...a.data })),
        delete: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(2),
      },
      $transaction: jest.fn((fn: any) =>
        fn({
          user: { create: jest.fn().mockResolvedValue({ id: 'user-new' }) },
          enterpriseMember: {
            create: jest.fn((a: any) =>
              Promise.resolve({ id: 'mem-new', ...a.data }),
            ),
          },
        }),
      ),
    };
    ctxSvc = {
      resolve: jest.fn().mockResolvedValue(ACME),
      assertEnterpriseAdmin: jest.fn(),
    };
    svc = new MemberService(prisma, ctxSvc);
  });

  describe('list', () => {
    it('必须带 enterpriseId 过滤', async () => {
      await svc.list('u1');
      expect(prisma.enterpriseMember.findMany.mock.calls[0][0].where.enterpriseId).toBe(
        'ent-acme',
      );
    });

    it('可按部门过滤', async () => {
      await svc.list('u1', 'dept-tech');
      const where = prisma.enterpriseMember.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ enterpriseId: 'ent-acme', departmentId: 'dept-tech' });
    });
  });

  describe('create', () => {
    it('新邮箱：在事务内同时建 User 与 Member', async () => {
      const r = await svc.create('u1', {
        email: 'new@acme.local',
        password: 'Passw0rd!',
        role: 'MEMBER',
      } as never);

      // 事务是必需的：只建 User 会留下"有账号但不属于任何企业"的死账号
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(r.id).toBe('mem-new');
    });

    it('enterpriseId 取自上下文，忽略入参', async () => {
      await svc.create('u1', {
        email: 'new@acme.local',
        password: 'Passw0rd!',
        role: 'MEMBER',
        enterpriseId: 'ent-globex',
      } as never);

      // 通过事务回调内的 create 参数断言
      const txFn = prisma.$transaction.mock.calls[0][0];
      const captured: any = {};
      await txFn({
        user: { create: jest.fn().mockResolvedValue({ id: 'u-new' }) },
        enterpriseMember: {
          create: (a: any) => {
            Object.assign(captured, a.data);
            return Promise.resolve({ id: 'm' });
          },
        },
      });
      expect(captured.enterpriseId).toBe('ent-acme');
    });

    it('邮箱已是本企业成员 → 409', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-exist',
        memberships: [{ enterpriseId: 'ent-acme' }],
      });

      await expect(
        svc.create('u1', {
          email: 'dup@acme.local',
          password: 'Passw0rd!',
          role: 'MEMBER',
        } as never),
      ).rejects.toThrow(/已是本企业成员/);
    });

    it('邮箱已归属其他企业 → 409（MVP 单企业前提）', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-exist',
        memberships: [{ enterpriseId: 'ent-globex' }],
      });

      // 若允许加入，该用户登录后只看得到最早那家企业，
      // 本企业里会出现他本人访问不到的"隐形成员"
      await expect(
        svc.create('u1', {
          email: 'other@globex.local',
          password: 'Passw0rd!',
          role: 'MEMBER',
        } as never),
      ).rejects.toThrow(/不支持跨企业加入/);
    });

    it('❗指定别家企业的部门时拒绝', async () => {
      prisma.department.findUnique.mockResolvedValue({
        id: 'dept-globex',
        enterpriseId: 'ent-globex',
      });

      await expect(
        svc.create('u1', {
          email: 'x@acme.local',
          password: 'Passw0rd!',
          role: 'MEMBER',
          departmentId: 'dept-globex',
        } as never),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('❗管理员不能降低自己的角色（防自锁）', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue({
        id: 'mem-boss', // 与 ctx.memberId 相同
        enterpriseId: 'ent-acme',
        role: 'ENTERPRISE_ADMIN',
      });

      await expect(
        svc.update('u1', 'mem-boss', { role: 'MEMBER' } as never),
      ).rejects.toThrow(/不能降低自己的角色/);
    });

    it('❗降级最后一名管理员时拒绝', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue({
        id: 'mem-other',
        enterpriseId: 'ent-acme',
        role: 'ENTERPRISE_ADMIN',
      });
      prisma.enterpriseMember.count.mockResolvedValue(1); // 仅剩一名

      await expect(
        svc.update('u1', 'mem-other', { role: 'MEMBER' } as never),
      ).rejects.toThrow(/至少需要保留一名管理员/);
    });

    it('还有其他管理员时可以降级', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue({
        id: 'mem-other',
        enterpriseId: 'ent-acme',
        role: 'ENTERPRISE_ADMIN',
      });
      prisma.enterpriseMember.count.mockResolvedValue(2);

      await expect(
        svc.update('u1', 'mem-other', { role: 'MEMBER' } as never),
      ).resolves.toBeDefined();
    });

    it('把普通成员提为管理员不触发最后管理员检查', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue({
        id: 'mem-staff',
        enterpriseId: 'ent-acme',
        role: 'MEMBER',
      });

      await expect(
        svc.update('u1', 'mem-staff', { role: 'ENTERPRISE_ADMIN' } as never),
      ).resolves.toBeDefined();
      expect(prisma.enterpriseMember.count).not.toHaveBeenCalled();
    });

    it('❗别家企业的成员不可更新', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue({
        id: 'mem-globex',
        enterpriseId: 'ent-globex',
        role: 'MEMBER',
      });

      await expect(
        svc.update('u1', 'mem-globex', { role: 'DEPT_MANAGER' } as never),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('❗不能移除自己', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue({
        id: 'mem-boss',
        enterpriseId: 'ent-acme',
        role: 'ENTERPRISE_ADMIN',
      });

      await expect(svc.remove('u1', 'mem-boss')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('❗不能移除最后一名管理员', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue({
        id: 'mem-other',
        enterpriseId: 'ent-acme',
        role: 'ENTERPRISE_ADMIN',
      });
      prisma.enterpriseMember.count.mockResolvedValue(1);

      await expect(svc.remove('u1', 'mem-other')).rejects.toThrow(
        ConflictException,
      );
    });

    it('只删成员关系，保留 User 账号', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue({
        id: 'mem-staff',
        enterpriseId: 'ent-acme',
        role: 'MEMBER',
      });

      await svc.remove('u1', 'mem-staff');
      expect(prisma.enterpriseMember.delete).toHaveBeenCalledWith({
        where: { id: 'mem-staff' },
      });
      // User 不删：可能还属于别家企业，且历史记录引用了他
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('❗别家企业的成员不可移除', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue({
        id: 'mem-globex',
        enterpriseId: 'ent-globex',
        role: 'MEMBER',
      });

      await expect(svc.remove('u1', 'mem-globex')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.enterpriseMember.delete).not.toHaveBeenCalled();
    });
  });
});
