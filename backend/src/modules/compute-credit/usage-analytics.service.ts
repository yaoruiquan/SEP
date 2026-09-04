import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';

/** 一个维度上的一行花费分布。 */
export interface BreakdownRow {
  key: string;
  label: string;
  /** 头像 / logo，仅硅基员工维度有 */
  avatar?: string | null;
  /** 次要说明，例如成员所属部门、部门下的人数 */
  hint?: string | null;
  costCNY: string;
  callCount: number;
  /** 占区间总花费的百分比（0–100，一位小数） */
  pct: number;
}

export interface UsageBreakdown {
  rangeDays: number;
  totalCNY: string;
  /** 上一个等长区间的总花费，用于环比 */
  prevTotalCNY: string;
  /** 环比变化百分比。上期为 0 时为 null（除不出有意义的倍数） */
  deltaPct: number | null;
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  trend: Array<{ date: string; costCNY: string }>;
  byModel: BreakdownRow[];
  byDepartment: BreakdownRow[];
  byMember: BreakdownRow[];
  byEmployee: BreakdownRow[];
}

const ALLOWED_RANGES = [7, 30, 90] as const;

function pct(part: Decimal, total: Decimal): number {
  if (total.lessThanOrEqualTo(0)) return 0;
  return Math.round(part.div(total).toNumber() * 1000) / 10;
}

function sortDesc(rows: BreakdownRow[]): BreakdownRow[] {
  return rows.sort((a, b) => Number(b.costCNY) - Number(a.costCNY));
}

/**
 * 用量分析 —— 花出去的钱在**模型 / 部门 / 碳基员工 / 硅基员工**之间怎么分布。
 *
 * 与「算力余额」页的分工：那一页回答「还剩多少、怎么分的、每一笔花在哪」，
 * 这一页只回答「已经花掉的钱，分布长什么样」。所以这里没有余额、没有逐笔账单。
 *
 * 两种视角共用这一个方法：企业管理员看全企业，普通成员只看自己
 * （`memberUserId`，此时「按碳基员工 / 按部门」为空）。
 *
 * 一个接口返回全部维度：四个维度分开打接口会让这一页发五次请求，
 * 而它们读的是同一张表的同一个时间区间 —— 合成一次，前端也不必对齐区间。
 * 所有聚合都在 SQL 层完成，查询数与成员/模型数量无关。
 */
