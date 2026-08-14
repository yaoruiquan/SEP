import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TransactionType } from '@prisma/client';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: PrismaService;

  const mockPrismaService = {
    enterprise: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    computeAccount: {
      create: jest.fn(),
      update: jest.fn(),
    },
    computeTransaction: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    prisma = module.get<PrismaService>(PrismaService);

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('getEnterpriseDetail', () => {
    it('should return enterprise detail with all relations', async () => {
      const mockEnterprise = {
        id: 'ent1',
        name: 'Test Enterprise',
        description: 'Test Description',
        logo: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        members: [],
        // 收敛后企业下挂的是雇佣关系，不再有中间的实例层
        subscriptions: [],
        computeAccount: {
          id: 'acc1',
          balance: 100,
          transactions: [],
        },
        departments: [],
      };

      mockPrismaService.enterprise.findUnique.mockResolvedValue(mockEnterprise);

      const result = await service.getEnterpriseDetail('ent1');

      expect(result).toEqual(mockEnterprise);
      expect(prisma.enterprise.findUnique).toHaveBeenCalledWith({
        where: { id: 'ent1' },
        include: expect.any(Object),
      });
    });

    it('should throw NotFoundException if enterprise does not exist', async () => {
      mockPrismaService.enterprise.findUnique.mockResolvedValue(null);

      await expect(service.getEnterpriseDetail('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('creditAdjustment', () => {
    const mockEnterprise = {
      id: 'ent1',
      name: 'Test Enterprise',
      computeAccount: {
        id: 'acc1',
        balance: 100,
      },
    };

    it('should recharge credit successfully', async () => {
      mockPrismaService.enterprise.findUnique.mockResolvedValue(mockEnterprise);
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrismaService);
      });
      mockPrismaService.computeAccount.update.mockResolvedValue({
        id: 'acc1',
        balance: 150,
      });

      const result = await service.creditAdjustment({
        enterpriseId: 'ent1',
        amount: 50,
        type: 'RECHARGE',
        note: 'Test recharge',
        operatorId: 'admin1',
      });

      expect(result).toEqual({
        success: true,
        newBalance: 150,
      });
    });

    it('should deduct credit successfully when balance is sufficient', async () => {
      mockPrismaService.enterprise.findUnique.mockResolvedValue(mockEnterprise);
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrismaService);
      });
      mockPrismaService.computeAccount.update.mockResolvedValue({
        id: 'acc1',
        balance: 50,
      });

      const result = await service.creditAdjustment({
        enterpriseId: 'ent1',
        amount: 50,
        type: 'DEDUCT',
        note: 'Test deduct',
        operatorId: 'admin1',
      });

      expect(result).toEqual({
        success: true,
        newBalance: 50,
      });
    });

    it('should throw BadRequestException when deducting more than balance', async () => {
      mockPrismaService.enterprise.findUnique.mockResolvedValue(mockEnterprise);

      await expect(
        service.creditAdjustment({
          enterpriseId: 'ent1',
          amount: 200,
          type: 'DEDUCT',
          note: 'Test deduct',
          operatorId: 'admin1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for non-positive amount', async () => {
      await expect(
        service.creditAdjustment({
          enterpriseId: 'ent1',
          amount: -50,
          type: 'RECHARGE',
          note: 'Test',
          operatorId: 'admin1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create compute account if not exists', async () => {
      const enterpriseWithoutAccount = {
        id: 'ent1',
        name: 'Test Enterprise',
        computeAccount: null,
      };

      mockPrismaService.enterprise.findUnique.mockResolvedValue(
        enterpriseWithoutAccount,
      );
      mockPrismaService.computeAccount.create.mockResolvedValue({
        id: 'acc1',
        balance: 0,
        enterpriseId: 'ent1',
      });
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrismaService);
      });
      mockPrismaService.computeAccount.update.mockResolvedValue({
        id: 'acc1',
        balance: 100,
      });

      const result = await service.creditAdjustment({
        enterpriseId: 'ent1',
        amount: 100,
        type: 'RECHARGE',
        note: 'Initial recharge',
        operatorId: 'admin1',
      });

      expect(mockPrismaService.computeAccount.create).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('suspendEnterprise', () => {
    it('should suspend enterprise successfully', async () => {
      const mockEnterprise = {
        id: 'ent1',
        name: 'Test Enterprise',
        metadata: {},
      };

      mockPrismaService.enterprise.findUnique.mockResolvedValue(mockEnterprise);
      mockPrismaService.enterprise.update.mockResolvedValue({
        ...mockEnterprise,
        metadata: { suspended: true },
      });

      const result = await service.suspendEnterprise(
        'ent1',
        'Test reason',
        'admin1',
      );

      expect(result).toEqual({ success: true });
      expect(prisma.enterprise.update).toHaveBeenCalledWith({
        where: { id: 'ent1' },
        data: {
          metadata: expect.objectContaining({
            suspended: true,
            suspendReason: 'Test reason',
          }),
        },
      });
    });

    it('should throw BadRequestException if already suspended', async () => {
      const mockEnterprise = {
        id: 'ent1',
        name: 'Test Enterprise',
        metadata: { suspended: true },
      };

      mockPrismaService.enterprise.findUnique.mockResolvedValue(mockEnterprise);

      await expect(
        service.suspendEnterprise('ent1', 'Test reason', 'admin1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resumeEnterprise', () => {
    it('should resume enterprise successfully', async () => {
      const mockEnterprise = {
        id: 'ent1',
        name: 'Test Enterprise',
        metadata: { suspended: true, suspendReason: 'Test' },
      };

      mockPrismaService.enterprise.findUnique.mockResolvedValue(mockEnterprise);
      mockPrismaService.enterprise.update.mockResolvedValue({
        ...mockEnterprise,
        metadata: { suspended: false },
      });

      const result = await service.resumeEnterprise('ent1', 'admin1');

      expect(result).toEqual({ success: true });
      expect(prisma.enterprise.update).toHaveBeenCalledWith({
        where: { id: 'ent1' },
        data: {
          metadata: expect.objectContaining({
            suspended: false,
          }),
        },
      });
    });

    it('should throw BadRequestException if not suspended', async () => {
      const mockEnterprise = {
        id: 'ent1',
        name: 'Test Enterprise',
        metadata: { suspended: false },
      };

      mockPrismaService.enterprise.findUnique.mockResolvedValue(mockEnterprise);

      await expect(service.resumeEnterprise('ent1', 'admin1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('listEnterprises', () => {
    it('should return paginated enterprise list', async () => {
      const mockEnterprises = [
        {
          id: 'ent1',
          name: 'Enterprise 1',
          description: null,
          logo: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {},
          computeAccount: { balance: 100 },
          _count: { members: 5, subscriptions: 3 },
        },
      ];

      mockPrismaService.enterprise.findMany.mockResolvedValue(mockEnterprises);
      mockPrismaService.enterprise.count.mockResolvedValue(1);

      const result = await service.listEnterprises({
        page: 1,
        pageSize: 20,
      });

      expect(result).toEqual({
        data: expect.arrayContaining([
          expect.objectContaining({
            id: 'ent1',
            balance: 100,
            memberCount: 5,
            subscriptionCount: 3,
            suspended: false,
          }),
        ]),
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
    });

    it('should filter by keyword', async () => {
      mockPrismaService.enterprise.findMany.mockResolvedValue([]);
      mockPrismaService.enterprise.count.mockResolvedValue(0);

      await service.listEnterprises({
        page: 1,
        pageSize: 20,
        keyword: 'test',
      });

      expect(prisma.enterprise.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.any(Array),
          }),
        }),
      );
    });
  });
});
