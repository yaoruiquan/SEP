import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { EnterpriseContextService } from "./enterprise-context.service";

@Injectable()
export class EnterpriseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: EnterpriseContextService,
  ) {}

  /**
   * 获取当前用户所属企业的详细信息
   */
  async getEnterpriseInfo(userId: string) {
    const context = await this.ctx.resolve(userId);
    const { enterpriseId } = context;

    const enterprise = await this.prisma.enterprise.findUnique({
      where: { id: enterpriseId },
      select: {
        id: true,
        name: true,
        description: true,
        logo: true,
        metadata: true,
        createdAt: true,
        _count: {
          select: {
            members: true,
            departments: true,
            instances: true,
            subscriptions: true,
          },
        },
      },
    });

    if (!enterprise) {
      throw new Error('Enterprise not found');
    }

    return enterprise;
  }

  /**
   * 标记新手引导已完成
   */
  async markOnboardingCompleted(userId: string) {
    const context = await this.ctx.resolve(userId);
    const { enterpriseId } = context;

    const enterprise = await this.prisma.enterprise.findUnique({
      where: { id: enterpriseId },
      select: { metadata: true },
    });

    const metadata = (enterprise?.metadata as any) || {};

    await this.prisma.enterprise.update({
      where: { id: enterpriseId },
      data: {
        metadata: {
          ...metadata,
          onboardingCompleted: true,
        },
      },
    });

    return { success: true };
  }

  /**
   * 获取 Dashboard 统计数据
   */
  async getDashboardStats(userId: string) {
    const context = await this.ctx.resolve(userId);
    const { enterpriseId } = context;

    // 获取企业的计算账户
    const account = await this.prisma.computeAccount.findUnique({
      where: { enterpriseId },
      select: { id: true },
    });

    if (!account) {
      // 企业还没有计算账户，返回空数据
      return {
        employeeCount: 0,
        memberCount: 0,
        monthlySpend: 0,
        callCount: 0,
        spendTrend: [],
        topEmployees: [],
        recentActivities: [],
      };
    }

    // 1. 关键指标
    const [employeeCount, memberCount, callCount] = await Promise.all([
      // 员工实例数
      this.prisma.employeeInstance.count({
        where: { enterpriseId, status: "ACTIVE" },
      }),
      // 成员数
      this.prisma.enterpriseMember.count({
        where: { enterpriseId },
      }),
      // 本月调用次数（从 ComputeTransaction metadata 统计）
      this.prisma.computeTransaction.count({
        where: {
          accountId: account.id,
          type: "CONSUME",
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      }),
    ]);

    // 本月消费
    const monthlyTransactions = await this.prisma.computeTransaction.findMany({
      where: {
        accountId: account.id,
        type: "CONSUME",
        createdAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        },
      },
      select: { amount: true },
    });
    const monthlySpend = Math.abs(
      monthlyTransactions.reduce((sum, t) => sum + t.amount, 0),
    );

    // 2. 消费趋势（最近 30 天）
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const spendTrendData = await this.prisma.computeTransaction.findMany({
      where: {
        accountId: account.id,
        type: "CONSUME",
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { amount: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    // 按日聚合
    const spendByDate = new Map<string, number>();
    spendTrendData.forEach((t) => {
      const date = t.createdAt.toISOString().split("T")[0];
      const current = spendByDate.get(date) || 0;
      spendByDate.set(date, current + Math.abs(t.amount));
    });

    const spendTrend = Array.from(spendByDate.entries())
      .map(([date, amount]) => ({ date, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // 3. 热门员工 Top 5（按调用次数）
    const topEmployees = await this.prisma.computeTransaction.findMany({
      where: {
        accountId: account.id,
        type: "CONSUME",
        metadata: { path: ["instanceId"], not: null },
      },
      select: { metadata: true },
    });

    // 统计每个 instanceId 的调用次数
    const instanceCallCount = new Map<string, number>();
    topEmployees.forEach((t: any) => {
      const instanceId = t.metadata?.instanceId;
      if (instanceId) {
        instanceCallCount.set(instanceId, (instanceCallCount.get(instanceId) || 0) + 1);
      }
    });

    // 取 Top 5
    const topInstanceIds = Array.from(instanceCallCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);

    const topInstancesData = await this.prisma.employeeInstance.findMany({
      where: { id: { in: topInstanceIds }, enterpriseId },
      select: { id: true, name: true },
    });

    const topEmployeesResult = topInstancesData.map((inst) => ({
      id: inst.id,
      name: inst.name,
      calls: instanceCallCount.get(inst.id) || 0,
    }));

    // 4. 最近活动（最近 10 条消费记录）
    const recentActivities = await this.prisma.computeTransaction.findMany({
      where: {
        accountId: account.id,
        type: "CONSUME",
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        createdAt: true,
        metadata: true,
      },
    });

    const activities = await Promise.all(
      recentActivities.map(async (activity: any) => {
        const instanceId = activity.metadata?.instanceId;
        const memberId = activity.metadata?.memberId;

        const [instance, member] = await Promise.all([
          instanceId
            ? this.prisma.employeeInstance.findUnique({
                where: { id: instanceId },
                select: { name: true },
              })
            : null,
          memberId
            ? this.prisma.enterpriseMember.findUnique({
                where: { id: memberId },
                include: { user: { select: { name: true } } },
              })
            : null,
        ]);

        return {
          type: "consume",
          actor: member?.user.name || "未知成员",
          target: instance?.name || "未知员工",
          time: activity.createdAt.toISOString(),
        };
      }),
    );

    return {
      employeeCount,
      memberCount,
      monthlySpend: Math.round(monthlySpend * 100) / 100,
      callCount,
      spendTrend,
      topEmployees: topEmployeesResult,
      recentActivities: activities,
    };
  }
}
