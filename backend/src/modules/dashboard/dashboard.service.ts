import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { subDays, format, startOfDay } from 'date-fns';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getEnterpriseStats(userId: string) {
    // 获取用户所属企业
    const enterpriseMember = await this.prisma.enterpriseMember.findFirst({
      where: { userId },
      include: { enterprise: true },
    });

    if (!enterpriseMember) {
      throw new Error('用户不属于任何企业');
    }

    const enterpriseId = enterpriseMember.enterprise.id;
    const now = new Date();
    const thirtyDaysAgo = subDays(now, 30);
    const sevenDaysAgo = subDays(now, 7);

    // 1. 统计企业成员数
    const totalMembers = await this.prisma.enterpriseMember.count({
      where: { enterpriseId },
    });

    // 2. 统计企业已订阅的硅基员工数（总数和活跃数）
    const totalEmployees = await this.prisma.subscription.count({
      where: { enterpriseId, status: 'ACTIVE' },
    });

    // 活跃员工：近7天有对话的员工
    const activeEmployeesData = await this.prisma.conversationSession.findMany({
      where: {
        createdAt: { gte: sevenDaysAgo },
        user: {
          memberships: {
            some: { enterpriseId },
          },
        },
      },
      distinct: ['employeeId'],
      select: { employeeId: true },
    });
    const activeEmployees = activeEmployeesData.length;

    // 3. 统计部门数
    const totalDepartments = await this.prisma.department.count({
      where: { enterpriseId },
    });

    // 4. 统计本月对话数和上月对话数（用于计算趋势）
    const firstDayThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const conversationsThisMonth = await this.prisma.conversationSession.count({
      where: {
        createdAt: { gte: firstDayThisMonth },
        user: {
          memberships: {
            some: { enterpriseId },
          },
        },
      },
    });

    const conversationsLastMonth = await this.prisma.conversationSession.count({
      where: {
        createdAt: { gte: firstDayLastMonth, lt: firstDayThisMonth },
        user: {
          memberships: {
            some: { enterpriseId },
          },
        },
      },
    });

    const conversationsTrend =
      conversationsLastMonth > 0
        ? Math.round(
            ((conversationsThisMonth - conversationsLastMonth) /
              conversationsLastMonth) *
              100,
          )
        : 0;

    // 5. 获取企业钱包余额
    const wallet = await this.prisma.enterpriseWallet.findUnique({
      where: { enterpriseId },
    });
    const balance = wallet?.balance || 0;

    // 6. 统计本月算力消耗和上月消耗（用于计算趋势）
    const computeAccount = await this.prisma.computeAccount.findUnique({
      where: { enterpriseId },
    });

    const computeThisMonth = await this.prisma.computeTransaction.aggregate({
      where: {
        accountId: computeAccount?.id || '',
        type: 'CONSUME',
        createdAt: { gte: firstDayThisMonth },
      },
      _sum: { amount: true },
    });

    const computeLastMonth = await this.prisma.computeTransaction.aggregate({
      where: {
        accountId: computeAccount?.id || '',
        type: 'CONSUME',
        createdAt: { gte: firstDayLastMonth, lt: firstDayThisMonth },
      },
      _sum: { amount: true },
    });

    const computeThisMonthTotal = Math.abs(
      Number(computeThisMonth._sum.amount || 0),
    );
    const computeLastMonthTotal = Math.abs(
      Number(computeLastMonth._sum.amount || 0),
    );

    const computeTrend =
      computeLastMonthTotal > 0
        ? Math.round(
            ((computeThisMonthTotal - computeLastMonthTotal) /
              computeLastMonthTotal) *
              100,
          )
        : 0;

    // 7. 近30天对话趋势（按天聚合）
    const sessionTrend = await this.prisma.$queryRaw<
      Array<{ date: string; count: bigint }>
    >`
      SELECT
        DATE(cs."createdAt") as date,
        COUNT(*)::bigint as count
      FROM conversation_sessions cs
      INNER JOIN users u ON cs."userId" = u.id
      INNER JOIN enterprise_members em ON u.id = em."userId"
      WHERE em."enterpriseId" = ${enterpriseId}
        AND cs."createdAt" >= ${thirtyDaysAgo}
      GROUP BY DATE(cs."createdAt")
      ORDER BY date ASC
    `;

    // 8. 近30天算力消耗趋势（按天聚合）
    const computeTrendRaw = await this.prisma.$queryRaw<
      Array<{ date: string; amount: bigint }>
    >`
      SELECT
        DATE(ct."createdAt") as date,
        SUM(ABS(ct.amount))::bigint as amount
      FROM compute_transactions ct
      WHERE ct."accountId" = ${computeAccount?.id || ''}
        AND ct."createdAt" >= ${thirtyDaysAgo}
        AND ct.type = 'CONSUME'
      GROUP BY DATE(ct."createdAt")
      ORDER BY date ASC
    `;

    // 构造完整的30天数据
    const trendMap = new Map<
      string,
      { date: string; conversations: number; compute: number }
    >();
    for (let i = 29; i >= 0; i--) {
      const date = format(startOfDay(subDays(now, i)), 'yyyy-MM-dd');
      trendMap.set(date, { date, conversations: 0, compute: 0 });
    }

    sessionTrend.forEach((row) => {
      const dateStr = format(new Date(row.date), 'yyyy-MM-dd');
      const existing = trendMap.get(dateStr);
      if (existing) {
        existing.conversations = Number(row.count);
      }
    });

    computeTrendRaw.forEach((row) => {
      const dateStr = format(new Date(row.date), 'yyyy-MM-dd');
      const existing = trendMap.get(dateStr);
      if (existing) {
        existing.compute = Number(row.amount);
      }
    });

    const usageTrend = Array.from(trendMap.values());

    // 9. 员工使用排行（前5名）
    // 9. 员工使用排行（前5名）
    const topEmployeesRaw = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; sessions: bigint }>
    >`
      SELECT
        de.id,
        de.name,
        COUNT(cs.id)::bigint as sessions
      FROM digital_employees de
      INNER JOIN conversation_sessions cs ON de.id = cs."employeeId"
      INNER JOIN users u ON cs."userId" = u.id
      INNER JOIN enterprise_members em ON u.id = em."userId"
      WHERE em."enterpriseId" = ${enterpriseId}
        AND cs."createdAt" >= ${thirtyDaysAgo}
      GROUP BY de.id, de.name
      ORDER BY sessions DESC
      LIMIT 5
    `;

    // 获取每个员工的算力消耗
    const topEmployees = await Promise.all(
      topEmployeesRaw.map(async (emp) => {
        const computeUsed = await this.prisma.computeTransaction.aggregate({
          where: {
            accountId: computeAccount?.id || '',
            type: 'CONSUME',
            metadata: {
              path: ['employeeId'],
              equals: emp.id,
            },
            createdAt: { gte: thirtyDaysAgo },
          },
          _sum: { amount: true },
        });

        return {
          id: emp.id,
          name: emp.name,
          conversations: Number(emp.sessions),
          compute: Math.abs(Number(computeUsed._sum.amount || 0)),
        };
      }),
    );

    return {
      stats: {
        totalEmployees,
        activeEmployees,
        totalDepartments,
        totalMembers,
        conversations: {
          total: conversationsThisMonth,
          trend: conversationsTrend,
        },
        computeUsage: {
          total: computeThisMonthTotal,
          trend: computeTrend,
        },
        balance: Number(balance),
      },
      usageTrend,
      topEmployees,
    };
  }
}
