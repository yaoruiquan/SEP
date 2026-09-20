import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseService } from './enterprise.service';
import { EnterpriseContextService } from './enterprise-context.service';

describe('EnterpriseService', () => {
  let service: EnterpriseService;
  let prisma: PrismaService;
  let ctx: EnterpriseContextService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnterpriseService,
        {
          provide: PrismaService,
          useValue: {
            computeAccount: {
              findUnique: jest.fn(),
            },
            subscription: {
              count: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
            },
            enterpriseMember: {
              count: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
            },
            computeTransaction: {
              count: jest.fn(),
              findMany: jest.fn(),
            },
            computeUsageRecord: {
              groupBy: jest.fn(),
            },
          },
        },
        {
          provide: EnterpriseContextService,
          useValue: {
            resolve: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EnterpriseService>(EnterpriseService);
    prisma = module.get<PrismaService>(PrismaService);
    ctx = module.get<EnterpriseContextService>(EnterpriseContextService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDashboardStats', () => {
    it('should return empty stats when no compute account exists', async () => {
      jest.spyOn(ctx, 'resolve').mockResolvedValue({
        enterpriseId: 'ent-1',
        memberId: 'mem-1',
        role: 'ENTERPRISE_ADMIN',
        departmentId: null,
      });

      jest.spyOn(prisma.computeAccount, 'findUnique').mockResolvedValue(null);

      const result = await service.getDashboardStats('user-1');

      expect(result).toEqual({
        scope: 'enterprise',
        employeeCount: 0,
        memberCount: 0,
        monthlySpend: 0,
        callCount: 0,
        spendTrend: [],
        topEmployees: [],
        recentActivities: [],
        modelDistribution: [],
        tokenTrend: [],
        topMembers: [],
      });
    });

    it('should return dashboard stats when compute account exists', async () => {
      jest.spyOn(ctx, 'resolve').mockResolvedValue({
        enterpriseId: 'ent-1',
        memberId: 'mem-1',
        role: 'ENTERPRISE_ADMIN',
        departmentId: null,
      });

      jest.spyOn(prisma.computeAccount, 'findUnique').mockResolvedValue({
        id: 'acc-1',
        enterpriseId: 'ent-1',
        balance: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      jest.spyOn(prisma.subscription, 'count').mockResolvedValue(5);
      jest.spyOn(prisma.enterpriseMember, 'count').mockResolvedValue(10);
      jest
        .spyOn(prisma.computeTransaction, 'count')
        .mockResolvedValue(50);
      jest
        .spyOn(prisma.computeTransaction, 'findMany')
        .mockResolvedValue([]);
      (prisma.computeUsageRecord.groupBy as jest.Mock).mockResolvedValue([]);
      jest
        .spyOn(prisma.subscription, 'findMany')
        .mockResolvedValue([]);
      jest
        .spyOn(prisma.enterpriseMember, 'findMany')
        .mockResolvedValue([]);

      const result = await service.getDashboardStats('user-1');

      expect(result).toMatchObject({
        employeeCount: 5,
        memberCount: 10,
        monthlySpend: 0,
        callCount: 50,
        spendTrend: [],
        topEmployees: [],
        recentActivities: [],
      });
    });

    it('普通成员只看自己的用量，不返回企业成员排行', async () => {
      jest.spyOn(ctx, 'resolve').mockResolvedValue({
        enterpriseId: 'ent-1',
        memberId: 'member-1',
        role: 'MEMBER',
        departmentId: null,
      });
      jest.spyOn(prisma.computeAccount, 'findUnique').mockResolvedValue({
        id: 'acc-1',
        enterpriseId: 'ent-1',
        balance: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      jest.spyOn(prisma.subscription, 'count').mockResolvedValue(1);
      jest.spyOn(prisma.enterpriseMember, 'count').mockResolvedValue(10);
      jest.spyOn(prisma.computeTransaction, 'count').mockResolvedValue(2);
      jest.spyOn(prisma.computeTransaction, 'findMany').mockResolvedValue([]);
      (prisma.computeUsageRecord.groupBy as jest.Mock).mockResolvedValue([]);
      jest.spyOn(prisma.subscription, 'findMany').mockResolvedValue([]);
      jest.spyOn(prisma.enterpriseMember, 'findMany').mockResolvedValue([]);

      const result = await service.getDashboardStats('user-1');

      expect(result.scope).toBe('member');
      expect(result.memberCount).toBe(0);
      expect(result.topMembers).toEqual([]);
      expect((prisma.computeTransaction.count as jest.Mock).mock.calls[0][0].where).toEqual(
        expect.objectContaining({
          AND: [{ metadata: { path: ['memberId'], equals: 'member-1' } }],
        }),
      );
      expect((prisma.computeUsageRecord.groupBy as jest.Mock).mock.calls[0][0].where).toEqual(
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('模型分布来自统一账本，按 enterpriseId + 30 天窗口在库内聚合', async () => {
      jest.spyOn(ctx, 'resolve').mockResolvedValue({
        enterpriseId: 'ent-1',
        memberId: 'mem-1',
        role: 'ENTERPRISE_ADMIN',
        departmentId: null,
      });
      jest.spyOn(prisma.computeAccount, 'findUnique').mockResolvedValue({
        id: 'acc-1',
        enterpriseId: 'ent-1',
        balance: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      jest.spyOn(prisma.subscription, 'count').mockResolvedValue(0);
      jest.spyOn(prisma.enterpriseMember, 'count').mockResolvedValue(0);
      jest.spyOn(prisma.computeTransaction, 'count').mockResolvedValue(1);
      jest.spyOn(prisma.computeTransaction, 'findMany').mockResolvedValue([]);
      jest.spyOn(prisma.subscription, 'findMany').mockResolvedValue([]);
      jest.spyOn(prisma.enterpriseMember, 'findMany').mockResolvedValue([]);
      // 不用 jest.spyOn：groupBy 的泛型签名会让 mockResolvedValue 触发
      // Prisma 的 TS2615 循环引用报错，直接按 jest.Mock 断言。
      (prisma.computeUsageRecord.groupBy as jest.Mock).mockResolvedValue([
        {
          modelId: 'gpt-4o-mini',
          _count: { _all: 2 },
          _sum: { inputTokens: 220, outputTokens: 130, costCNY: 0.002 },
        },
        {
          modelId: 'gpt-4o',
          _count: { _all: 5 },
          _sum: { inputTokens: 1000, outputTokens: 400, costCNY: 1.23456 },
        },
      ]);

      const result = await service.getDashboardStats('user-1');

      // 多租户归因直接落在账本的 enterpriseId 上，不再绕 session → user → memberships
      const call = (prisma.computeUsageRecord.groupBy as jest.Mock).mock
        .calls[0][0];
      expect(call.by).toEqual(['modelId']);
      expect(call.where.enterpriseId).toBe('ent-1');
      expect(call.where.createdAt.gte).toBeInstanceOf(Date);

      // 窗口是 30 天（与消费趋势同口径），而非「有史以来」
      const windowDays = Math.round(
        (Date.now() - call.where.createdAt.gte.getTime()) / 86_400_000,
      );
      expect(windowDays).toBe(30);

      // 按调用次数倒序；成本保留 4 位小数
      expect(result.modelDistribution).toEqual([
        { model: 'gpt-4o', requests: 5, tokens: 1400, cost: 1.2346 },
        { model: 'gpt-4o-mini', requests: 2, tokens: 350, cost: 0.002 },
      ]);
    });
  });

  describe('getTopMembers', () => {
    it('只统计最近 30 天并保持消费金额降序', async () => {
      (prisma.computeTransaction.findMany as jest.Mock).mockResolvedValue([
        { metadata: { memberId: 'member-a' }, amount: 4.2 },
        { metadata: { memberId: 'member-b' }, amount: 6.2 },
        { metadata: { memberId: 'member-c' }, amount: 4.85 },
      ]);
      (prisma.enterpriseMember.findMany as jest.Mock).mockResolvedValue([
        { id: 'member-c', user: { name: '成员 C', avatar: null } },
        { id: 'member-a', user: { name: '成员 A', avatar: null } },
        { id: 'member-b', user: { name: '成员 B', avatar: null } },
      ]);

      const result = await (service as any).getTopMembers('account-1', 'ent-1');

      const query = (prisma.computeTransaction.findMany as jest.Mock).mock
        .calls[0][0];
      expect(query.where.createdAt.gte).toBeInstanceOf(Date);
      expect(Math.round((Date.now() - query.where.createdAt.gte.getTime()) / 86_400_000)).toBe(30);
      expect(result.map((member: { id: string }) => member.id)).toEqual([
        'member-b',
        'member-c',
        'member-a',
      ]);
    });
  });
});
