import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { PrismaService } from "../../prisma/prisma.service";
import { PersonalWalletService } from "../personal-wallet/personal-wallet.service";
import { WalletService } from "../wallet/wallet.service";
import type { MemberAllowanceSetDto, MemberAllowanceTopUpDto } from "shared";
import {
  currentPeriodLabel,
  formatBusinessDateTime,
  resolvePeriodWindow,
} from "./allowance-period";
import {
  allocateTopUps,
  computeAvailability,
  sumTopUpRemaining,
} from "./allowance-carryover";
import { loadTopUps, resolveWindow } from "./member-allowance-window";
import { MemberAllowanceQueryService } from "./member-allowance-query.service";
import type {
  AllowanceChargePlan,
  AllowanceCheckResult,
  MemberAllowanceView,
} from "./member-allowance.types";

/** 没有闸门时的计划：不设上限，也没有追加额度要回写。 */
const UNLIMITED_PLAN: AllowanceChargePlan = {
  windowId: null,
  enterpriseCapCNY: null,
  regularRemainingCNY: new Decimal(0),
  limitCNY: null,
  carriedInCNY: new Decimal(0),
  topUps: [],
};

/**
 * 算力分配 —— 给碳基员工设周期算力消费上限。
 *
 * 这是**闸门**不是钱包：分配 ¥500 不会从企业算力余额里预先划走钱，
 * 只在这位成员本周期已花到 ¥500 时**改道**到他的个人钱包。所以：
 *   · 给 10 个人各分 ¥500 而企业只有 ¥3000，不是超分，只是三个人先花完
 *   · 分配不限定用在哪位硅基员工上
 *   · 取消某人对某员工的授权，他的额度数字不变（权限与额度互相独立）
 *   · 额度用尽 ≠ 不能对话（个人钱包有钱就自费继续，见 `check` 的两个布尔值）
 *
 * 已用金额直接对账单表聚合，不存第二份计数（`MemberAllowanceWindow` 里刻意
 * 没有 usedCNY 列）—— 双写必然漂移，而账单表是唯一权威。窗口行只存
 * **结转金额**这一个算不出来的量。
 */
