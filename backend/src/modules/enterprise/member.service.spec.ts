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
  let tx: any;
  let ctxSvc: any;
  let svc: MemberService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
      department: { findUnique: jest.fn() },
      enterpriseMember: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn((a: any) => Promise.resolve({ id: 'mem-new', ...a.data })),
        update: jest.fn((a: any) => Promise.resolve({ id: a.where.id, ...a.data })),
        delete: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(2),
      },
    };
    // 事务内的 client 用同一个 tx 对象，便于断言事务里发生了什么
    tx = {
      user: { create: jest.fn().mockResolvedValue({ id: 'user-new' }) },
      enterpriseMember: {
        create: jest.fn((a: any) =>
          Promise.resolve({ id: 'mem-new', ...a.data }),
        ),
        delete: jest.fn().mockResolvedValue({}),
      },
      accessRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      employeeGrant: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    prisma.$transaction = jest.fn((fn: any) => fn(tx));
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
      ).rejects.toThrow(ConflictException);
    });

    it('已归属其他企业时给出可操作指引（先退出原企业）', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-exist',
        memberships: [{ enterpriseId: 'ent-globex' }],
      });

      // 只说"不支持"是死路，管理员不知道下一步该做什么
      await expect(
        svc.create('u1', {
          email: 'other@globex.local',
          password: 'Passw0rd!',
          role: 'MEMBER',
        } as never),
      ).rejects.toThrow(/退出当前企业/);
    });

    describe('已注册但无企业归属', () => {
      beforeEach(() => {
        prisma.user.findUnique.mockResolvedValue({
          id: 'u-orphan',
          memberships: [],
        });
      });

      it('允许直接加入 —— 这是离职后重新入职的必经路径', async () => {
        const res: any = await svc.create('u1', {
          email: 'orphan@acme.local',
          password: 'Passw0rd!',
          role: 'MEMBER',
          position: '后端',
        } as never);

        expect(res.id).toBe('mem-new');
        const data = prisma.enterpriseMember.create.mock.calls[0][0].data;
        expect(data.userId).toBe('u-orphan');
        expect(data.enterpriseId).toBe('ent-acme');
      });

      it('❗绝不覆盖已有账号的密码 —— 否则等于账号劫持', async () => {
        await svc.create('u1', {
          email: 'orphan@acme.local',
          password: 'AttackerSetsThis!',
          role: 'MEMBER',
        } as never);

        // 不得新建 User，也不得 update 其密码
        expect(prisma.user.create).not.toHaveBeenCalled();
        expect(prisma.user.update).not.toHaveBeenCalled();
        const data = prisma.enterpriseMember.create.mock.calls[0][0].data;
        expect(JSON.stringify(data)).not.toContain('AttackerSetsThis');
      });

      it('返回 reusedExistingAccount 标记，避免管理员转告无效密码', async () => {
        const res: any = await svc.create('u1', {
          email: 'orphan@acme.local',
          password: 'Passw0rd!',
          role: 'MEMBER',
        } as never);
        expect(res.reusedExistingAccount).toBe(true);
      });
    });

    it('邮箱大小写不敏感 —— 防止绕过"已是成员"检查建出重复成员', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-exist',
        memberships: [{ enterpriseId: 'ent-acme' }],
      });

      await expect(
        svc.create('u1', {
          email: '  Dup@ACME.local ',
          password: 'Passw0rd!',
          role: 'MEMBER',
        } as never),
      ).rejects.toThrow(/已是本企业成员/);
      expect(prisma.user.findUnique.mock.calls[0][0].where.email).toBe(
        'dup@acme.local',
      );
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
    /** 一名普通成员，无主管部门 */
    const staff = {
      id: 'mem-staff',
      enterpriseId: 'ent-acme',
      role: 'MEMBER',
      user: { id: 'u-staff', email: 'staff@acme.local', name: '张三' },
      ledDepartments: [],
    };

    it('❗不能移除自己', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue({
        ...staff,
        id: 'mem-boss',
        role: 'ENTERPRISE_ADMIN',
      });

      await expect(svc.remove('u1', 'mem-boss')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('❗不能移除最后一名管理员', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue({
        ...staff,
        id: 'mem-other',
        role: 'ENTERPRISE_ADMIN',
      });
      prisma.enterpriseMember.count.mockResolvedValue(1);

      await expect(svc.remove('u1', 'mem-other')).rejects.toThrow(
        ConflictException,
      );
    });

    it('只删成员关系，保留 User 账号', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue(staff);

      await svc.remove('u1', 'mem-staff');
      expect(tx.enterpriseMember.delete).toHaveBeenCalledWith({
        where: { id: 'mem-staff' },
      });
      // User 不删：可能还属于别家企业，且离职后要能凭原账号接受新邀请
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('❗别家企业的成员不可移除', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue({
        ...staff,
        id: 'mem-globex',
        enterpriseId: 'ent-globex',
      });

      await expect(svc.remove('u1', 'mem-globex')).rejects.toThrow(
        NotFoundException,
      );
      expect(tx.enterpriseMember.delete).not.toHaveBeenCalled();
    });

    it('回收本人名下的席位授权，并报出回收数量', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue(staff);
      tx.employeeGrant.deleteMany.mockResolvedValue({ count: 3 });

      const res = await svc.remove('u1', 'mem-staff');

      // 只按 memberId 删 —— 授权给部门的记录不能受牵连
      expect(tx.employeeGrant.deleteMany).toHaveBeenCalledWith({
        where: { memberId: 'mem-staff' },
      });
      expect(res.reclaimedGrants).toBe(3);
    });

    it('❗不回收授权给部门的席位（那属于部门，不随离职人员消失）', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue(staff);

      await svc.remove('u1', 'mem-staff');

      const where = tx.employeeGrant.deleteMany.mock.calls[0][0].where;
      expect(where).toEqual({ memberId: 'mem-staff' });
      expect(where.departmentId).toBeUndefined();
    });

    it('❗审批历史保留，申请人身份转为快照 —— 沉淀不能随人消失', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue(staff);

      await svc.remove('u1', 'mem-staff');

      expect(tx.accessRequest.updateMany).toHaveBeenCalledWith({
        where: { requesterId: 'mem-staff' },
        data: { requesterEmail: 'staff@acme.local', requesterName: '张三' },
      });
    });

    it('❗快照必须写在删除之前，否则 requesterId 已被置空、再也定位不到', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue(staff);
      const order: string[] = [];
      tx.accessRequest.updateMany.mockImplementation(() => {
        order.push('snapshot');
        return Promise.resolve({ count: 0 });
      });
      tx.enterpriseMember.delete.mockImplementation(() => {
        order.push('delete');
        return Promise.resolve({});
      });

      await svc.remove('u1', 'mem-staff');

      expect(order[0]).toBe('snapshot');
      expect(order[order.length - 1]).toBe('delete');
    });

    it('待审批的申请置为 CANCELED —— 非成员的申请无从批准', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue(staff);
      tx.accessRequest.updateMany
        .mockResolvedValueOnce({ count: 5 }) // 快照
        .mockResolvedValueOnce({ count: 2 }); // 取消 PENDING

      const res = await svc.remove('u1', 'mem-staff');

      expect(tx.accessRequest.updateMany).toHaveBeenCalledWith({
        where: { requesterId: 'mem-staff', status: 'PENDING' },
        data: { status: 'CANCELED' },
      });
      expect(res.canceledRequests).toBe(2);
    });

    it('主管的部门在响应中报出，供管理员重新指派', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue({
        ...staff,
        role: 'DEPT_MANAGER',
        ledDepartments: [{ id: 'dept-1', name: '技术部' }],
      });

      const res = await svc.remove('u1', 'mem-staff');

      // 部门无主是需要补动作的状态，静默处理会留下没人负责的部门
      expect(res.vacatedDepartments).toEqual([
        { id: 'dept-1', name: '技术部' },
      ]);
    });

    it('全过程在同一事务内 —— 半途失败不能留下"授权已收、人还在"', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue(staff);

      await svc.remove('u1', 'mem-staff');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // 事务外不得有删除动作
      expect(prisma.enterpriseMember.delete).not.toHaveBeenCalled();
    });
  });

  describe('leaveEnterprise（主动离职）', () => {
    const self = {
      id: 'mem-boss',
      enterpriseId: 'ent-acme',
      role: 'MEMBER',
      user: { id: 'u1', email: 'me@acme.local', name: '我' },
      enterprise: { id: 'ent-acme', name: '示例科技' },
      ledDepartments: [],
    };

    beforeEach(() => {
      ctxSvc.resolveOrNull = jest.fn().mockResolvedValue(ACME);
    });

    it('普通成员可自行离职，处置与管理员移除一致', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue(self);
      tx.employeeGrant.deleteMany.mockResolvedValue({ count: 2 });

      const res = await svc.leaveEnterprise('u1');

      expect(tx.employeeGrant.deleteMany).toHaveBeenCalledWith({
        where: { memberId: 'mem-boss' },
      });
      expect(tx.enterpriseMember.delete).toHaveBeenCalledWith({
        where: { id: 'mem-boss' },
      });
      expect(res.reclaimedGrants).toBe(2);
      // 前端要展示"你已离开 X 公司"
      expect(res.enterprise).toEqual({ id: 'ent-acme', name: '示例科技' });
    });

    it('❗审批历史照样保留快照 —— 主动离职不等于可以抹掉沉淀', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue(self);

      await svc.leaveEnterprise('u1');

      expect(tx.accessRequest.updateMany).toHaveBeenCalledWith({
        where: { requesterId: 'mem-boss' },
        data: { requesterEmail: 'me@acme.local', requesterName: '我' },
      });
    });

    it('❗唯一管理员不可离职 —— 否则企业永久失去管理能力', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue({
        ...self,
        role: 'ENTERPRISE_ADMIN',
      });
      prisma.enterpriseMember.count.mockResolvedValue(1);

      await expect(svc.leaveEnterprise('u1')).rejects.toThrow(
        ConflictException,
      );
      await expect(svc.leaveEnterprise('u1')).rejects.toThrow(
        /唯一的管理员/,
      );
      expect(tx.enterpriseMember.delete).not.toHaveBeenCalled();
    });

    it('还有其他管理员时，管理员本人可以离职', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue({
        ...self,
        role: 'ENTERPRISE_ADMIN',
      });
      prisma.enterpriseMember.count.mockResolvedValue(2);

      await expect(svc.leaveEnterprise('u1')).resolves.toMatchObject({
        removed: true,
      });
    });

    it('❗无企业归属时报 400，不能报成 403「无权操作」', async () => {
      // resolve() 对无归属用户抛 403，会把"你本来就没有企业"
      // 说成"你无权操作"，用户无从下手
      ctxSvc.resolveOrNull = jest.fn().mockResolvedValue(null);

      await expect(svc.leaveEnterprise('u-orphan')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('❗不需要管理员权限 —— 否则普通成员永远走不掉', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue(self);

      await svc.leaveEnterprise('u1');

      expect(ctxSvc.assertEnterpriseAdmin).not.toHaveBeenCalled();
    });

    it('主管的部门同样报出，供原企业重新指派', async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue({
        ...self,
        role: 'DEPT_MANAGER',
        ledDepartments: [{ id: 'dept-9', name: '市场部' }],
      });

      const res = await svc.leaveEnterprise('u1');

      expect(res.vacatedDepartments).toEqual([
        { id: 'dept-9', name: '市场部' },
      ]);
    });
  });
});
