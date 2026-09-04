import { Injectable, NotFoundException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/library";
import { PrismaService } from "../../prisma/prisma.service";
import { periodLabel } from "./allowance-period";
import {
  computeAvailability,
  sumTopUpRemaining,
  type TopUpRow,
} from "./allowance-carryover";
import { loadWindowStates } from "./member-allowance-batch";
import {
  loadTopUps,
  resolveWindow,
  unlimitedPlaceholder,
} from "./member-allowance-window";
import type {
  AllowanceRow,
  MemberAllowanceChangeView,
  MemberAllowanceTopUpView,
  MemberAllowanceView,
  WindowState,
} from "./member-allowance.types";

/**
 * 算力分配的读侧：列表、单条视图、追加额度与变更留痕。
 *
 * 与写侧（MemberAllowanceService）分开是因为两者的性能约束相反 ——
 * 闸门每轮对话都跑一次、只关心一个人、必须最省查询；列表一天开几次、
 * 要全员数据、必须避免 N+1。挤在一个类里会让两套取数策略互相污染。
 */
@Injectable()
export class MemberAllowanceQueryService {
  constructor(private readonly prisma: PrismaService) {}
  // ── 列表与单条 ─────────────────────────────────────────────────────────────

  /** 企业全体成员的分配情况。查询数与成员数无关（见 member-allowance-batch.ts）。 */
  async listAllowances(enterpriseId: string): Promise<MemberAllowanceView[]> {
    const [members, allowances, topUps] = await Promise.all([
      this.prisma.enterpriseMember.findMany({
        where: { enterpriseId },
        select: {
          userId: true,
          user: { select: { name: true, email: true } },
          department: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.memberComputeAllowance.findMany({ where: { enterpriseId } }),
      this.prisma.memberAllowanceTopUp.findMany({
        where: { enterpriseId },
        select: {
          id: true,
          userId: true,
          amountCNY: true,
          consumedCNY: true,
          version: true,
        },
      }),
    ]);

    const allowanceByUser = new Map(allowances.map((a) => [a.userId, a]));
    const topUpsByUser = new Map<string, TopUpRow[]>();
    for (const row of topUps) {
      const bucket = topUpsByUser.get(row.userId);
      if (bucket) bucket.push(row);
      else topUpsByUser.set(row.userId, [row]);
    }

    const states = await loadWindowStates(this.prisma, {
      enterpriseId,
      userIds: members.map((m) => m.userId),
      allowanceByUser,
      at: new Date(),
    });

    return members.map((member) =>
      this.buildView(
        {
          userId: member.userId,
          name: member.user.name ?? member.user.email,
          email: member.user.email,
          departmentName: member.department?.name ?? null,
        },
        allowanceByUser.get(member.userId) ?? null,
        states.get(member.userId)!,
        topUpsByUser.get(member.userId) ?? [],
      ),
    );
  }

  buildView(
    member: {
      userId: string;
      name: string;
      email: string;
      departmentName: string | null;
    },
    allowance: AllowanceRow | null,
    state: WindowState,
    topUps: readonly TopUpRow[],
  ): MemberAllowanceView {
    const topUpRemaining = sumTopUpRemaining(topUps);
    const availability = computeAvailability({
      limitCNY: state.limitCNY,
      carriedInCNY: state.carriedInCNY,
      usedCNY: state.usedCNY,
      topUpRemainingCNY: topUpRemaining,
    });
    const period = allowance?.period ?? "MONTH";
    // 「上限 + 结转」才是本周期实际能花的常规额度，百分比必须对着它算，
    // 否则开了结转的人会看到 140% 这种没法解释的数字。
    const effectiveLimit = state.limitCNY?.add(state.carriedInCNY) ?? null;

    return {
      userId: member.userId,
      name: member.name,
      email: member.email,
      departmentName: member.departmentName,
      // 上限是人手填的整数，两位小数就够；已用/剩余保留 4 位 ——
      // 单次对话常花不到 1 分，四舍五入到分会让「已用 ¥0.01 / 上限 ¥0.01」
      // 和旁边的 58% 自相矛盾。
      limitCNY: state.limitCNY ? state.limitCNY.toFixed(2) : null,
      period,
      periodLabel: periodLabel(period),
      carryOver: allowance?.carryOver ?? true,
      enabled: allowance?.enabled ?? true,
      carriedInCNY: state.carriedInCNY.toFixed(2),
      usedCNY: state.usedCNY.toFixed(4),
      remainingCNY: availability.regularRemainingCNY?.toFixed(4) ?? null,
      topUpRemainingCNY: topUpRemaining.toFixed(2),
      totalRemainingCNY: availability.totalRemainingCNY?.toFixed(4) ?? null,
      usedPct:
        effectiveLimit && effectiveLimit.greaterThan(0)
          ? Math.min(
              100,
              Math.round(state.usedCNY.div(effectiveLimit).toNumber() * 100),
            )
          : null,
      periodStart: state.periodStart.toISOString(),
      resetAt: state.periodEnd.toISOString(),
    };
  }

  async getOne(
    enterpriseId: string,
    userId: string,
  ): Promise<MemberAllowanceView> {
    const [member, allowance, topUps] = await Promise.all([
      this.prisma.enterpriseMember.findFirst({
        where: { enterpriseId, userId },
        select: {
          userId: true,
          user: { select: { name: true, email: true } },
          department: { select: { name: true } },
        },
      }),
      this.prisma.memberComputeAllowance.findUnique({
        where: { enterpriseId_userId: { enterpriseId, userId } },
      }),
      loadTopUps(this.prisma, enterpriseId, userId),
    ]);
    if (!member) throw new NotFoundException("该成员不属于当前企业");

    const state = allowance
      ? await resolveWindow(this.prisma, allowance, new Date(), false)
      : await resolveWindow(
          this.prisma,
          unlimitedPlaceholder(enterpriseId, userId),
          new Date(),
          false,
        );

    return this.buildView(
      {
        userId: member.userId,
        name: member.user.name ?? member.user.email,
        email: member.user.email,
        departmentName: member.department?.name ?? null,
      },
      allowance,
      state,
      topUps,
    );
  }

  // ── 留痕查询 ───────────────────────────────────────────────────────────────

  /** 追加额度记录。不传 userId 时返回全企业最近 50 条。 */
  async listTopUps(
    enterpriseId: string,
    userId?: string,
  ): Promise<MemberAllowanceTopUpView[]> {
    const rows = await this.prisma.memberAllowanceTopUp.findMany({
      where: { enterpriseId, ...(userId && { userId }) },
      include: {
        user: { select: { name: true, email: true } },
        grantedBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.user.name ?? r.user.email,
      amountCNY: r.amountCNY.toFixed(2),
      consumedCNY: r.consumedCNY.toFixed(4),
      remainingCNY: Decimal.max(0, r.amountCNY.sub(r.consumedCNY)).toFixed(4),
      note: r.note,
      grantedByName: r.grantedBy?.name ?? r.grantedBy?.email ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** 额度变更记录。不传 userId 时返回全企业最近 50 条。 */
  async listChanges(
    enterpriseId: string,
    userId?: string,
  ): Promise<MemberAllowanceChangeView[]> {
    const rows = await this.prisma.memberAllowanceChange.findMany({
      where: { enterpriseId, ...(userId && { userId }) },
      include: {
        user: { select: { name: true, email: true } },
        changedBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.user.name ?? r.user.email,
      fromLimitCNY: r.fromLimitCNY?.toFixed(2) ?? null,
      toLimitCNY: r.toLimitCNY?.toFixed(2) ?? null,
      fromPeriod: r.fromPeriod,
      toPeriod: r.toPeriod,
      fromCarryOver: r.fromCarryOver,
      toCarryOver: r.toCarryOver,
      usedAtChangeCNY: r.usedAtChangeCNY?.toFixed(4) ?? null,
      changedByName: r.changedBy?.name ?? r.changedBy?.email ?? null,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