@Injectable()
export class MemberAllowanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly personalWallet: PersonalWalletService,
    private readonly wallet: WalletService,
    private readonly query: MemberAllowanceQueryService,
  ) {}
  // ── 闸门：对话前判定 ───────────────────────────────────────────────────────

  /**
   * 对话前的额度闸门。
   *
   * 无记录 / 已停用 / 未设上限 一律放行 —— 存量企业不会因为多了这张表而被拦。
   *
   * 额度用尽时**不是拦停而是改道**：只要个人钱包有余额，对话照常发生，这一次由
   * 成员自己付。所以返回两个布尔值 —— `enterpriseFundsAllowed` 决定钱从哪出，
   * `allowed` 决定对话能不能发生。把两者合成一个「余额不足」，等于把「公司这月
   * 不再为你付费」错报成「系统坏了」。
   *
   * 真正一分钱都没有时，话术必须给出**出路**（重置时间 + 找谁 + 可自费），
   * 否则用户只会看到「不能用」。
   */
  async check(
    enterpriseId: string,
    userId?: string | null,
  ): Promise<AllowanceCheckResult> {
    if (!userId) return { enterpriseFundsAllowed: true, allowed: true };

    const allowance = await this.prisma.memberComputeAllowance.findUnique({
      where: { enterpriseId_userId: { enterpriseId, userId } },
    });
    if (!allowance || !allowance.enabled || !hasAnyLimit(allowance)) {
      return { enterpriseFundsAllowed: true, allowed: true };
    }

    const [state, topUps] = await Promise.all([
      resolveWindow(this.prisma, allowance, new Date(), true),
      loadTopUps(this.prisma, enterpriseId, userId),
    ]);
    const parallel = resolveParallelLimits(allowance, state);
    const topUpRemaining = sumTopUpRemaining(topUps);
    const availability = computeAvailability({
      limitCNY: state.limitCNY,
      carriedInCNY: state.carriedInCNY,
      usedCNY: state.usedCNY,
      topUpRemainingCNY: topUpRemaining,
    });
    const parallelConfigured = Boolean(allowance.dailyLimitCNY || allowance.monthlyLimitCNY);
    const enterpriseRemaining = minDefined(
      parallelConfigured ? null : availability.totalRemainingCNY,
      parallel.dailyBypassActive ? null : parallel.dailyRemainingCNY,
      parallel.monthlyRemainingCNY,
    );

    const facts = {
      windowId: state.windowId ?? undefined,
      limitCNY: state.limitCNY?.toFixed(2),
      usedCNY: state.usedCNY.toFixed(4),
      remainingCNY: enterpriseRemaining?.toFixed(4),
      dailyLimitCNY: parallel.dailyLimitCNY?.toFixed(2),
      dailyRemainingCNY: parallel.dailyRemainingCNY?.toFixed(4),
      monthlyLimitCNY: parallel.monthlyLimitCNY?.toFixed(2),
      monthlyRemainingCNY: parallel.monthlyRemainingCNY?.toFixed(4),
      dailyBypassActive: parallel.dailyBypassActive,
    };

    if (enterpriseRemaining === null || enterpriseRemaining.greaterThan(0)) {
      return { enterpriseFundsAllowed: true, allowed: true, ...facts };
    }

    // 企业额度用尽 —— 看成员自己有没有钱。这里刻意用只读的 getBalance：
    // 对话前的闸门不该顺手给每个人建一张个人钱包。
    const personalBalance = await this.personalWallet.getBalance(userId);
    const resetAt = formatBusinessDateTime(state.periodEnd);
    const scope = currentPeriodLabel(allowance.period);
    const usedText =
      `${scope}的算力额度已用完（已用 ¥${state.usedCNY.toFixed(2)} / ` +
      `上限 ¥${state.limitCNY!.toFixed(2)}` +
      (state.carriedInCNY.greaterThan(0)
        ? ` + 结转 ¥${state.carriedInCNY.toFixed(2)}`
        : "") +
      // 全角开括号要用全角收尾 —— 半角 ")" 会在弹窗里显示成「¥1.00)」这种半残括号
      "）";

    if (personalBalance.greaterThan(0)) {
      return {
        enterpriseFundsAllowed: false,
        allowed: true,
        reason:
          `你${usedText}，本次对话将由你的个人余额支付` +
          `（当前 ¥${personalBalance.toFixed(2)}）。额度将于 ${resetAt} 重置。`,
        personalBalanceCNY: personalBalance.toFixed(2),
        ...facts,
      };
    }

    return {
      enterpriseFundsAllowed: false,
      allowed: false,
      reason:
        `你${usedText}，个人余额也已用尽。额度将于 ${resetAt} 重置；` +
        `需要提前恢复，可联系企业管理员调高额度或追加一次性额度，也可为个人余额充值后自费使用。`,
      personalBalanceCNY: personalBalance.toFixed(2),
      ...facts,
    };
  }

  // ── 扣费时回写额度消耗 ─────────────────────────────────────────────────────

  /**
   * 扣费事务内、**动用企业资金之前**调用：这一笔企业最多能出多少。
   *
   * 用量在事务内重新聚合，不复用对话前 `check` 的结果 —— 那之间隔着一整次模型
   * 调用，同一个人的并发对话早把数字改了。闸门只在检查时生效、扣费时不生效，
   * 等于额度形同虚设：公司照样把钱付了。
   *
   * 返回金额上限而不是「能/不能」，是为了让额度剩 ¥0.30 而这笔要 ¥0.50 时，
   * 自然拆成「公司 0.30 + 成员 0.20」。
   */
  async planCharge(
    tx: Prisma.TransactionClient,
    params: { enterpriseId: string; userId?: string | null },
  ): Promise<AllowanceChargePlan> {
    if (!params.userId) return UNLIMITED_PLAN;

    const allowance = await tx.memberComputeAllowance.findUnique({
      where: {
        enterpriseId_userId: {
          enterpriseId: params.enterpriseId,
          userId: params.userId,
        },
      },
    });
    if (!allowance || !allowance.enabled || !hasAnyLimit(allowance)) {
      return UNLIMITED_PLAN;
    }

    const [state, topUps] = await Promise.all([
      resolveWindow(tx, allowance, new Date(), true),
      loadTopUps(tx, params.enterpriseId, params.userId),
    ]);
    const parallel = resolveParallelLimits(allowance, state);
    const availability = computeAvailability({
      limitCNY: state.limitCNY,
      carriedInCNY: state.carriedInCNY,
      usedCNY: state.usedCNY,
      topUpRemainingCNY: sumTopUpRemaining(topUps),
    });

    const parallelConfigured = Boolean(allowance.dailyLimitCNY || allowance.monthlyLimitCNY);
    const enterpriseCapCNY = minDefined(
      parallelConfigured ? null : availability.totalRemainingCNY,
      parallel.dailyBypassActive ? null : parallel.dailyRemainingCNY,
      parallel.monthlyRemainingCNY,
    );
    return {
      windowId: state.windowId,
      enterpriseCapCNY,
      regularRemainingCNY: availability.regularRemainingCNY ?? new Decimal(0),
      limitCNY: state.limitCNY,
      carriedInCNY: state.carriedInCNY,
      topUps,
      dailyLimitCNY: parallel.dailyLimitCNY,
      dailyRemainingCNY: parallel.dailyRemainingCNY,
      monthlyLimitCNY: parallel.monthlyLimitCNY,
      monthlyRemainingCNY: parallel.monthlyRemainingCNY,
      dailyBypassActive: parallel.dailyBypassActive,
    };
  }

  /**
   * 扣费事务内、企业资金扣完之后调用：把这笔消费记到成员额度上。
   *
   * 常规额度不需要回写（已用金额从账单聚合），需要回写的只有**追加额度**的
   * `consumedCNY` —— 它跨周期存活，无法从「本周期用量」反推出还剩多少。
   * 顺序：先常规、后追加（§5.4 Q1），批次之间按发放先后。
   *
   * `enterpriseFundedCNY` 必须与闸门的「已用」同口径（credit + wallet + **unpaid**）：
   * 欠费那部分公司终究要付，不记进去就等于白送成员一笔。
   */
  async commitCharge(
    tx: Prisma.TransactionClient,
    plan: AllowanceChargePlan,
    enterpriseFundedCNY: Decimal,
  ): Promise<{ fromTopUpCNY: Decimal }> {
    const fromTopUp = Decimal.max(
      0,
      enterpriseFundedCNY.sub(plan.regularRemainingCNY),
    );
    if (plan.enterpriseCapCNY === null || fromTopUp.lessThanOrEqualTo(0)) {
      return { fromTopUpCNY: new Decimal(0) };
    }

    // 新语义下充值批次已在扣费前被消费；只有调用方明确传入批次时才回写。
    const { allocations, allocatedCNY } = allocateTopUps(plan.topUps, fromTopUp);
    for (const allocation of allocations) {
      const updated = await tx.memberAllowanceTopUp.updateMany({
        where: { id: allocation.id, version: allocation.version },
        data: {
          consumedCNY: { increment: allocation.consumeCNY },
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) throw new ConflictException("成员算力余额更新冲突，请重试");
    }
    return { fromTopUpCNY: allocatedCNY };
  }

  // ── 写操作 ─────────────────────────────────────────────────────────────────

  /**
   * 设置 / 清除某位成员的额度。**每次变更都留痕**（MemberAllowanceChange）。
   *
   * `limitCNY = null` 表示不限额 —— 用删除记录来表达，而不是留一条 limit 为 null
   * 的行：少一种「记录存在但没有约束」的中间态，列表和闸门都少一个分支。
   * 变更记录的 allowanceId 是 SetNull 的，所以删除额度不会带走这段历史。
   *
   * 周期内改动**立即生效，不按比例折算**（§5.4 Q4）：把上限从 ¥500 调到 ¥800，
   * 这一刻起就是 ¥800，不管本周期已经过了几天。折算算出的「¥650」没人能预期，
   * 而且会让「我给他加了额度他却还是用不了」变成常见投诉。
   */
  async setAllowance(
    enterpriseId: string,
    userId: string,
    dto: MemberAllowanceSetDto,
    actorId?: string | null,
  ): Promise<MemberAllowanceView> {
    const member = await this.prisma.enterpriseMember.findFirst({
      where: { enterpriseId, userId },
      select: { id: true },
    });
    if (!member) {
      throw new NotFoundException("该成员不属于当前企业");
    }

    const before = await this.prisma.memberComputeAllowance.findUnique({
      where: { enterpriseId_userId: { enterpriseId, userId } },
    });
    const usedAtChange = before
      ? (await resolveWindow(this.prisma, before, new Date(), false)).usedCNY
      : null;

    const hasNewLimits = Object.prototype.hasOwnProperty.call(dto, "dailyLimitCNY") ||
      Object.prototype.hasOwnProperty.call(dto, "monthlyLimitCNY");
    const dailyLimitCNY = hasNewLimits
      ? normalizeLimit(dto.dailyLimitCNY)
      : before?.dailyLimitCNY ?? null;
    const monthlyLimitCNY = hasNewLimits
      ? normalizeLimit(dto.monthlyLimitCNY)
      : before?.monthlyLimitCNY ?? null;
    if (dto.limitCNY !== undefined && dto.limitCNY !== null && !Number.isFinite(dto.limitCNY)) {
      throw new BadRequestException("额度必须大于 0；不限额请清空额度");
    }

    const period = dto.period ?? before?.period ?? "MONTH";
    const carryOver = dto.carryOver ?? before?.carryOver ?? true;
    const bypassUntil = dto.dailyBypassUntil === undefined
      ? before?.dailyBypassUntil ?? null
      : parseBypass(dto.dailyBypassUntil);
    const targetLimit = hasNewLimits
      ? monthlyLimitCNY
      : dto.limitCNY === undefined
        ? before?.limitCNY ?? null
        : normalizeLimit(dto.limitCNY);

    await this.prisma.$transaction(async (tx) => {
      if ((!hasNewLimits && dto.limitCNY === null) ||
        (hasNewLimits && dailyLimitCNY === null && monthlyLimitCNY === null)) {
        await tx.memberComputeAllowance.deleteMany({
          where: { enterpriseId, userId },
        });
      } else {
        // 新模型的旧字段只保留 monthly 作为兼容快照；daily-only 不能被旧逻辑误读成月度上限。
        const limit = targetLimit;
        const saved = await tx.memberComputeAllowance.upsert({
          where: { enterpriseId_userId: { enterpriseId, userId } },
          create: {
            enterpriseId,
            userId,
            limitCNY: limit,
            dailyLimitCNY,
            monthlyLimitCNY,
            dailyBypassUntil: bypassUntil,
            period,
            carryOver,
          },
          update: {
            limitCNY: limit,
            dailyLimitCNY,
            monthlyLimitCNY,
            dailyBypassUntil: bypassUntil,
            period,
            carryOver,
            enabled: true,
          },
        });

        // 当前窗口的上限快照要跟着改：它是下一周期算结转时的「上一周期上限」。
        // 不同步的话，中途调高上限、成员按新上限花了钱，下期结转会把这笔算成超支。
        await tx.memberAllowanceWindow.updateMany({
          where: {
            allowanceId: saved.id,
            periodStart: resolvePeriodWindow(period, new Date()).start,
          },
          data: { limitAtOpenCNY: limit },
        });
      }

      const changed =
        !before ||
        !decimalEquals(before?.limitCNY, targetLimit) ||
        (hasNewLimits && !decimalEquals(before.dailyLimitCNY, dailyLimitCNY?.toNumber() ?? null)) ||
        (hasNewLimits && !decimalEquals(before.monthlyLimitCNY, monthlyLimitCNY?.toNumber() ?? null)) ||
        before.period !== period ||
        before.carryOver !== carryOver ||
        (before?.dailyBypassUntil?.toISOString() ?? null) !== (bypassUntil?.toISOString() ?? null);
      if (!changed && !dto.note) return;

      await tx.memberAllowanceChange.create({
        data: {
          allowanceId: before?.id ?? null,
          enterpriseId,
          userId,
          fromLimitCNY: before?.limitCNY ?? null,
          toLimitCNY: hasNewLimits ? monthlyLimitCNY : targetLimit,
          fromPeriod: before?.period ?? null,
          toPeriod: dailyLimitCNY || monthlyLimitCNY ? period : null,
          fromCarryOver: before?.carryOver ?? null,
          toCarryOver: dailyLimitCNY || monthlyLimitCNY ? carryOver : null,
          usedAtChangeCNY: usedAtChange,
          changedById: actorId ?? null,
          note: dto.note ?? null,
        },
      });
    });

    return this.query.getOne(enterpriseId, userId);
  }

  /**
   * 给某成员追加一次性额度。
   *
   * 与「调高上限」的差别是可观测的，所以必须是两个功能：追加额度**跨周期存活**，
   * 且排在常规额度之后消耗。用途是「他这个月要多干点活」，
   * 而不是「他以后每期都能花更多」。
   */
  async topUp(
    enterpriseId: string,
    userId: string,
    dto: MemberAllowanceTopUpDto,
    actorId?: string | null,
  ): Promise<MemberAllowanceView> {
    const member = await this.prisma.enterpriseMember.findFirst({
      where: { enterpriseId, userId },
      select: { id: true },
    });
    if (!member) throw new NotFoundException("该成员不属于当前企业");

    if (dto.amountCNY <= 0 || !Number.isFinite(dto.amountCNY)) {
      throw new BadRequestException("充值金额必须大于 0");
    }

    // 真实充值：企业钱包扣款与成员余额入账必须在同一事务内完成。
    await this.prisma.$transaction(async (tx) => {
      await this.wallet.consumeForMemberTopUp(
        tx,
        enterpriseId,
        new Decimal(dto.amountCNY),
        {
          relatedId: userId,
          relatedType: "member_compute_top_up",
          createdBy: actorId,
          description: `给成员 ${userId} 充值企业算力 ¥${dto.amountCNY}`,
        },
      );
      await tx.memberAllowanceTopUp.create({
        data: {
          enterpriseId,
          userId,
          amountCNY: new Decimal(dto.amountCNY),
          note: dto.note ?? null,
          grantedById: actorId ?? null,
        },
      });
    });

    return this.query.getOne(enterpriseId, userId);
  }

  /** 查询成员企业充值余额；充值余额跨周期保留，不计入月度额度本身。 */
  async getMemberWalletBalance(
    enterpriseId: string,
    userId: string,
  ): Promise<Decimal> {
    const topUps = await loadTopUps(this.prisma, enterpriseId, userId);
    return sumTopUpRemaining(topUps);
  }

  /** 从成员企业算力钱包扣最多 amount，按充值批次 FIFO。 */
  async consumeMemberWalletUpTo(
    tx: Prisma.TransactionClient,
    enterpriseId: string,
    userId: string,
    amount: Decimal,
  ): Promise<{ paid: Decimal }> {
    if (amount.lessThanOrEqualTo(0)) return { paid: new Decimal(0) };
    const rows = await loadTopUps(tx, enterpriseId, userId);
    const { allocations, allocatedCNY } = allocateTopUps(rows, amount);
    for (const allocation of allocations) {
      const updated = await tx.memberAllowanceTopUp.updateMany({
        where: { id: allocation.id, version: allocation.version },
        data: {
          consumedCNY: { increment: allocation.consumeCNY },
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConflictException("成员算力余额更新冲突，请重试");
      }
    }
    return { paid: allocatedCNY };
  }
}

function decimalEquals(
  left: Decimal | null | undefined,
  right: Decimal | number | null | undefined,
): boolean {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return left.equals(right instanceof Decimal ? right : new Decimal(right));
}

function normalizeLimit(value: number | null | undefined): Decimal | null {
  if (value == null) return null;
  if (!Number.isFinite(value) || value <= 0) {
    throw new BadRequestException("额度必须大于 0；不限额请清空额度");
  }
  return new Decimal(value);
}

function parseBypass(value: string | null | undefined): Date | null {
  if (value == null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException("临时放开时间无效");
  return date;
}

function limitForAudit(
  dto: { limitCNY?: number | null },
  daily: Decimal | null,
  monthly: Decimal | null,
): Decimal | null {
  if (dto.limitCNY !== undefined) return dto.limitCNY == null ? null : new Decimal(dto.limitCNY);
  return monthly ?? daily;
}

function hasAnyLimit(allowance: {
  limitCNY?: Decimal | null;
  dailyLimitCNY?: Decimal | null;
  monthlyLimitCNY?: Decimal | null;
}): boolean {
  return Boolean(
    (allowance.dailyLimitCNY && allowance.dailyLimitCNY.greaterThan(0)) ||
      (allowance.monthlyLimitCNY && allowance.monthlyLimitCNY.greaterThan(0)) ||
      (allowance.limitCNY && allowance.limitCNY.greaterThan(0)),
  );
}

function minDefined(...values: Array<Decimal | null | undefined>): Decimal | null {
  const defined = values.filter((value): value is Decimal => value != null);
  if (defined.length === 0) return null;
  return defined.reduce((min, value) => Decimal.min(min, value));
}

function resolveParallelLimits(
  allowance: any,
  state: { usedCNY: Decimal; carriedInCNY: Decimal; dailyUsedCNY?: Decimal; monthlyUsedCNY?: Decimal },
) {
  const now = new Date();
  const dailyLimit = allowance.dailyLimitCNY ?? (allowance.period === "DAY" ? allowance.limitCNY : null);
  const monthlyLimit = allowance.monthlyLimitCNY ?? (allowance.period === "MONTH" ? allowance.limitCNY : null);
  const dailyUsed = state.dailyUsedCNY ?? new Decimal(0);
  const monthlyUsed = state.monthlyUsedCNY ?? new Decimal(0);
  const dailyRemaining = dailyLimit ? Decimal.max(0, dailyLimit.sub(dailyUsed)) : null;
  const monthlyRemaining = monthlyLimit
    ? Decimal.max(0, monthlyLimit.add(state.carriedInCNY).sub(monthlyUsed))
    : null;
  return {
    dailyLimitCNY: dailyLimit,
    dailyRemainingCNY: dailyRemaining,
    monthlyLimitCNY: monthlyLimit,
    monthlyRemainingCNY: monthlyRemaining,
    dailyBypassActive: Boolean(allowance.dailyBypassUntil && allowance.dailyBypassUntil > now),
  };
}
