import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { EmployeeUsageService } from './employee-usage.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 这些测试锁的是**口径**，不是取数动作：
 * 在用人数怎么去重、部门授权怎么展开成人、空值该是 null 还是 0。
 * 口径错了页面照样渲染，只是数字骗人 —— 所以每条都单独立测。
 */
describe('EmployeeUsageService', () => {
  let service: EmployeeUsageService;
  let prisma: any;

  const TARGETS = [{ subscriptionId: 'sub-1', employeeId: 'emp-1' }];

  beforeEach(async () => {
    prisma = {
      computeUsageRecord: { groupBy: jest.fn().mockResolvedValue([]) },
      employeeGrant: { findMany: jest.fn().mockResolvedValue([]) },
      enterpriseMember: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const mod = await Test.createTestingModule({
      providers: [
        EmployeeUsageService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = mod.get(EmployeeUsageService);
  });

  /** groupBy 被调用三次，按调用顺序返回不同结果 */
  const stubGroupBy = (
    active: unknown[],
    month: unknown[],
    lastUsed: unknown[],
  ) => {
    prisma.computeUsageRecord.groupBy
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce(month)
      .mockResolvedValueOnce(lastUsed);
  };

  it('目标为空时不打库', async () => {
    const result = await service.forSubscriptions('ent-1', []);

    expect(result.size).toBe(0);
    expect(prisma.computeUsageRecord.groupBy).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('在用人数按人去重，同一人多次调用只算一个', async () => {
    stubGroupBy(
      [
        { employeeId: 'emp-1', userId: 'u-1' },
        { employeeId: 'emp-1', userId: 'u-2' },
      ],
      [],
      [],
    );

    const usage = (await service.forSubscriptions('ent-1', TARGETS)).get(
      'sub-1',
    );

    expect(usage?.activeUserCount30d).toBe(2);
  });

  it('系统内部调用（userId 为空）不算作有人在用', async () => {
    stubGroupBy(
      [
        { employeeId: 'emp-1', userId: null },
        { employeeId: 'emp-1', userId: 'u-1' },
      ],
      [],
      [],
    );

    const usage = (await service.forSubscriptions('ent-1', TARGETS)).get(
      'sub-1',
    );

    expect(usage?.activeUserCount30d).toBe(1);
  });

  it('本月消费与调用次数取自账单，无账单时是 0.00 而非空', async () => {
    stubGroupBy(
      [],
      [{ employeeId: 'emp-1', _sum: { costCNY: new Decimal('12.4') }, _count: 27 }],
      [],
    );

    const usage = (await service.forSubscriptions('ent-1', TARGETS)).get(
      'sub-1',
    );

    expect(usage?.monthCostCNY).toBe('12.40');
    expect(usage?.monthCallCount).toBe(27);
  });

  it('从未用过时 lastUsedAt 为 null —— 与「很久没用」区分开', async () => {
    const result = await service.forSubscriptions('ent-1', TARGETS);

    expect(result.get('sub-1')?.lastUsedAt).toBeNull();
    expect(result.get('sub-1')?.monthCostCNY).toBe('0.00');
  });

  it('lastUsedAt 取账单最大时间', async () => {
    const at = new Date('2026-09-01T10:00:00.000Z');
    stubGroupBy([], [], [{ employeeId: 'emp-1', _max: { createdAt: at } }]);

    const usage = (await service.forSubscriptions('ent-1', TARGETS)).get(
      'sub-1',
    );

    expect(usage?.lastUsedAt).toBe(at.toISOString());
  });

  it('部门授权展开成部门人数，并与直接授权去重', async () => {
    prisma.employeeGrant.findMany.mockResolvedValue([
      { subscriptionId: 'sub-1', memberId: 'm-1', departmentId: null },
      { subscriptionId: 'sub-1', memberId: null, departmentId: 'd-1' },
    ]);
    // m-1 既被直接授权、又在 d-1 里 —— 只能算一个人
    prisma.enterpriseMember.findMany.mockResolvedValue([
      { id: 'm-1', departmentId: 'd-1' },
      { id: 'm-2', departmentId: 'd-1' },
    ]);

    const usage = (await service.forSubscriptions('ent-1', TARGETS)).get(
      'sub-1',
    );

    expect(usage?.grantedUserCount).toBe(2);
  });

  it('没有部门授权时不查成员表', async () => {
    prisma.employeeGrant.findMany.mockResolvedValue([
      { subscriptionId: 'sub-1', memberId: 'm-1', departmentId: null },
    ]);

    const usage = (await service.forSubscriptions('ent-1', TARGETS)).get(
      'sub-1',
    );

    expect(usage?.grantedUserCount).toBe(1);
    expect(prisma.enterpriseMember.findMany).not.toHaveBeenCalled();
  });

  it('只统计有效授权 —— 过期授权已经不给访问权了', async () => {
    await service.forSubscriptions('ent-1', TARGETS);

    const where = prisma.employeeGrant.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gt: expect.any(Date) } },
    ]);
  });

  it('成功率四舍五入到整数百分比，并带回分母', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { employeeId: 'emp-1', total: 27, success: 26 },
    ]);

    const usage = (await service.forSubscriptions('ent-1', TARGETS)).get(
      'sub-1',
    );

    expect(usage?.successRate30d).toBe(96);
    // 分母必须一起回：4/6 和 87/100 都是 67%，只给比例前端无法判断可信度
    expect(usage?.executionCount30d).toBe(27);
  });

  it('没有执行记录时成功率为 null，不是 0；分母是 0', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    const usage = (await service.forSubscriptions('ent-1', TARGETS)).get(
      'sub-1',
    );

    expect(usage?.successRate30d).toBeNull();
    expect(usage?.executionCount30d).toBe(0);
  });

  /**
   * 成功率的窗口曾经是自然月，月初样本只有几次 —— 6 次里失败 2 次就显示成
   * 67% 的红色，同一个员工按 30 天算是 87%。这条测试锁的是窗口本身。
   */
  it('成功率按滚动 30 天算，不是自然月', async () => {
    await service.forSubscriptions('ent-1', TARGETS);

    // 原生 SQL 的插值顺序：enterpriseId、employeeIds、since
    const [, enterpriseId, employeeIds, since] =
      prisma.$queryRaw.mock.calls[0];
    expect(enterpriseId).toBe('ent-1');
    expect(employeeIds).toEqual(['emp-1']);
    const days = (Date.now() - (since as Date).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
  });

  it('全部聚合都限定在本企业内', async () => {
    await service.forSubscriptions('ent-1', TARGETS);

    for (const call of prisma.computeUsageRecord.groupBy.mock.calls) {
      expect(call[0].where.enterpriseId).toBe('ent-1');
    }
  });

  it('查询数与卡片数无关 —— 30 张卡也是 6 条', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      subscriptionId: `sub-${i}`,
      employeeId: `emp-${i}`,
    }));
    prisma.employeeGrant.findMany.mockResolvedValue([
      { subscriptionId: 'sub-0', memberId: null, departmentId: 'd-1' },
    ]);

    const result = await service.forSubscriptions('ent-1', many);

    expect(result.size).toBe(30);
    expect(prisma.computeUsageRecord.groupBy).toHaveBeenCalledTimes(3);
    expect(prisma.employeeGrant.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.enterpriseMember.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
