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
  });
});
