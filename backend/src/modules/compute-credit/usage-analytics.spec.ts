import { Test, TestingModule } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { UsageAnalyticsService } from './usage-analytics.service';

/**
 * 用量分析只做一件事：把已经花掉的钱按维度分好。
 *
 * 这组测试锁四条，破了任何一条这一页就会给出错的结论：
 *   1. 百分比以区间总额为分母，四个维度加起来是 100%
 *   2. 部门维度由成员上卷得出，不额外打库；没部门的归「未分配部门」
 *   3. 账单里 userId / employeeId 可为空（离职、员工下架），不能显示 null
 *   4. 上期为 0 时不算环比 —— 「增长 ∞%」没有信息量
 *   5. 成员视角只统计他自己 —— 每一处聚合（含裸 SQL 趋势）都得带上 userId
 */
describe('UsageAnalyticsService', () => {
  let service: UsageAnalyticsService;
  let prisma: any;

  const sum = (cost: number, count: number) => ({
    _sum: { costCNY: new Decimal(cost) },
    _count: count,
  });

  beforeEach(async () => {
    prisma = {
      computeUsageRecord: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: {
            costCNY: new Decimal(100),
            inputTokens: 1000,
            outputTokens: 2000,
          },
          _count: 12,
        }),
        groupBy: jest.fn(),
      },
      enterpriseMember: { findMany: jest.fn().mockResolvedValue([]) },
      digitalEmployee: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    // groupBy 按调用顺序返回：model → member → employee
    prisma.computeUsageRecord.groupBy
      .mockResolvedValueOnce([
        { modelId: 'gpt-4o', ...sum(70, 8) },
        { modelId: 'deepseek-v4-flash', ...sum(30, 4) },
      ])
      .mockResolvedValueOnce([
        { userId: 'u-1', ...sum(60, 7) },
        { userId: 'u-2', ...sum(25, 3) },
        { userId: null, ...sum(15, 2) },
      ])
      .mockResolvedValueOnce([{ employeeId: 'e-1', ...sum(100, 12) }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsageAnalyticsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(UsageAnalyticsService);
  });

  const withMembers = () =>
    prisma.enterpriseMember.findMany.mockResolvedValue([
      {
        userId: 'u-1',
        user: { name: '张三', email: 'z@acme.local' },
        department: { name: '技术部' },
      },
      {
        userId: 'u-2',
        user: { name: null, email: 'lisi@acme.local' },
        department: null,
      },
    ]);

  it('区间只接受 7 / 30 / 90，其他值回落到 30', async () => {
    prisma.computeUsageRecord.aggregate.mockResolvedValue({
      _sum: { costCNY: new Decimal(0) },
      _count: 0,
    });

    await expect(
      service.getBreakdown('ent-1', 365).then((r) => r.rangeDays),
    ).resolves.toBe(30);
  });

  it('百分比以区间总额为分母，同一维度加总为 100%', async () => {
    withMembers();
    const r = await service.getBreakdown('ent-1', 30);

    expect(r.byModel.map((m) => m.pct)).toEqual([70, 30]);
    expect(r.byModel.reduce((s, m) => s + m.pct, 0)).toBe(100);
    expect(r.byMember.reduce((s, m) => s + m.pct, 0)).toBe(100);
  });

  it('各维度按花费降序 —— 排行榜倒过来就没用了', async () => {
    withMembers();
    const r = await service.getBreakdown('ent-1', 30);

    expect(r.byModel[0].label).toBe('gpt-4o');
    expect(r.byMember[0].label).toBe('张三');
  });

  it('部门由成员上卷，没部门的归「未分配部门」，且不额外打库', async () => {
    withMembers();
    const r = await service.getBreakdown('ent-1', 30);

    const byName = new Map(r.byDepartment.map((d) => [d.label, d]));
    expect(byName.get('技术部')?.costCNY).toBe('60.0000');
    // u-2 无部门 + userId 为空的系统调用，都落进「未分配部门」
    expect(byName.get('未分配部门')?.costCNY).toBe('40.0000');
    expect(prisma.enterpriseMember.findMany).toHaveBeenCalledTimes(1);
  });

  it('部门行带「N 人在用」，空 userId 不计入人数', async () => {
    withMembers();
    const r = await service.getBreakdown('ent-1', 30);

    const unassigned = r.byDepartment.find((d) => d.label === '未分配部门');
    // u-2 算一人；userId 为 null 的那条不算人
    expect(unassigned?.hint).toBe('1 人在用');
  });

  it('离职成员与下架员工不显示 null', async () => {
    prisma.enterpriseMember.findMany.mockResolvedValue([]);
    const r = await service.getBreakdown('ent-1', 30);

    expect(r.byMember.map((m) => m.label)).toEqual([
      '已离职成员',
      '已离职成员',
      '系统调用',
    ]);
    expect(r.byEmployee[0].label).toBe('已下架员工');
  });

  it('没名字的成员回落到邮箱', async () => {
    withMembers();
    const r = await service.getBreakdown('ent-1', 30);
    expect(r.byMember.some((m) => m.label === 'lisi@acme.local')).toBe(true);
  });

  describe('环比', () => {
    it('上期有消费时算百分比', async () => {
      withMembers();
      prisma.computeUsageRecord.aggregate
        .mockResolvedValueOnce({
          _sum: { costCNY: new Decimal(100), inputTokens: 0, outputTokens: 0 },
          _count: 12,
        })
        .mockResolvedValueOnce({ _sum: { costCNY: new Decimal(80) } });

      const r = await service.getBreakdown('ent-1', 30);
      expect(r.deltaPct).toBe(25);
    });

    it('上期为 0 时返回 null，不给「增长 ∞%」', async () => {
      withMembers();
      prisma.computeUsageRecord.aggregate
        .mockResolvedValueOnce({
          _sum: { costCNY: new Decimal(100), inputTokens: 0, outputTokens: 0 },
          _count: 12,
        })
        .mockResolvedValueOnce({ _sum: { costCNY: null } });

      const r = await service.getBreakdown('ent-1', 30);
      expect(r.deltaPct).toBeNull();
    });
  });

  describe('成员视角（只看自己那一份）', () => {
    it('每一处聚合都带 userId —— 漏一处就漏出别人的账', async () => {
      withMembers();
      await service.getBreakdown('ent-1', 30, 'u-1');

      for (const call of prisma.computeUsageRecord.aggregate.mock.calls) {
        expect(call[0].where.userId).toBe('u-1');
      }
      for (const call of prisma.computeUsageRecord.groupBy.mock.calls) {
        expect(call[0].where.userId).toBe('u-1');
      }
    });

    it('趋势用的裸 SQL 也带 userId，否则折线画的还是全公司', async () => {
      withMembers();
      await service.getBreakdown('ent-1', 30, 'u-1');

      // 标签模板的插值里会多出一个 Prisma.sql 片段，userId 在它的 values 里
      const fragment = prisma.$queryRaw.mock.calls[0].find(
        (a: any) => a && Array.isArray(a.values),
      );
      expect(fragment?.values).toContain('u-1');
    });

    it('不返回「按碳基员工 / 按部门」，也不去查成员名单', async () => {
      withMembers();
      const r = await service.getBreakdown('ent-1', 30, 'u-1');

      expect(r.byMember).toEqual([]);
      expect(r.byDepartment).toEqual([]);
      // 但「我花在哪个模型 / 哪个硅基员工」照常给 —— 那是他自己的账
      expect(r.byModel.length).toBeGreaterThan(0);
      expect(r.byEmployee.length).toBeGreaterThan(0);
      expect(prisma.enterpriseMember.findMany).not.toHaveBeenCalled();
    });

    it('管理员视角不受影响，四个维度都在', async () => {
      withMembers();
      const r = await service.getBreakdown('ent-1', 30);

      expect(r.byMember.length).toBeGreaterThan(0);
      expect(r.byDepartment.length).toBeGreaterThan(0);
      const scoped = prisma.computeUsageRecord.groupBy.mock.calls.some(
        (c: any[]) => 'userId' in c[0].where,
      );
      expect(scoped).toBe(false);
    });
  });

  it('区间内没有任何消费时不报错，百分比不产生 NaN', async () => {
    prisma.computeUsageRecord.aggregate.mockResolvedValue({
      _sum: { costCNY: null, inputTokens: null, outputTokens: null },
      _count: 0,
    });
    prisma.computeUsageRecord.groupBy.mockReset();
    prisma.computeUsageRecord.groupBy.mockResolvedValue([]);

    const r = await service.getBreakdown('ent-1', 7);

    expect(r.totalCNY).toBe('0.0000');
    expect(r.callCount).toBe(0);
    expect(r.byModel).toEqual([]);
    expect(r.byDepartment).toEqual([]);
    expect(r.deltaPct).toBeNull();
  });
});