@Injectable()
export class UsageAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param memberUserId 传了 = 只统计这一个人自己的花费。
   *
   * 这个参数不是筛选器，是**作用域**：控制器在调用方不是企业管理员时强制填上
   * 他自己的 userId，成员因此永远看不到别人的账。它不来自 query —— 否则
   * 「传谁的 id 就看谁的账」，等于没有隔离。
   */
  async getBreakdown(
    enterpriseId: string,
    days = 30,
    memberUserId?: string,
  ): Promise<UsageBreakdown> {
    const rangeDays = (ALLOWED_RANGES as readonly number[]).includes(days)
      ? days
      : 30;
    const scoped = !!memberUserId;
    const mine = scoped ? { userId: memberUserId } : {};

    const since = new Date();
    since.setDate(since.getDate() - rangeDays);
    // 上一个等长区间，用于环比。刻意不用「上个自然月」——
    // 区间可切成 7/30/90 天，跟自然月对不上，环比必须跟当前区间同长度。
    const prevSince = new Date(since);
    prevSince.setDate(prevSince.getDate() - rangeDays);

    const where = { enterpriseId, createdAt: { gte: since }, ...mine };

    const [agg, prevAgg, byModelRaw, byMemberRaw, byEmployeeRaw, trendRaw] =
      await Promise.all([
        this.prisma.computeUsageRecord.aggregate({
          where,
          _sum: { costCNY: true, inputTokens: true, outputTokens: true },
          _count: true,
        }),
        this.prisma.computeUsageRecord.aggregate({
          where: {
            enterpriseId,
            createdAt: { gte: prevSince, lt: since },
            ...mine,
          },
          _sum: { costCNY: true },
        }),
        this.prisma.computeUsageRecord.groupBy({
          by: ['modelId'],
          where,
          _sum: { costCNY: true },
          _count: true,
        }),
        this.prisma.computeUsageRecord.groupBy({
          by: ['userId'],
          where,
          _sum: { costCNY: true },
          _count: true,
        }),
        this.prisma.computeUsageRecord.groupBy({
          by: ['employeeId'],
          where,
          _sum: { costCNY: true },
          _count: true,
        }),
        this.prisma.$queryRaw<Array<{ date: Date; amount: string }>>`
          SELECT DATE(cur."createdAt") as date, SUM(cur."costCNY") as amount
          FROM compute_usage_records cur
          WHERE cur."enterpriseId" = ${enterpriseId}
            AND cur."createdAt" >= ${since}
            ${scoped ? Prisma.sql`AND cur."userId" = ${memberUserId}` : Prisma.empty}
          GROUP BY DATE(cur."createdAt")
          ORDER BY date ASC
        `,
      ]);

    const total = agg._sum.costCNY ?? new Decimal(0);
    const prevTotal = prevAgg._sum.costCNY ?? new Decimal(0);

    const [members, employees] = await Promise.all([
      // 成员视角不出「按碳基员工 / 按部门」，成员名与部门名都用不上，省一次查询
      scoped
        ? Promise.resolve(
            new Map<string, { name: string; departmentName: string | null }>(),
          )
        : this.loadMembers(
            enterpriseId,
            byMemberRaw.map((r) => r.userId).filter((id): id is string => !!id),
          ),
      this.loadEmployees(
        byEmployeeRaw.map((r) => r.employeeId).filter((id): id is string => !!id),
      ),
    ]);

    return {
      rangeDays,
      totalCNY: total.toFixed(4),
      prevTotalCNY: prevTotal.toFixed(4),
      deltaPct: prevTotal.greaterThan(0)
        ? Math.round(total.sub(prevTotal).div(prevTotal).toNumber() * 1000) / 10
        : null,
      callCount: agg._count,
      inputTokens: agg._sum.inputTokens ?? 0,
      outputTokens: agg._sum.outputTokens ?? 0,
      trend: trendRaw.map((t) => ({
        // DATE() 回来的是 Date 对象，取 ISO 的日期段即可（图表按天画）
        date: new Date(t.date).toISOString().slice(0, 10),
        costCNY: new Decimal(t.amount ?? 0).toFixed(4),
      })),
      byModel: sortDesc(
        byModelRaw.map((r) => {
          const cost = r._sum.costCNY ?? new Decimal(0);
          return {
            key: r.modelId,
            label: r.modelId,
            costCNY: cost.toFixed(4),
            callCount: r._count,
            pct: pct(cost, total),
          };
        }),
      ),
      /*
        「按碳基员工 / 按部门」是管理信息：谁花得多、哪个部门超支，普通成员看不得。
        成员视角下这两个维度返回空数组，前端据此不渲染这两块。

        空数组而不是删字段：UsageBreakdown 的形状不变，前端不必维护两套类型；
        「有没有权限看」由后端说了算，前端只是不画。
      */
      byMember: scoped
        ? []
        : sortDesc(
            byMemberRaw.map((r) => {
              const cost = r._sum.costCNY ?? new Decimal(0);
              const m = r.userId ? members.get(r.userId) : undefined;
              return {
                key: r.userId ?? 'unknown',
                // 记录里 userId 可为空（系统内部调用、成员已离职被 SetNull）
                label: m?.name ?? (r.userId ? '已离职成员' : '系统调用'),
                hint: m?.departmentName ?? null,
                costCNY: cost.toFixed(4),
                callCount: r._count,
                pct: pct(cost, total),
              };
            }),
          ),
      byDepartment: scoped
        ? []
        : sortDesc(this.rollUpDepartments(byMemberRaw, members, total)),
      byEmployee: sortDesc(
        byEmployeeRaw.map((r) => {
          const cost = r._sum.costCNY ?? new Decimal(0);
          const e = r.employeeId ? employees.get(r.employeeId) : undefined;
          return {
            key: r.employeeId ?? 'unknown',
            label: e?.name ?? '已下架员工',
            avatar: e?.avatar ?? null,
            costCNY: cost.toFixed(4),
            callCount: r._count,
            pct: pct(cost, total),
          };
        }),
      ),
    };
  }

  /**
   * 部门维度由成员维度上卷得出，不再打一次库：
   * 账单上没有 departmentId，成员换部门后历史账单归属新部门 ——
   * 这是刻意的，管理员问的是「现在这个部门花了多少」。
   */
  private rollUpDepartments(
    byMemberRaw: Array<{
      userId: string | null;
      _sum: { costCNY: Decimal | null };
      _count: number;
    }>,
    members: Map<string, { name: string; departmentName: string | null }>,
    total: Decimal,
  ): BreakdownRow[] {
    const acc = new Map<
      string,
      { label: string; cost: Decimal; calls: number; people: Set<string> }
    >();

    for (const row of byMemberRaw) {
      const m = row.userId ? members.get(row.userId) : undefined;
      const label = m?.departmentName ?? '未分配部门';
      const entry =
        acc.get(label) ??
        { label, cost: new Decimal(0), calls: 0, people: new Set<string>() };
      entry.cost = entry.cost.add(row._sum.costCNY ?? new Decimal(0));
      entry.calls += row._count;
      if (row.userId) entry.people.add(row.userId);
      acc.set(label, entry);
    }

    return [...acc.values()].map((e) => ({
      key: e.label,
      label: e.label,
      hint: `${e.people.size} 人在用`,
      costCNY: e.cost.toFixed(4),
      callCount: e.calls,
      pct: pct(e.cost, total),
    }));
  }

  private async loadMembers(enterpriseId: string, userIds: string[]) {
    if (userIds.length === 0) return new Map<string, never>();
    const rows = await this.prisma.enterpriseMember.findMany({
      where: { enterpriseId, userId: { in: userIds } },
      select: {
        userId: true,
        user: { select: { name: true, email: true } },
        department: { select: { name: true } },
      },
    });
    return new Map(
      rows.map((r) => [
        r.userId,
        {
          name: r.user.name ?? r.user.email,
          departmentName: r.department?.name ?? null,
        },
      ]),
    );
  }

  private async loadEmployees(employeeIds: string[]) {
    if (employeeIds.length === 0) return new Map<string, never>();
    const rows = await this.prisma.digitalEmployee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, name: true, avatar: true },
    });
    return new Map(rows.map((r) => [r.id, { name: r.name, avatar: r.avatar }]));
  }
}
