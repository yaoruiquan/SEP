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
            message: {
              findMany: jest.fn(),
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
      jest.spyOn(prisma.message, 'findMany').mockResolvedValue([]);
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

    it('should build model distribution from actual assistant messages', async () => {
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
      jest.spyOn(prisma.message, 'findMany').mockResolvedValue([
        {
          modelId: 'gemini-3.5-flash-high',
          inputTokens: 120,
          outputTokens: 80,
          cost: 0.0012,
        },
        {
          modelId: 'gemini-3.5-flash-high',
          inputTokens: 100,
          outputTokens: 50,
          cost: 0.0008,
        },
      ] as any);

      const result = await service.getDashboardStats('user-1');

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: 'ASSISTANT',
            modelId: { not: null },
          }),
        }),
      );
      expect(result.modelDistribution).toEqual([
        {
          model: 'gemini-3.5-flash-high',
          requests: 2,
          tokens: 350,
          cost: 0.002,
        },
      ]);
    });
  });
});
