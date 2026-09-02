import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';

/** 一位碳基员工的算力分配情况。金额一律元，Decimal 序列化为字符串。 */
export interface MemberAllowanceView {
  userId: string;
  name: string;
  email: string;
  departmentName: string | null;
  /** null = 未分配额度（不限额） */
  limitCNY: string | null;
  enabled: boolean;
  /** 本周期已消耗（元） */
  usedCNY: string;
  /** 本周期还能花多少（元）。不限额时为 null */
  remainingCNY: string | null;
  /** 已用占上限的百分比（0–100）。不限额时为 null */
  usedPct: number | null;
  /** 本周期结束、额度重置的时刻 */
  resetAt: string;
}

export interface AllowanceCheckResult {
  allowed: boolean;
  reason?: string;
}

/** 当前自然月的起止。与 getOverview 的「本月消费」同一口径，两处数字才对得上。 */
function currentPeriod(): { start: Date; end: Date } {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

/**
 * 算力分配 —— 给碳基员工设本周期的算力消费上限。
 *
 * 这是**闸门**不是钱包：分配 ¥500 不会从企业算力余额里预先划走钱，
 * 只在这位成员本周期已花到 ¥500 时拦下他的下一次对话。所以：
 *   · 给 10 个人各分 ¥500 而企业只有 ¥3000，不是超分，只是三个人先花完
 *   · 分配不限定用在哪位硅基员工上
 *   · 取消某人对某员工的授权，他的额度数字不变（权限与额度互相独立）
 *
 * 已用金额直接对账单聚合，没有单独的周期计数表。代价是每轮对话多一次
 * 范围聚合（已加 `[userId, createdAt]` 索引），换来的是不必维护周期边界的
 * 结转/补偿逻辑 —— 结转、按天/季/年等规则待当面对齐后再决定要不要引入窗口表。
 */
@Injectable()
export class MemberAllowanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** 企业全体成员的分配情况。成员多时也只打三次查询，不做 N+1。 */
  async listAllowances(enterpriseId: string): Promise<MemberAllowanceView[]> {
    const { start, end } = currentPeriod();

    const [members, allowances, usage] = await Promise.all([
      this.prisma.enterpriseMember.findMany({
        where: { enterpriseId },
        select: {
          userId: true,
          user: { select: { name: true, email: true } },
          department: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.memberComputeAllowance.findMany({ where: { enterpriseId } }),
      this.prisma.computeUsageRecord.groupBy({
        by: ['userId'],
        where: { enterpriseId, createdAt: { gte: start, lt: end } },
        _sum: { costCNY: true },
      }),
    ]);

    const limitByUser = new Map(allowances.map((a) => [a.userId, a]));
    const usedByUser = new Map(
      usage.map((u) => [u.userId, u._sum.costCNY ?? new Decimal(0)]),
    );

    return members.map((m) => {
      const allowance = limitByUser.get(m.userId);
      const used = usedByUser.get(m.userId) ?? new Decimal(0);
      const limit = allowance?.enabled ? allowance.limitCNY : null;

      return {
        userId: m.userId,
        name: m.user.name ?? m.user.email,
        email: m.user.email,
        departmentName: m.department?.name ?? null,
        // 上限是人手填的整数，两位小数就够；已用/剩余保留 4 位 ——
        // 单次对话常花不到 1 分，四舍五入到分会让「已用 ¥0.01 / 上限 ¥0.01」
        // 和旁边的 58% 自相矛盾。
        limitCNY: limit ? limit.toFixed(2) : null,
        enabled: allowance?.enabled ?? true,
        usedCNY: used.toFixed(4),
        remainingCNY: limit ? Decimal.max(0, limit.sub(used)).toFixed(4) : null,
        usedPct: limit && limit.greaterThan(0)
          ? Math.min(100, Math.round(used.div(limit).toNumber() * 100))
          : null,
        resetAt: end.toISOString(),
      };
    });
  }

  /**
   * 设置 / 清除某位成员的额度。
   *
   * `limitCNY = null` 表示不限额 —— 用删除记录来表达，而不是留一条 limit 为 null
   * 的行：少一种「记录存在但没有约束」的中间态，列表和闸门都少一个分支。
   */
  async setAllowance(
    enterpriseId: string,
    userId: string,
    limitCNY: number | null,
  ) {
    const member = await this.prisma.enterpriseMember.findFirst({
      where: { enterpriseId, userId },
      select: { id: true },
    });
    if (!member) {
      throw new NotFoundException('该成员不属于当前企业');
    }

    if (limitCNY === null) {
      await this.prisma.memberComputeAllowance.deleteMany({
        where: { enterpriseId, userId },
      });
      return this.getOne(enterpriseId, userId);
    }

    if (!Number.isFinite(limitCNY) || limitCNY <= 0) {
      throw new BadRequestException('额度必须大于 0；不限额请清空额度');
    }

    await this.prisma.memberComputeAllowance.upsert({
      where: { enterpriseId_userId: { enterpriseId, userId } },
      create: {
        enterpriseId,
        userId,
        limitCNY: new Decimal(limitCNY),
        period: 'MONTH',
      },
      update: { limitCNY: new Decimal(limitCNY), enabled: true },
    });

    return this.getOne(enterpriseId, userId);
  }

  private async getOne(
    enterpriseId: string,
    userId: string,
  ): Promise<MemberAllowanceView> {
    const all = await this.listAllowances(enterpriseId);
    const found = all.find((a) => a.userId === userId);
    if (!found) throw new NotFoundException('该成员不属于当前企业');
    return found;
  }

  /**
   * 对话前的额度闸门。
   *
   * 无记录 / 已停用 / 未设上限 一律放行 —— 存量企业不会因为多了这张表而被拦。
   * 拦下时的话术必须给出**出路**（重置时间 + 找谁），否则用户只会看到「不能用」。
   */
  async check(
    enterpriseId: string,
    userId?: string | null,
  ): Promise<AllowanceCheckResult> {
    if (!userId) return { allowed: true };

    const allowance = await this.prisma.memberComputeAllowance.findUnique({
      where: { enterpriseId_userId: { enterpriseId, userId } },
    });
    if (!allowance || !allowance.enabled || !allowance.limitCNY) {
      return { allowed: true };
    }

    const { start, end } = currentPeriod();
    const agg = await this.prisma.computeUsageRecord.aggregate({
      where: { enterpriseId, userId, createdAt: { gte: start, lt: end } },
      _sum: { costCNY: true },
    });
    const used = agg._sum.costCNY ?? new Decimal(0);

    if (used.greaterThanOrEqualTo(allowance.limitCNY)) {
      const resetDate = `${end.getFullYear()}年${end.getMonth() + 1}月${end.getDate()}日`;
      return {
        allowed: false,
        reason:
          `你本月的算力额度已用完（已用 ¥${used.toFixed(2)} / 上限 ¥${allowance.limitCNY.toFixed(2)}）。` +
          `额度将于 ${resetDate} 重置，需要提前恢复请联系企业管理员调高额度。`,
      };
    }

    return { allowed: true };
  }
}
