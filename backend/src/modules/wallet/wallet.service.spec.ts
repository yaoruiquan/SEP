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

  /**
   * 算力扣款的「有多少扣多少」语义。
   *
   * 它和 consume() 的差别是刻意的：模型调用**已经发生**了，抛错回滚会连
   * 「这次消费存在过」一起丢掉。所以扣到 0 为止，差额交给账单记欠费。
   */
  describe('consumeComputeUpTo', () => {
    const meta = { relatedId: 'session-1', description: '对话算力消费' };

    beforeEach(() => {
      (prisma.enterpriseWallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (prisma.enterpriseWallet.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.walletTransaction.create as jest.Mock).mockResolvedValue(mockTransaction);
    });

    it('余额充足时全额扣款，无欠费', async () => {
      const result = await service.consumeComputeUpTo(
        prisma as never,
        'ent-1',
        new Decimal(100),
        meta,
      );

      expect(result.paid.toNumber()).toBe(100);
      expect(result.unpaid.toNumber()).toBe(0);
      expect(result.transactionId).toBe('tx-1');
    });

    it('❗余额不足时扣到 0，差额作为欠费返回，余额不变负', async () => {
      const result = await service.consumeComputeUpTo(
        prisma as never,
        'ent-1',
        new Decimal(1500), // 余额只有 1000
        meta,
      );

      expect(result.paid.toNumber()).toBe(1000);
      expect(result.unpaid.toNumber()).toBe(500);

      const data = (prisma.enterpriseWallet.updateMany as jest.Mock).mock
        .calls[0][0].data;
      expect(new Decimal(data.balance).toNumber()).toBe(0);
    });

    it('余额为 0 时不产生流水，整笔作为欠费', async () => {
      (prisma.enterpriseWallet.findUnique as jest.Mock).mockResolvedValue({
        ...mockWallet,
        balance: new Decimal(0),
      });

      const result = await service.consumeComputeUpTo(
        prisma as never,
        'ent-1',
        new Decimal(10),
        meta,
      );

      expect(result.paid.toNumber()).toBe(0);
      expect(result.unpaid.toNumber()).toBe(10);
      expect(result.transactionId).toBeNull();
      // 0 元流水只会污染账单，不记
      expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    });

    it('金额为 0 时直接返回，不查库不写库', async () => {
      const result = await service.consumeComputeUpTo(
        prisma as never,
        'ent-1',
        new Decimal(0),
        meta,
      );

      expect(result.paid.toNumber()).toBe(0);
      expect(prisma.enterpriseWallet.findUnique).not.toHaveBeenCalled();
    });

    it('并发冲突抛 ConflictException，由调用方整笔重试', async () => {
      (prisma.enterpriseWallet.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(
        service.consumeComputeUpTo(prisma as never, 'ent-1', new Decimal(100), meta),
      ).rejects.toThrow(ConflictException);
    });

    it('流水按算力消费归类，relatedId 记会话以便追溯', async () => {
      await service.consumeComputeUpTo(
        prisma as never,
        'ent-1',
        new Decimal(100),
        meta,
      );

      const data = (prisma.walletTransaction.create as jest.Mock).mock.calls[0][0]
        .data;
      expect(data.relatedType).toBe('compute');
      expect(data.relatedId).toBe('session-1');
      // 出账记负数，与其他消费流水的符号约定一致
      expect(new Decimal(data.amount).toNumber()).toBe(-100);
    });

    it('钱包不存在时报 404 —— 扣费链路必须先确保钱包就位', async () => {
      (prisma.enterpriseWallet.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.consumeComputeUpTo(prisma as never, 'ent-1', new Decimal(10), meta),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
