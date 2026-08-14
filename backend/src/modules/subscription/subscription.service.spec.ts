/**
 * 订阅服务的多租户隔离与角色权限测试。
 *
 * 重点覆盖**越权路径**：攻击者持有合法 token，直接构造别家企业的资源 ID
 * 来调接口。这类漏洞的特点是**功能测试全绿也发现不了** ——
 * 正常使用路径永远不会去构造别人的 ID。
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';

const ACME = {
  enterpriseId: 'ent-acme',
  memberId: 'mem-acme-boss',
  role: 'ENTERPRISE_ADMIN' as const,
  departmentId: null,
};

const ACME_STAFF = { ...ACME, memberId: 'mem-acme-staff', role: 'MEMBER' as const };

describe('SubscriptionService', () => {
  let prisma: any;
  let ctxSvc: any;
  let walletSvc: any;
  let svc: SubscriptionService;

  beforeEach(() => {
    prisma = {
      digitalEmployee: { findUnique: jest.fn() },
      subscription: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn((a: any) => Promise.resolve({ id: 'sub-new', ...a.data })),
        update: jest.fn((a: any) => Promise.resolve({ id: a.where.id, ...a.data })),
      },
    };
    ctxSvc = {
      resolve: jest.fn().mockResolvedValue(ACME),
      assertEnterpriseAdmin: jest.fn((c: any) => {
        if (c.role !== 'ENTERPRISE_ADMIN') throw new ForbiddenException();
      }),
      assertCanApprove: jest.fn(),
    };
    walletSvc = {
      consume: jest.fn(),
      refund: jest.fn(),
    } as any;
    svc = new SubscriptionService(prisma, ctxSvc, walletSvc);
  });

  describe('多租户隔离（越权路径）', () => {
    it('❗访问别家企业的订阅 ID 必须失败', async () => {
      // 甲企业用户持合法 token，但 id 指向乙企业的订阅
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-globex',
        enterpriseId: 'ent-globex', // ← 别家
        employeeId: 'emp-1',
      });

      await expect(svc.findOne('sub-globex', 'user-acme-boss')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('越权时返回 404 而非 403，不泄漏资源是否存在', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-globex',
        enterpriseId: 'ent-globex',
      });

      // 403 会告诉攻击者"这个 ID 真实存在，只是你没权限"，
      // 404 则与"不存在"不可区分，不给探测留下信息差
      await expect(svc.findOne('sub-globex', 'u1')).rejects.toThrow(NotFoundException);
      await expect(svc.findOne('sub-globex', 'u1')).rejects.not.toThrow(
        ForbiddenException,
      );
    });

    it('本企业的订阅可正常访问', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-acme',
        enterpriseId: 'ent-acme',
        employeeId: 'emp-1',
      });

      const sub = await svc.findOne('sub-acme', 'user-acme-boss');
      expect(sub.id).toBe('sub-acme');
    });

    it('列表查询必须带 enterpriseId 过滤，不能返回全表', async () => {
      prisma.subscription.findMany.mockResolvedValue([]);

      await svc.findAll('user-acme-boss');

      const where = prisma.subscription.findMany.mock.calls[0][0].where;
      // 少了这个条件就是跨企业数据泄露
      expect(where.enterpriseId).toBe('ent-acme');
    });

    it('列表不按 status 过滤 —— 管理台要能看到暂停的关系才能恢复它', async () => {
      prisma.subscription.findMany.mockResolvedValue([]);

      await svc.findAll('user-acme-boss');

      const where = prisma.subscription.findMany.mock.calls[0][0].where;
      expect(where.status).toBeUndefined();
    });

    it('订阅创建时 enterpriseId 取自服务端上下文,不取自入参', async () => {
      prisma.digitalEmployee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'APPROVED',
        name: 'Test Employee',
        version: '1.0.0',
        annualPriceCNY: { toNumber: () => 5000 },
      });
      prisma.subscription.findUnique.mockResolvedValue(null);
      walletSvc.consume.mockResolvedValue({ id: 'tx-1' });

      // 恶意入参试图指定别家企业
      await svc.subscribe('user-acme-boss', {
        employeeId: 'emp-1',
        enterpriseId: 'ent-globex',
      } as never);

      const data = prisma.subscription.create.mock.calls[0][0].data;
      expect(data.enterpriseId).toBe('ent-acme'); // 上下文值，非入参值
    });

    it('订阅唯一性检查按 (企业, 模板) 而非 (用户, 模板)', async () => {
      prisma.digitalEmployee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'APPROVED',
        name: 'Test Employee',
        version: '1.0.0',
        annualPriceCNY: { toNumber: () => 5000 },
      });
      prisma.subscription.findUnique.mockResolvedValue(null);
      walletSvc.consume.mockResolvedValue({ id: 'tx-1' });

      await svc.subscribe('user-acme-boss', { employeeId: 'emp-1' } as never);

      const where = prisma.subscription.findUnique.mock.calls[0][0].where;
      expect(where.enterpriseId_employeeId).toEqual({
        enterpriseId: 'ent-acme',
        employeeId: 'emp-1',
      });
    });
  });

  describe('角色权限', () => {
    it('❗普通成员不能订阅（订阅要花企业的钱）', async () => {
      ctxSvc.resolve.mockResolvedValue(ACME_STAFF);

      await expect(
        svc.subscribe('user-acme-staff', { employeeId: 'emp-1' } as never),
      ).rejects.toThrow(ForbiddenException);

      // 必须在查模板之前就拒绝，避免无谓的 DB 往返
      expect(prisma.digitalEmployee.findUnique).not.toHaveBeenCalled();
    });

    it('企业管理员可以订阅', async () => {
      prisma.digitalEmployee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'APPROVED',
        name: 'Test Employee',
        version: '1.0.0',
        annualPriceCNY: { toNumber: () => 5000 },
      });
      prisma.subscription.findUnique.mockResolvedValue(null);
      walletSvc.consume.mockResolvedValue({ id: 'tx-1' });

      await expect(
        svc.subscribe('user-acme-boss', { employeeId: 'emp-1' } as never),
      ).resolves.toBeDefined();
    });
  });

  describe('业务规则', () => {
    it('未上架模板不可订阅', async () => {
      prisma.digitalEmployee.findUnique.mockResolvedValue({
        id: 'emp-draft',
        status: 'DRAFT',
      });

      await expect(
        svc.subscribe('user-acme-boss', { employeeId: 'emp-draft' } as never),
      ).rejects.toThrow(/unapproved/i);
    });

    it('模板不存在时报 404', async () => {
      prisma.digitalEmployee.findUnique.mockResolvedValue(null);

      await expect(
        svc.subscribe('user-acme-boss', { employeeId: 'nope' } as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('assertActiveSubscription 按企业维度校验', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: 'ACTIVE',
      });

      await svc.assertActiveSubscription('user-acme-boss', 'emp-1');

      const where = prisma.subscription.findUnique.mock.calls[0][0].where;
      expect(where.enterpriseId_employeeId.enterpriseId).toBe('ent-acme');
    });

    it('无有效订阅时拒绝', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(
        svc.assertActiveSubscription('user-acme-boss', 'emp-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('复活已终止的雇佣关系时不刷新 templateVersion —— 停用期间的模板变更要照样提示', async () => {
      prisma.digitalEmployee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'APPROVED',
        name: 'Test Employee',
        version: '3.0.0',
        annualPriceCNY: { toNumber: () => 5000 },
      });
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-old',
        enterpriseId: 'ent-acme',
        status: 'EXPIRED',
        templateVersion: '1.0.0',
      });
      walletSvc.consume.mockResolvedValue({ id: 'tx-1' });

      await svc.subscribe('user-acme-boss', { employeeId: 'emp-1' } as never);

      const data = prisma.subscription.update.mock.calls[0][0].data;
      expect(data.status).toBe('ACTIVE');
      // 写进去就等于把「员工已变过」这件事静默吞掉
      expect(data).not.toHaveProperty('templateVersion');
    });
  });

  // ── 收敛后从实例层移回订阅的行为 ────────────────────────────────────────

  describe('findAll 的升级提示', () => {
    const row = (templateVersion: string, latest: string, name: string | null = null) => ({
      id: 'sub-1',
      enterpriseId: 'ent-acme',
      employeeId: 'emp-1',
      status: 'ACTIVE',
      templateVersion,
      name,
      employee: { id: 'emp-1', name: '客服小美', avatar: null, version: latest },
    });

    it('锁定版本与模板当前版本不同时提示可升级', async () => {
      prisma.subscription.findMany.mockResolvedValue([row('1.0.0', '1.1.0')]);

      const [r] = await svc.findAll('user-acme-boss');
      expect(r.upgradeAvailable).toBe(true);
      expect(r.latestVersion).toBe('1.1.0');
    });

    it('版本相同时不提示', async () => {
      prisma.subscription.findMany.mockResolvedValue([row('1.1.0', '1.1.0')]);

      const [r] = await svc.findAll('user-acme-boss');
      expect(r.upgradeAvailable).toBe(false);
    });

    it('降级发布也提示 —— 只比相等，不做语义化版本比较', async () => {
      prisma.subscription.findMany.mockResolvedValue([row('2.0.0', '1.0.0')]);

      const [r] = await svc.findAll('user-acme-boss');
      expect(r.upgradeAvailable).toBe(true);
    });

    it('未自定义称呼时回落到模板名', async () => {
      prisma.subscription.findMany.mockResolvedValue([row('1.0.0', '1.0.0', null)]);

      const [r] = await svc.findAll('user-acme-boss');
      expect(r.name).toBe('客服小美');
    });

    it('有自定义称呼时优先展示它', async () => {
      prisma.subscription.findMany.mockResolvedValue([
        row('1.0.0', '1.0.0', '小美'),
      ]);

      const [r] = await svc.findAll('user-acme-boss');
      expect(r.name).toBe('小美');
    });
  });

  describe('changeStatus', () => {
    const active = {
      id: 'sub-1',
      enterpriseId: 'ent-acme',
      employeeId: 'emp-1',
      status: 'ACTIVE',
      templateVersion: '1.0.0',
    };

    it('ACTIVE → PAUSED 允许', async () => {
      prisma.subscription.findUnique.mockResolvedValue(active);

      const r = await svc.changeStatus('sub-1', 'u1', 'PAUSED');
      expect(r.changed).toBe(true);
    });

    it('❗EXPIRED 是终态，不能转回 ACTIVE', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        ...active,
        status: 'EXPIRED',
      });

      await expect(svc.changeStatus('sub-1', 'u1', 'ACTIVE')).rejects.toThrow(
        /不能从 EXPIRED 变为 ACTIVE/,
      );
    });

    it('状态未变化时不写库', async () => {
      prisma.subscription.findUnique.mockResolvedValue(active);

      const r = await svc.changeStatus('sub-1', 'u1', 'ACTIVE');
      expect(r.changed).toBe(false);
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('终止时落下 endDate，恢复时清空 —— 否则列表会显示一个过去的到期日', async () => {
      prisma.subscription.findUnique.mockResolvedValue(active);
      await svc.changeStatus('sub-1', 'u1', 'EXPIRED');
      expect(prisma.subscription.update.mock.calls[0][0].data.endDate).toEqual(
        expect.any(Date),
      );

      prisma.subscription.update.mockClear();
      prisma.subscription.findUnique.mockResolvedValue({
        ...active,
        status: 'PAUSED',
      });
      await svc.changeStatus('sub-1', 'u1', 'ACTIVE');
      expect(prisma.subscription.update.mock.calls[0][0].data.endDate).toBeNull();
    });

    it('❗普通成员不能改状态', async () => {
      ctxSvc.resolve.mockResolvedValue(ACME_STAFF);

      await expect(svc.changeStatus('sub-1', 'u1', 'PAUSED')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('❗不能改别家企业的雇佣关系状态', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        ...active,
        enterpriseId: 'ent-globex',
      });

      await expect(svc.changeStatus('sub-1', 'u1', 'PAUSED')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('upgrade', () => {
    const sub = {
      id: 'sub-1',
      enterpriseId: 'ent-acme',
      employeeId: 'emp-1',
      status: 'ACTIVE',
      templateVersion: '1.0.0',
    };

    it('升级到模板最新版并回报变更前后版本', async () => {
      prisma.subscription.findUnique.mockResolvedValue(sub);
      prisma.digitalEmployee.findUnique.mockResolvedValue({ version: '2.0.0' });

      const r = await svc.upgrade('sub-1', 'u1');
      expect(r.from).toBe('1.0.0');
      expect(r.to).toBe('2.0.0');
      // 配置不自动迁移，前端要提示重新检查
      expect(r.configReviewRequired).toBe(true);
    });

    it('❗升级不迁移 config', async () => {
      prisma.subscription.findUnique.mockResolvedValue(sub);
      prisma.digitalEmployee.findUnique.mockResolvedValue({ version: '2.0.0' });

      await svc.upgrade('sub-1', 'u1');

      const data = prisma.subscription.update.mock.calls[0][0].data;
      expect(Object.keys(data)).toEqual(['templateVersion']);
    });

    it('已是最新版时报 409', async () => {
      prisma.subscription.findUnique.mockResolvedValue(sub);
      prisma.digitalEmployee.findUnique.mockResolvedValue({ version: '1.0.0' });

      await expect(svc.upgrade('sub-1', 'u1')).rejects.toThrow(/已是最新版本/);
    });

    it('已过期的雇佣关系不可升级', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        ...sub,
        status: 'EXPIRED',
      });

      await expect(svc.upgrade('sub-1', 'u1')).rejects.toThrow(/不可升级/);
    });

    it('❗普通成员不能升级', async () => {
      ctxSvc.resolve.mockResolvedValue(ACME_STAFF);

      await expect(svc.upgrade('sub-1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('update', () => {
    const sub = {
      id: 'sub-1',
      enterpriseId: 'ent-acme',
      employeeId: 'emp-1',
      status: 'ACTIVE',
      templateVersion: '1.0.0',
    };

    it('可改自定义称呼', async () => {
      prisma.subscription.findUnique.mockResolvedValue(sub);

      await svc.update('sub-1', 'u1', { name: '小美' });

      expect(prisma.subscription.update.mock.calls[0][0].data.name).toBe('小美');
    });

    it('name 传 null 表示恢复展示模板名', async () => {
      prisma.subscription.findUnique.mockResolvedValue(sub);

      await svc.update('sub-1', 'u1', { name: null });

      expect(prisma.subscription.update.mock.calls[0][0].data.name).toBeNull();
    });

    it('未传的字段不写库 —— 避免把 config 覆盖成 undefined', async () => {
      prisma.subscription.findUnique.mockResolvedValue(sub);

      await svc.update('sub-1', 'u1', { name: '小美' });

      const data = prisma.subscription.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('config');
    });

    it('已过期的雇佣关系不可修改', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        ...sub,
        status: 'EXPIRED',
      });

      await expect(svc.update('sub-1', 'u1', { name: 'x' })).rejects.toThrow(
        /不可修改/,
      );
    });

    it('❗普通成员不能修改', async () => {
      ctxSvc.resolve.mockResolvedValue(ACME_STAFF);

      await expect(svc.update('sub-1', 'u1', { name: 'x' })).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
