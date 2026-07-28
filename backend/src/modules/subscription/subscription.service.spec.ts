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
    svc = new SubscriptionService(prisma, ctxSvc);
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
      expect(where.status).toBe('ACTIVE');
    });

    it('订阅创建时 enterpriseId 取自服务端上下文，不取自入参', async () => {
      prisma.digitalEmployee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'PUBLISHED',
      });
      prisma.subscription.findUnique.mockResolvedValue(null);

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
        status: 'PUBLISHED',
      });
      prisma.subscription.findUnique.mockResolvedValue(null);

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
        status: 'PUBLISHED',
      });
      prisma.subscription.findUnique.mockResolvedValue(null);

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
      ).rejects.toThrow(/unpublished/i);
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
  });
});
