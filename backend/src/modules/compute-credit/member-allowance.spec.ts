import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { MemberAllowanceService } from './member-allowance.service';

/**
 * 算力分配 = 闸门，不是钱包。
 *
 * 这组测试锁住四件事，破了任何一条这个功能就会误导管理员：
 *   1. 没记录 / 停用 / 未设上限 一律放行 —— 存量企业不会因为这张表被拦
 *   2. 花到上限才拦，且拦下时给出重置时间与出路
 *   3. 清空额度用删除表达，不留「有记录但无约束」的中间态
 *   4. 分配不碰任何余额字段
 */
describe('MemberAllowanceService', () => {
  let service: MemberAllowanceService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      enterpriseMember: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }),
      },
      memberComputeAllowance: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      computeUsageRecord: {
        groupBy: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: { costCNY: new Decimal(0) } }),
      },
      enterpriseWallet: { findUnique: jest.fn(), updateMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [MemberAllowanceService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(MemberAllowanceService);
  });

  const allowance = (limit: number | null, enabled = true) => ({
    id: 'a-1',
    enterpriseId: 'ent-1',
    userId: 'user-1',
    limitCNY: limit === null ? null : new Decimal(limit),
    period: 'MONTH',
    enabled,
  });

  const used = (amount: number) =>
    prisma.computeUsageRecord.aggregate.mockResolvedValue({
      _sum: { costCNY: new Decimal(amount) },
    });

  describe('check —— 对话前的闸门', () => {
    it('没有 userId 时放行（系统内部调用）', async () => {
      await expect(service.check('ent-1', null)).resolves.toEqual({ allowed: true });
      expect(prisma.memberComputeAllowance.findUnique).not.toHaveBeenCalled();
    });

    it('没有额度记录时放行 —— 存量企业不受影响', async () => {
      const result = await service.check('ent-1', 'user-1');
      expect(result.allowed).toBe(true);
    });

    it('额度停用时放行，但数字保留着', async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(allowance(50, false));
      used(999);

      await expect(service.check('ent-1', 'user-1')).resolves.toEqual({ allowed: true });
    });

    it('未花到上限时放行', async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(allowance(50));
      used(49.99);

      await expect(service.check('ent-1', 'user-1')).resolves.toEqual({ allowed: true });
    });

    it('刚好花到上限就拦下 —— 上限是「最多花这么多」，不是「花过这么多」', async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(allowance(50));
      used(50);

      const result = await service.check('ent-1', 'user-1');
      expect(result.allowed).toBe(false);
    });

    it('拦下时必须给出重置时间和出路，不能只说不能用', async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(allowance(50));
      used(62.5);

      const { reason } = await service.check('ent-1', 'user-1');
      expect(reason).toContain('已用 ¥62.50');
      expect(reason).toContain('上限 ¥50.00');
      expect(reason).toContain('重置');
      expect(reason).toContain('企业管理员');
    });
  });

  describe('setAllowance', () => {
    it('不是本企业成员时报 404 —— 防止跨租户改别人额度', async () => {
      prisma.enterpriseMember.findFirst.mockResolvedValue(null);

      await expect(service.setAllowance('ent-1', 'user-x', 100)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.memberComputeAllowance.upsert).not.toHaveBeenCalled();
    });

    it('金额必须大于 0；想不限额要传 null 而不是 0', async () => {
      await expect(service.setAllowance('ent-1', 'user-1', 0)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.setAllowance('ent-1', 'user-1', -1)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('传 null 用删除记录表达不限额，不留没有约束的空行', async () => {
      prisma.enterpriseMember.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          user: { name: '张三', email: 'z@acme.local' },
          department: null,
        },
      ]);

      const result = await service.setAllowance('ent-1', 'user-1', null);

      expect(prisma.memberComputeAllowance.deleteMany).toHaveBeenCalledWith({
        where: { enterpriseId: 'ent-1', userId: 'user-1' },
      });
      expect(prisma.memberComputeAllowance.upsert).not.toHaveBeenCalled();
      expect(result.limitCNY).toBeNull();
    });

    it('分配额度不碰任何余额字段 —— 它是闸门不是划款', async () => {
      prisma.enterpriseMember.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          user: { name: '张三', email: 'lisi@acme.local' },
          department: null,
        },
      ]);
      prisma.memberComputeAllowance.findMany.mockResolvedValue([allowance(500)]);

      await service.setAllowance('ent-1', 'user-1', 500);

      expect(prisma.enterpriseWallet.updateMany).not.toHaveBeenCalled();
      expect(prisma.enterpriseWallet.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('listAllowances', () => {
    beforeEach(() => {
      prisma.enterpriseMember.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          user: { name: '张三', email: 'z@acme.local' },
          department: { name: '技术部' },
        },
        {
          userId: 'user-2',
          user: { name: null, email: 'l@acme.local' },
          department: null,
        },
      ]);
      prisma.memberComputeAllowance.findMany.mockResolvedValue([allowance(200)]);
      prisma.computeUsageRecord.groupBy.mockResolvedValue([
        { userId: 'user-1', _sum: { costCNY: new Decimal(40) } },
      ]);
    });

    it('有额度的算出剩余与百分比，没额度的两项都是 null', async () => {
      const [first, second] = await service.listAllowances('ent-1');

      expect(first.limitCNY).toBe('200.00');
      expect(first.usedCNY).toBe('40.0000');
      expect(first.remainingCNY).toBe('160.0000');
      expect(first.usedPct).toBe(20);

      expect(second.limitCNY).toBeNull();
      expect(second.remainingCNY).toBeNull();
      expect(second.usedPct).toBeNull();
      expect(second.usedCNY).toBe('0.0000');
    });

    it('没名字的成员回落到邮箱，不显示 null', async () => {
      const [, second] = await service.listAllowances('ent-1');
      expect(second.name).toBe('l@acme.local');
    });

    it('成员数与查询次数无关 —— 三次查询搞定，不做 N+1', async () => {
      await service.listAllowances('ent-1');

      expect(prisma.enterpriseMember.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.memberComputeAllowance.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.computeUsageRecord.groupBy).toHaveBeenCalledTimes(1);
    });
  });
});
