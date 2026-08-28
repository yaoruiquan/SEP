import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
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
  const mockWalletService = {
    adminDeposit: jest.fn(),
    adminDeduct: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: WalletService,
          useValue: mockWalletService,
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    prisma = module.get<PrismaService>(PrismaService);

    // Reset mocks
    jest.clearAllMocks();
    mockWalletService.adminDeposit.mockResolvedValue({ balance: 150 });
    mockWalletService.adminDeduct.mockResolvedValue({ balance: 50 });
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
      expect(mockWalletService.adminDeposit).toHaveBeenCalledWith(
        'ent1',
        50,
        'Test recharge',
        'admin1',
      );
    });

    it('should deduct credit successfully when balance is sufficient', async () => {
      mockPrismaService.enterprise.findUnique.mockResolvedValue(mockEnterprise);

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
      expect(mockWalletService.adminDeduct).toHaveBeenCalledWith(
        'ent1',
        50,
        'Test deduct',
        'admin1',
      );
    });

    it('should throw BadRequestException when deducting more than balance', async () => {
      mockPrismaService.enterprise.findUnique.mockResolvedValue(mockEnterprise);
      mockWalletService.adminDeduct.mockRejectedValue(new BadRequestException('余额不足'));

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

    it('should delegate recharge even when the legacy compute account relation is absent', async () => {
      const enterpriseWithoutAccount = {
        id: 'ent1',
        name: 'Test Enterprise',
        computeAccount: null,
      };

      mockPrismaService.enterprise.findUnique.mockResolvedValue(
        enterpriseWithoutAccount,
      );
      mockWalletService.adminDeposit.mockResolvedValue({ balance: 100 });

      const result = await service.creditAdjustment({
        enterpriseId: 'ent1',
        amount: 100,
        type: 'RECHARGE',
        note: 'Initial recharge',
        operatorId: 'admin1',
      });

      expect(mockWalletService.adminDeposit).toHaveBeenCalledWith(
        'ent1',
        100,
        'Initial recharge',
        'admin1',
      );
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
          // 余额来自钱包（唯一主账本），不再是已停止写入的 ComputeAccount.balance
          wallet: { balance: 100 },
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
