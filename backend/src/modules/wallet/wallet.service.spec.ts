import { Test, TestingModule } from '@nestjs/testing';
import { WalletService } from './wallet.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('WalletService', () => {
  let service: WalletService;
  let prisma: jest.Mocked<PrismaService>;

  const mockWallet = {
    id: 'wallet-1',
    enterpriseId: 'ent-1',
    balance: new Decimal(1000),
    totalDeposit: new Decimal(5000),
    totalConsume: new Decimal(3500),
    totalRefund: new Decimal(500),
    version: 1,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const mockTransaction = {
    id: 'tx-1',
    walletId: 'wallet-1',
    type: 'CONSUME',
    amount: new Decimal(100),
    balanceBefore: new Decimal(1000),
    balanceAfter: new Decimal(900),
    relatedType: 'compute',
    relatedId: 'session-1',
    description: '对话消费',
    metadata: null,
    createdAt: new Date('2024-01-01'),
  };

  beforeEach(async () => {
    const mockPrisma = {
      enterpriseWallet: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      walletTransaction: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(mockPrisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
    prisma = module.get(PrismaService) as jest.Mocked<PrismaService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getBalance', () => {
    it('should return wallet statistics', async () => {
      (prisma.enterpriseWallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);

      const result = await service.getBalance('ent-1');

      expect(result.balance.toNumber()).toBe(1000);
      expect(result.totalDeposit.toNumber()).toBe(5000);
      expect(result.totalConsume.toNumber()).toBe(3500);
      expect(prisma.enterpriseWallet.findUnique).toHaveBeenCalledWith({
        where: { enterpriseId: 'ent-1' },
      });
    });
  });

  describe('deposit', () => {
    it('should create deposit transaction and update balance', async () => {
      (prisma.enterpriseWallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (prisma.enterpriseWallet.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.walletTransaction.create as jest.Mock).mockResolvedValue({
        ...mockTransaction,
        type: 'DEPOSIT',
        amount: new Decimal(100),
        balanceBefore: new Decimal(1000),
        balanceAfter: new Decimal(1100),
        paymentOrderId: 'order-1',
        description: '充值 ¥100',
      });

      const result = await service.deposit('ent-1', 100, 'order-1', '支付宝充值');

      expect(result.type).toBe('DEPOSIT');
      expect(result.amount.toNumber()).toBe(100);
      expect(prisma.enterpriseWallet.updateMany).toHaveBeenCalled();
      expect(prisma.walletTransaction.create).toHaveBeenCalled();
    });

    it('should throw BadRequestException if amount <= 0', async () => {
      await expect(service.deposit('ent-1', 0, 'order-1')).rejects.toThrow(
        BadRequestException,
      );

      await expect(service.deposit('ent-1', -10, 'order-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('consume', () => {
    it('should create consume transaction and deduct balance', async () => {
      (prisma.enterpriseWallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (prisma.enterpriseWallet.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.walletTransaction.create as jest.Mock).mockResolvedValue({
        ...mockTransaction,
        type: 'CONSUME',
        amount: new Decimal(-100),
        balanceBefore: new Decimal(1000),
        balanceAfter: new Decimal(900),
      });

      const result = await service.consume(
        'ent-1',
        100,
        'compute',
        'session-1',
        '对话消费',
      );

      expect(result.type).toBe('CONSUME');
      expect(result.amount.toNumber()).toBe(-100);
      expect(prisma.enterpriseWallet.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { enterpriseId: 'ent-1', version: 1 },
        }),
      );
    });

    it('should throw BadRequestException if balance insufficient', async () => {
      (prisma.enterpriseWallet.findUnique as jest.Mock).mockResolvedValue({
        ...mockWallet,
        balance: new Decimal(50),
      });

      await expect(
        service.consume('ent-1', 100, 'compute', null, '消费'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if wallet does not exist', async () => {
      (prisma.enterpriseWallet.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.consume('ent-1', 100, 'compute', null, '消费'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if amount <= 0', async () => {
      await expect(
        service.consume('ent-1', 0, 'compute', null, '消费'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('refund', () => {
    it('should create refund transaction and increase balance', async () => {
      (prisma.enterpriseWallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (prisma.enterpriseWallet.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.walletTransaction.create as jest.Mock).mockResolvedValue({
        ...mockTransaction,
        type: 'REFUND',
        amount: new Decimal(100),
        balanceBefore: new Decimal(1000),
        balanceAfter: new Decimal(1100),
        relatedType: 'subscription',
        relatedId: 'sub-1',
        description: '试用期退款',
      });

      const result = await service.refund(
        'ent-1',
        100,
        'subscription',
        'sub-1',
        '试用期退款',
      );

      expect(result.type).toBe('REFUND');
      expect(result.amount.toNumber()).toBe(100);
    });

    it('should throw NotFoundException if wallet does not exist', async () => {
      (prisma.enterpriseWallet.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.refund('ent-1', 100, 'subscription', null, '退款'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if amount <= 0', async () => {
      await expect(
        service.refund('ent-1', 0, 'subscription', null, '退款'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getTransactions', () => {
    it('should return paginated transaction list', async () => {
      const mockTransactions = [
        { ...mockTransaction, id: 'tx-1' },
        { ...mockTransaction, id: 'tx-2' },
      ];

      (prisma.enterpriseWallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValue(mockTransactions);
      (prisma.walletTransaction.count as jest.Mock).mockResolvedValue(2);

      const result = await service.getTransactions('ent-1', {
        page: 1,
        limit: 10,
      });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it('should filter by type', async () => {
      (prisma.enterpriseWallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValue([mockTransaction]);
      (prisma.walletTransaction.count as jest.Mock).mockResolvedValue(1);

      await service.getTransactions('ent-1', {
        page: 1,
        limit: 10,
        type: 'CONSUME',
      });

      expect(prisma.walletTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'CONSUME',
          }),
        }),
      );
    });
  });

  describe('optimistic locking', () => {
    it('should throw ConflictException on version conflict', async () => {
      (prisma.enterpriseWallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (prisma.enterpriseWallet.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(
        service.consume('ent-1', 100, 'compute', null, '消费'),
      ).rejects.toThrow(ConflictException);
    });
  });
});
