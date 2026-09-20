import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { subDays, format, startOfDay } from 'date-fns';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enterpriseContext: EnterpriseContextService,
  ) {}

  async getEnterpriseStats(userId: string) {
    const context = await this.enterpriseContext.resolve(userId);
    const isAdmin = context.role === 'ENTERPRISE_ADMIN';
    const { enterpriseId } = context;
    const now = new Date();
    const thirtyDaysAgo = subDays(now, 30);
    const sevenDaysAgo = subDays(now, 7);
    const firstDayThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // 成员只能看到被直接授予或按部门授予的硅基员工；管理员仍看企业全部订阅。
    const visibleSubscriptionWhere = isAdmin
      ? { enterpriseId, status: 'ACTIVE' as const }
      : {
          enterpriseId,
          status: 'ACTIVE' as const,
          grants: {
            some: {
              OR: [
                { memberId: context.memberId },
                ...(context.departmentId
                  ? [{ departmentId: context.departmentId }]
                  : []),
              ],
            },
          },
        };
    const visibleSubscriptions = await this.prisma.subscription.findMany({
      where: visibleSubscriptionWhere,
      select: { employeeId: true },
    });
    const visibleEmployeeIds = visibleSubscriptions.map((item) => item.employeeId);
    const employeeFilter = isAdmin ? undefined : { in: visibleEmployeeIds };
    const memberUserFilter = isAdmin
      ? { memberships: { some: { enterpriseId } } }
      : { id: userId };
    const memberTransactionFilter = isAdmin
      ? {}
      : { metadata: { path: ['memberId'], equals: context.memberId } };

    const totalMembers = isAdmin
      ? await this.prisma.enterpriseMember.count({ where: { enterpriseId } })
      : 0;
    const totalDepartments = isAdmin
      ? await this.prisma.department.count({ where: { enterpriseId } })
      : 0;
    const totalEmployees = visibleSubscriptions.length;

    const activeEmployeesData = await this.prisma.conversationSession.findMany({
      where: {
        createdAt: { gte: sevenDaysAgo },
        ...(employeeFilter ? { employeeId: employeeFilter } : {}),
        user: memberUserFilter,
      },
      distinct: ['employeeId'],
      select: { employeeId: true },
    });
    const activeEmployees = activeEmployeesData.length;

    const conversationsThisMonth = await this.prisma.conversationSession.count({
      where: {
        createdAt: { gte: firstDayThisMonth },
        ...(employeeFilter ? { employeeId: employeeFilter } : {}),
        user: memberUserFilter,
      },
    });
    const conversationsLastMonth = await this.prisma.conversationSession.count({
      where: {
        createdAt: { gte: firstDayLastMonth, lt: firstDayThisMonth },
        ...(employeeFilter ? { employeeId: employeeFilter } : {}),
        user: memberUserFilter,
      },
    });
    // 上月基数为 0 时无环比基准，返回 null 让前端显示 "—" 而不是误导性的 0%/-100%。
    const conversationsTrend =
      conversationsLastMonth > 0
        ? Math.round(((conversationsThisMonth - conversationsLastMonth) / conversationsLastMonth) * 100)
        : null;

    const wallet = isAdmin
      ? await this.prisma.enterpriseWallet.findUnique({ where: { enterpriseId } })
      : null;
    const balance = wallet?.balance || 0;
    const computeAccount = await this.prisma.computeAccount.findUnique({
      where: { enterpriseId },
    });

    const computeThisMonth = await this.prisma.computeTransaction.aggregate({
      where: {
        accountId: computeAccount?.id || '',
        type: 'CONSUME',
        createdAt: { gte: firstDayThisMonth },
        ...memberTransactionFilter,
      },
      _sum: { amount: true },
    });
    const computeLastMonth = await this.prisma.computeTransaction.aggregate({
      where: {
        accountId: computeAccount?.id || '',
        type: 'CONSUME',
        createdAt: { gte: firstDayLastMonth, lt: firstDayThisMonth },
        ...memberTransactionFilter,
      },
      _sum: { amount: true },
    });
    const computeThisMonthTotal = Math.abs(Number(computeThisMonth._sum.amount || 0));
    const computeLastMonthTotal = Math.abs(Number(computeLastMonth._sum.amount || 0));
    const computeTrend =
      computeLastMonthTotal > 0
        ? Math.round(((computeThisMonthTotal - computeLastMonthTotal) / computeLastMonthTotal) * 100)
        : null;

    const sessionTrendRows = await this.prisma.conversationSession.findMany({
      where: {
        createdAt: { gte: thirtyDaysAgo },
        ...(employeeFilter ? { employeeId: employeeFilter } : {}),
        user: memberUserFilter,
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const computeTrendRows = await this.prisma.computeTransaction.findMany({
      where: {
        accountId: computeAccount?.id || '',
        createdAt: { gte: thirtyDaysAgo },
        type: 'CONSUME',
        ...memberTransactionFilter,
      },
      select: { createdAt: true, amount: true, metadata: true },
      orderBy: { createdAt: 'asc' },
    });
    const trendMap = new Map<string, { date: string; conversations: number; compute: number }>();
    for (let i = 29; i >= 0; i--) {
      const date = format(startOfDay(subDays(now, i)), 'yyyy-MM-dd');
      trendMap.set(date, { date, conversations: 0, compute: 0 });
    }
    sessionTrendRows.forEach((row) => {
      const item = trendMap.get(format(new Date(row.createdAt), 'yyyy-MM-dd'));
      if (item) item.conversations += 1;
    });
    computeTrendRows.forEach((row) => {
      const item = trendMap.get(format(new Date(row.createdAt), 'yyyy-MM-dd'));
      if (item) item.compute += Math.abs(Number(row.amount || 0));
    });

    const topEmployeeSessions = await this.prisma.conversationSession.findMany({
      where: {
        createdAt: { gte: thirtyDaysAgo },
        ...(employeeFilter ? { employeeId: employeeFilter } : {}),
        user: memberUserFilter,
      },
      select: { employeeId: true, employee: { select: { name: true } } },
    });
    const employeeStats = new Map<string, { name: string; conversations: number; compute: number }>();
    topEmployeeSessions.forEach((row) => {
      const current = employeeStats.get(row.employeeId) ?? {
        name: row.employee.name,
        conversations: 0,
        compute: 0,
      };
      current.conversations += 1;
      employeeStats.set(row.employeeId, current);
    });
    computeTrendRows.forEach((row: any) => {
      const employeeId = row.metadata?.employeeId;
      const current = employeeId ? employeeStats.get(employeeId) : undefined;
      if (current) current.compute += Math.abs(Number(row.amount || 0));
    });
    const topEmployees = Array.from(employeeStats.entries())
      .sort((a, b) => b[1].conversations - a[1].conversations)
      .slice(0, 5)
      .map(([id, value]) => ({ id, name: value.name, conversations: value.conversations, compute: value.compute }));

    return {
      scope: isAdmin ? 'enterprise' : 'member',
      stats: {
        totalEmployees,
        activeEmployees,
        totalDepartments,
        totalMembers,
        conversations: { total: conversationsThisMonth, trend: conversationsTrend },
        computeUsage: { total: computeThisMonthTotal, trend: computeTrend },
        // 普通成员不应获得企业钱包余额。
        balance: Number(balance),
      },
      usageTrend: Array.from(trendMap.values()),
      topEmployees,
    };
  }
}
