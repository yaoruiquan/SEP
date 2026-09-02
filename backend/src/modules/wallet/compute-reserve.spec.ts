import { Test, TestingModule } from '@nestjs/testing';
import { WalletService } from './wallet.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * 算力专款：钱包余额里贴了「只能用于与硅基员工对话」标签的一部分。
 *
 * 这组测试锁三条不变量，任何一条破了，「专款专用」就只是文案：
 *   1. 划转不改变 balance —— 它是标签，不是第二本账
 *   2. 订阅这类非算力支出动不了专款
 *   3. 对话扣费优先消耗专款，但专款见底不会让对话中断
 */
describe('WalletService 算力专款', () => {
  let service: WalletService;
  let prisma: any;

  const wallet = (over: Partial<Record<string, Decimal | number | string>> = {}) => ({
    id: 'wallet-1',
    enterpriseId: 'ent-1',
    balance: new Decimal(1000),
    frozenAmount: new Decimal(0),
    computeReservedCNY: new Decimal(0),
    totalDeposit: new Decimal(5000),
    totalConsume: new Decimal(3500),
    totalRefund: new Decimal(500),
    version: 1,
    createdAt: new Date('2026-09-01'),
    updatedAt: new Date('2026-09-01'),
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      enterpriseWallet: {
        findUnique: jest.fn().mockResolvedValue(wallet()),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'tx-1' }),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [WalletService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<WalletService>(WalletService);
  });

  const updateData = () =>
    (prisma.enterpriseWallet.updateMany as jest.Mock).mock.calls[0][0].data;
  const txData = () =>
    (prisma.walletTransaction.create as jest.Mock).mock.calls[0][0].data;

  describe('reserveForCompute', () => {
    it('只改标签不改余额 —— 划入后 balance 一分不动', async () => {
      const result = await service.reserveForCompute('ent-1', 300);

      expect(result.balance.toNumber()).toBe(1000);
      expect(result.computeReservedCNY.toNumber()).toBe(300);
      expect(result.spendableCNY.toNumber()).toBe(700);
      // 写库时压根没提 balance，杜绝「划转把钱转走了」这类事故
      expect(updateData()).not.toHaveProperty('balance');
      expect(new Decimal(updateData().computeReservedCNY).toNumber()).toBe(300);
    });

    it('流水的 before == after，正数表示划入', async () => {
      await service.reserveForCompute('ent-1', 300, 'user-1');

      expect(txData().type).toBe('COMPUTE_RESERVE');
      expect(new Decimal(txData().balanceBefore).toNumber()).toBe(1000);
      expect(new Decimal(txData().balanceAfter).toNumber()).toBe(1000);
      expect(new Decimal(txData().amount).toNumber()).toBe(300);
      expect(txData().createdBy).toBe('user-1');
    });

    it('不能超过自由余额 —— 已划入的部分不能重复划', async () => {
      prisma.enterpriseWallet.findUnique.mockResolvedValue(
        wallet({ computeReservedCNY: new Decimal(800) }),
      );

      await expect(service.reserveForCompute('ent-1', 300)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('金额必须大于 0', async () => {
      await expect(service.reserveForCompute('ent-1', 0)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.reserveForCompute('ent-1', -5)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('releaseFromCompute', () => {
    it('划回后专款减少、余额不变', async () => {
      prisma.enterpriseWallet.findUnique.mockResolvedValue(
        wallet({ computeReservedCNY: new Decimal(500) }),
      );

      const result = await service.releaseFromCompute('ent-1', 200);

      expect(result.balance.toNumber()).toBe(1000);
      expect(result.computeReservedCNY.toNumber()).toBe(300);
      expect(txData().type).toBe('COMPUTE_RELEASE');
      expect(new Decimal(txData().amount).toNumber()).toBe(-200);
    });

    it('不能划回超过专款余额的钱', async () => {
      prisma.enterpriseWallet.findUnique.mockResolvedValue(
        wallet({ computeReservedCNY: new Decimal(100) }),
      );

      await expect(service.releaseFromCompute('ent-1', 200)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('订阅支出动不了专款', () => {
    it('订阅金额超过自由余额时被拦下，即使总余额够', async () => {
      prisma.enterpriseWallet.findUnique.mockResolvedValue(
        wallet({ computeReservedCNY: new Decimal(800) }),
      );

      // 总余额 1000 够付 500，但自由余额只有 200
      await expect(
        service.consume('ent-1', 500, 'subscription', 'sub-1'),
      ).rejects.toThrow(/算力专款/);
    });

    it('订阅金额在自由余额内正常通过', async () => {
      prisma.enterpriseWallet.findUnique.mockResolvedValue(
        wallet({ computeReservedCNY: new Decimal(800) }),
      );

      await expect(
        service.consume('ent-1', 150, 'subscription', 'sub-1'),
      ).resolves.toBeDefined();
    });

    it('专款为 0 时报错文案保持原样 —— 没启用专款的企业不该看到新概念', async () => {
      await expect(
        service.consume('ent-1', 5000, 'subscription', 'sub-1'),
      ).rejects.toThrow(/^余额不足/);
    });

    it('算力扣费不受专款限制（旧 compute 入口）', async () => {
      prisma.enterpriseWallet.findUnique.mockResolvedValue(
        wallet({ computeReservedCNY: new Decimal(800) }),
      );

      await expect(
        service.consume('ent-1', 900, 'compute', 'session-1'),
      ).resolves.toBeDefined();
    });
  });

  describe('对话扣费优先消耗专款', () => {
    const meta = { relatedId: 'session-1', description: '对话消费' };

    it('专款充足时只动专款那一侧的计数', async () => {
      prisma.enterpriseWallet.findUnique.mockResolvedValue(
        wallet({ computeReservedCNY: new Decimal(300) }),
      );

      const result = await service.consumeComputeUpTo(
        prisma,
        'ent-1',
        new Decimal(100),
        meta,
      );

      expect(result.paid.toNumber()).toBe(100);
      expect(new Decimal(updateData().balance).toNumber()).toBe(900);
      expect(new Decimal(updateData().computeReservedCNY).toNumber()).toBe(200);
    });

    it('专款不足时继续扣自由余额，专款归零而不是变负数', async () => {
      prisma.enterpriseWallet.findUnique.mockResolvedValue(
        wallet({ computeReservedCNY: new Decimal(40) }),
      );

      const result = await service.consumeComputeUpTo(
        prisma,
        'ent-1',
        new Decimal(100),
        meta,
      );

      // 这条是「对话不中断」的判据：专款只剩 40，照样扣满 100
      expect(result.paid.toNumber()).toBe(100);
      expect(result.unpaid.toNumber()).toBe(0);
      expect(new Decimal(updateData().computeReservedCNY).toNumber()).toBe(0);
      expect(new Decimal(updateData().balance).toNumber()).toBe(900);
    });

    it('总余额不足时如实记欠费，专款不会被扣成负数', async () => {
      prisma.enterpriseWallet.findUnique.mockResolvedValue(
        wallet({ balance: new Decimal(30), computeReservedCNY: new Decimal(30) }),
      );

      const result = await service.consumeComputeUpTo(
        prisma,
        'ent-1',
        new Decimal(100),
        meta,
      );

      expect(result.paid.toNumber()).toBe(30);
      expect(result.unpaid.toNumber()).toBe(70);
      expect(new Decimal(updateData().computeReservedCNY).toNumber()).toBe(0);
    });
  });

  describe('getBalance', () => {
    it('同时给出专款与自由余额，两页共用一个口径', async () => {
      prisma.enterpriseWallet.findUnique.mockResolvedValue(
        wallet({ computeReservedCNY: new Decimal(250) }),
      );

      const result = await service.getBalance('ent-1');

      expect(result.balance.toNumber()).toBe(1000);
      expect(result.computeReservedCNY.toNumber()).toBe(250);
      expect(result.spendableCNY.toNumber()).toBe(750);
    });
  });
});
