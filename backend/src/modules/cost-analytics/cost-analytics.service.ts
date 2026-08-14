import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { startOfDay, endOfDay, subDays, startOfMonth, format } from 'date-fns';
import type { CostSummary, CostByDimensionItem, CostTrendPoint } from 'shared';

@Injectable()
export class CostAnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * 成本概览：总花费、预算使用率、环比
   */
  async getSummary(
    enterpriseId: string,
    from?: Date,
    to?: Date,
  ): Promise<CostSummary> {
    const periodStart = from ?? startOfMonth(new Date());
    const periodEnd = to ?? endOfDay(new Date());

    // 当期成本
    const current = await this.prisma.costDailyRollup.aggregate({
      where: { enterpriseId, date: { gte: periodStart, lte: periodEnd } },
      _sum: { costCNY: true },
    });

    // 预算
    const modelConfig = await this.prisma.enterpriseModelConfig.findUnique({
      where: { enterpriseId },
      select: { monthlyBudgetCNY: true, alertThreshold: true },
    });

    const totalCost = Number(current._sum.costCNY ?? 0);
    const budgetCNY = modelConfig?.monthlyBudgetCNY
      ? Number(modelConfig.monthlyBudgetCNY)
      : null;
    const budgetUsagePercent =
      budgetCNY ? (totalCost / budgetCNY) * 100 : null;

    // 环比（前一周期同长度）
    const periodDays = Math.ceil(
      (periodEnd.getTime() - periodStart.getTime()) / 86400000,
    );
    const compStart = subDays(periodStart, periodDays);
    const compEnd = subDays(periodEnd, periodDays);
    const comparison = await this.prisma.costDailyRollup.aggregate({
      where: { enterpriseId, date: { gte: compStart, lte: compEnd } },
      _sum: { costCNY: true },
    });
    const comparisonPeriodCost = Number(comparison._sum.costCNY ?? 0);
    const changePercent =
      comparisonPeriodCost > 0
        ? ((totalCost - comparisonPeriodCost) / comparisonPeriodCost) * 100
        : 0;

    return {
      totalCost,
      budgetCNY,
      budgetUsagePercent,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      comparisonPeriodCost,
      changePercent,
    };
  }

  /**
   * 按部门归因
   */
  async getByDepartment(
    enterpriseId: string,
    from?: Date,
    to?: Date,
  ): Promise<CostByDimensionItem[]> {
    const periodStart = from ?? startOfMonth(new Date());
    const periodEnd = to ?? endOfDay(new Date());

    const rows = await this.prisma.costDailyRollup.groupBy({
      by: ['departmentId'],
      where: {
        enterpriseId,
        date: { gte: periodStart, lte: periodEnd },
        departmentId: { not: null },
      },
      _sum: {
        costCNY: true,
        inputTokens: true,
        outputTokens: true,
        messageCount: true,
      },
    });

    // 补充部门名称
    const deptIds = rows.map((r) => r.departmentId!);
    const depts = await this.prisma.department.findMany({
      where: { id: { in: deptIds } },
      select: { id: true, name: true },
    });
    const deptMap = Object.fromEntries(depts.map((d) => [d.id, d.name]));

    const total = rows.reduce((sum, r) => sum + Number(r._sum.costCNY ?? 0), 0);

    return rows.map((r) => ({
      id: r.departmentId!,
      name: deptMap[r.departmentId!] ?? '未知部门',
      cost: Number(r._sum.costCNY ?? 0),
      percent: total > 0 ? (Number(r._sum.costCNY ?? 0) / total) * 100 : 0,
      messageCount: r._sum.messageCount ?? 0,
      inputTokens: Number(r._sum.inputTokens ?? 0),
      outputTokens: Number(r._sum.outputTokens ?? 0),
    }));
  }

  /**
   * 按员工（User）归因 — 从 messages 实时聚合（rollup 暂无 userId 维度）
   */
  async getByEmployee(
    enterpriseId: string,
    from?: Date,
    to?: Date,
    limit = 20,
  ): Promise<CostByDimensionItem[]> {
    const periodStart = from ?? startOfMonth(new Date());
    const periodEnd = to ?? endOfDay(new Date());

    // messages → sessions → users → enterprise_members（企业过滤）
    const rows = await this.prisma.$queryRaw<
      {
        userId: string;
        userName: string | null;
        userEmail: string;
        cost: number;
        messageCount: number;
        inputTokens: number;
        outputTokens: number;
      }[]
    >`
      SELECT
        u.id            AS "userId",
        u.name          AS "userName",
        u.email         AS "userEmail",
        COALESCE(SUM(m.cost), 0)::float           AS "cost",
        COUNT(m.id)::int                          AS "messageCount",
        COALESCE(SUM(m."inputTokens"), 0)::int     AS "inputTokens",
        COALESCE(SUM(m."outputTokens"), 0)::int    AS "outputTokens"
      FROM messages m
      JOIN conversation_sessions cs ON cs.id = m."sessionId"
      JOIN users u ON u.id = cs."userId"
      JOIN enterprise_members em ON em."userId" = u.id AND em."enterpriseId" = ${enterpriseId}
      WHERE m.role = 'ASSISTANT'
        AND m.cost IS NOT NULL
        AND m."createdAt" >= ${periodStart}
        AND m."createdAt" <= ${periodEnd}
      GROUP BY u.id, u.name, u.email
      ORDER BY "cost" DESC
      LIMIT ${limit}
    `;

    const total = rows.reduce((sum, r) => sum + r.cost, 0);
    return rows.map((r) => ({
      id: r.userId,
      name: r.userName ?? r.userEmail,
      cost: r.cost,
      percent: total > 0 ? (r.cost / total) * 100 : 0,
      messageCount: r.messageCount,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
    }));
  }

  /**
   * 按模型归因
   */
  async getByModel(
    enterpriseId: string,
    from?: Date,
    to?: Date,
  ): Promise<CostByDimensionItem[]> {
    const periodStart = from ?? startOfMonth(new Date());
    const periodEnd = to ?? endOfDay(new Date());

    const rows = await this.prisma.costDailyRollup.groupBy({
      by: ['modelId'],
      where: { enterpriseId, date: { gte: periodStart, lte: periodEnd } },
      _sum: {
        costCNY: true,
        inputTokens: true,
        outputTokens: true,
        messageCount: true,
      },
    });

    const total = rows.reduce((sum, r) => sum + Number(r._sum.costCNY ?? 0), 0);

    return rows
      .sort((a, b) => Number(b._sum.costCNY ?? 0) - Number(a._sum.costCNY ?? 0))
      .map((r) => ({
        id: r.modelId,
        name: r.modelId,
        cost: Number(r._sum.costCNY ?? 0),
        percent: total > 0 ? (Number(r._sum.costCNY ?? 0) / total) * 100 : 0,
        messageCount: r._sum.messageCount ?? 0,
        inputTokens: Number(r._sum.inputTokens ?? 0),
        outputTokens: Number(r._sum.outputTokens ?? 0),
      }));
  }

  /**
   * 成本趋势（按天 / 周 / 月）
   */
  async getTrend(
    enterpriseId: string,
    granularity: 'day' | 'week' | 'month' = 'day',
    from?: Date,
    to?: Date,
  ): Promise<CostTrendPoint[]> {
    const periodEnd = to ?? endOfDay(new Date());
    const defaultDays = granularity === 'day' ? 30 : granularity === 'week' ? 84 : 365;
    const periodStart = from ?? subDays(periodEnd, defaultDays);

    const rows = await this.prisma.costDailyRollup.findMany({
      where: { enterpriseId, date: { gte: periodStart, lte: periodEnd } },
      orderBy: { date: 'asc' },
      select: { date: true, costCNY: true, messageCount: true },
    });

    if (granularity === 'day') {
      return rows.map((r) => ({
        date: format(r.date, 'yyyy-MM-dd'),
        cost: Number(r.costCNY),
        messageCount: r.messageCount,
      }));
    }

    // 聚合到周或月
    const buckets = new Map<string, { cost: number; messageCount: number }>();
    for (const r of rows) {
      const key =
        granularity === 'week'
          ? format(r.date, "yyyy-'W'ww")
          : format(r.date, 'yyyy-MM');
      const cur = buckets.get(key) ?? { cost: 0, messageCount: 0 };
      buckets.set(key, {
        cost: cur.cost + Number(r.costCNY),
        messageCount: cur.messageCount + r.messageCount,
      });
    }

    return Array.from(buckets.entries()).map(([date, v]) => ({
      date,
      cost: v.cost,
      messageCount: v.messageCount,
    }));
  }

  /**
   * 告警列表（当月超阈值）
   */
  async getAlerts(enterpriseId: string): Promise<
    {
      type: 'BUDGET_THRESHOLD' | 'BUDGET_EXCEEDED';
      severity: 'WARNING' | 'ERROR';
      message: string;
      usagePercent: number;
    }[]
  > {
    const modelConfig = await this.prisma.enterpriseModelConfig.findUnique({
      where: { enterpriseId },
      select: {
        monthlyBudgetCNY: true,
        alertThreshold: true,
        hardStopOnBudget: true,
      },
    });

    if (!modelConfig?.monthlyBudgetCNY) return [];

    const budgetCNY = Number(modelConfig.monthlyBudgetCNY);
    const periodStart = startOfMonth(new Date());
    const agg = await this.prisma.costDailyRollup.aggregate({
      where: { enterpriseId, date: { gte: periodStart } },
      _sum: { costCNY: true },
    });
    const used = Number(agg._sum.costCNY ?? 0);
    const usagePercent = (used / budgetCNY) * 100;
    const alerts: {
      type: 'BUDGET_THRESHOLD' | 'BUDGET_EXCEEDED';
      severity: 'WARNING' | 'ERROR';
      message: string;
      usagePercent: number;
    }[] = [];

    if (usagePercent >= 100) {
      alerts.push({
        type: 'BUDGET_EXCEEDED',
        severity: 'ERROR',
        message: `本月算力预算已用尽（已用 ¥${used.toFixed(2)} / ¥${budgetCNY.toFixed(2)}）`,
        usagePercent,
      });
    } else if (usagePercent >= modelConfig.alertThreshold * 100) {
      alerts.push({
        type: 'BUDGET_THRESHOLD',
        severity: 'WARNING',
        message: `本月算力用量已达 ${usagePercent.toFixed(1)}%，接近 ¥${budgetCNY.toFixed(2)} 预算上限`,
        usagePercent,
      });
    }

    return alerts;
  }

  /**
   * 导出为 CSV（二进制 Buffer）
   */
  async exportCsv(
    enterpriseId: string,
    from?: Date,
    to?: Date,
  ): Promise<Buffer> {
    const periodStart = from ?? startOfMonth(new Date());
    const periodEnd = to ?? endOfDay(new Date());

    const rows = await this.prisma.costDailyRollup.findMany({
      where: { enterpriseId, date: { gte: periodStart, lte: periodEnd } },
      orderBy: { date: 'asc' },
    });

    // 补充部门名称
    const deptIds = [...new Set(rows.map((r) => r.departmentId).filter(Boolean) as string[])];
    const depts = await this.prisma.department.findMany({
      where: { id: { in: deptIds } },
      select: { id: true, name: true },
    });
    const deptMap = Object.fromEntries(depts.map((d) => [d.id, d.name]));

    const { write: csvWrite, format: csvFormat } = await import('fast-csv');
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = csvFormat({ headers: true });
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve());
      stream.on('error', reject);
      for (const r of rows) {
        stream.write({
          日期: format(r.date, 'yyyy-MM-dd'),
          部门: r.departmentId ? deptMap[r.departmentId] ?? r.departmentId : '（全企业）',
          模型: r.modelId,
          输入Token: r.inputTokens.toString(),
          输出Token: r.outputTokens.toString(),
          消息数: r.messageCount,
          费用CNY: Number(r.costCNY).toFixed(4),
        });
      }
      stream.end();
    });
    return Buffer.concat(chunks);
  }

  // --------------------------------------------------------------------------
  // Rollup — 供 CronService 和按需刷新调用
  // --------------------------------------------------------------------------

  /**
   * 对指定日期的消息数据做增量 upsert 到 cost_daily_rollups。
   * 若 enterpriseId 为 null，则对全部企业执行。
   */
  async runRollup(targetDate?: Date, enterpriseId?: string): Promise<void> {
    const date = targetDate ?? new Date();
    const dayStart = startOfDay(date);
    const dayEnd = endOfDay(date);

    // 聚合 messages → session → enterprise_members 维度
    type AggRow = {
      enterpriseId: string;
      departmentId: string | null;
      modelId: string;
      inputTokens: number;
      outputTokens: number;
      cost: number;
      messageCount: number;
    };

    const rows = enterpriseId
      ? await this.prisma.$queryRaw<AggRow[]>`
          SELECT
            em."enterpriseId"                       AS "enterpriseId",
            em."departmentId"                       AS "departmentId",
            COALESCE(m."modelId", 'unknown')        AS "modelId",
            COALESCE(SUM(m."inputTokens"), 0)::bigint  AS "inputTokens",
            COALESCE(SUM(m."outputTokens"), 0)::bigint AS "outputTokens",
            COALESCE(SUM(m.cost), 0)::float           AS "cost",
            COUNT(m.id)::int                          AS "messageCount"
          FROM messages m
          JOIN conversation_sessions cs ON cs.id = m."sessionId"
          JOIN enterprise_members em ON em."userId" = cs."userId"
          WHERE m.role = 'ASSISTANT'
            AND m."createdAt" >= ${dayStart}
            AND m."createdAt" <= ${dayEnd}
            AND em."enterpriseId" = ${enterpriseId}
          GROUP BY em."enterpriseId", em."departmentId", COALESCE(m."modelId", 'unknown')
        `
      : await this.prisma.$queryRaw<AggRow[]>`
          SELECT
            em."enterpriseId"                       AS "enterpriseId",
            em."departmentId"                       AS "departmentId",
            COALESCE(m."modelId", 'unknown')        AS "modelId",
            COALESCE(SUM(m."inputTokens"), 0)::bigint  AS "inputTokens",
            COALESCE(SUM(m."outputTokens"), 0)::bigint AS "outputTokens",
            COALESCE(SUM(m.cost), 0)::float           AS "cost",
            COUNT(m.id)::int                          AS "messageCount"
          FROM messages m
          JOIN conversation_sessions cs ON cs.id = m."sessionId"
          JOIN enterprise_members em ON em."userId" = cs."userId"
          WHERE m.role = 'ASSISTANT'
            AND m."createdAt" >= ${dayStart}
            AND m."createdAt" <= ${dayEnd}
          GROUP BY em."enterpriseId", em."departmentId", COALESCE(m."modelId", 'unknown')
        `;

    for (const r of rows) {
      await this.prisma.costDailyRollup.upsert({
        where: {
          enterpriseId_departmentId_subscriptionId_modelId_date: {
            enterpriseId: r.enterpriseId,
            departmentId: r.departmentId,
            subscriptionId: null,
            modelId: r.modelId,
            date: dayStart,
          },
        },
        create: {
          enterpriseId: r.enterpriseId,
          departmentId: r.departmentId,
          subscriptionId: null,
          modelId: r.modelId,
          date: dayStart,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          costCNY: r.cost,
          messageCount: r.messageCount,
        },
        update: {
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          costCNY: r.cost,
          messageCount: r.messageCount,
        },
      });
    }
  }
}
