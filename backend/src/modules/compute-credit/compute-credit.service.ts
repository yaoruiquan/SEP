import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { SettingService } from '../setting/setting.service';
import {
  SETTING_KEYS,
  calculateCost,
  parseCnyAmount,
  parseFallbackPriceConfig,
  parseUsdToCnyRate,
  type FallbackPriceConfigCNY,
} from 'shared';
import type {
  BalanceCheckResult,
  ChargeUsageParams,
  ChargeUsageResult,
  GrantCreditParams,
  SubscriptionCreditView,
  UsageRecordQuery,
} from './compute-credit.types';

/** 账本精度：6 位小数。所有写库前的金额都过一遍它，避免 Prisma 层静默截断。 */
const MONEY_DP = 6;

function money(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(MONEY_DP, Decimal.ROUND_HALF_UP);
}

/**
 * 统一人民币算力账本。
 *
 * 财务口径只有「元」：订阅赠送余额（SubscriptionCredit）优先，用尽后扣企业钱包
 * （EnterpriseWallet）。Token 只作为用量与定价输入落在 ComputeUsageRecord 明细里，
 * 不是可扣减余额。
 */
@Injectable()
export class ComputeCreditService {
  private readonly logger = new Logger(ComputeCreditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly settings: SettingService,
  ) {}

  // ── 赠送额度配置与发放 ─────────────────────────────────────────────────────

  /** 系统默认赠送金额（元）。运营端可改，非法值回退 0。 */
  async getDefaultGiftCNY(): Promise<number> {
    const raw = await this.settings.getEffectiveValue(
      SETTING_KEYS.DEFAULT_EMPLOYEE_GIFT_CNY,
    );
    return parseCnyAmount(raw, 0);
  }

  /**
   * 解析一个订阅应当赠送多少钱：**员工级配置 > 系统默认值**。
   *
   * `null` 与 `0` 语义不同：null 表示运营没配过这个员工，回落系统默认；
   * 0 表示运营明确「这个员工不赠送」。把两者混为一谈会让「默认值」
   * 对所有存量员工突然生效，产生一批没人批准过的赠送额度。
   */
  async resolveGrantAmountCNY(
    employeeOverride: Decimal | number | null | undefined,
  ): Promise<number> {
    if (employeeOverride === null || employeeOverride === undefined) {
      return this.getDefaultGiftCNY();
    }
    const value = new Decimal(employeeOverride);
    if (value.lessThan(0)) return this.getDefaultGiftCNY();
    return value.toNumber();
  }

  /**
   * 发放（或补齐）订阅赠送余额。**幂等**：subscriptionId 唯一，重复履约不重复赠送。
   *
   * 已存在时只做「复活」：把 EXPIRED 的额度重新置为可用，但**不追加金额** ——
   * 追加会让重复调用变成刷额度的口子。
   */
  async grantSubscriptionCredit(
    client: Prisma.TransactionClient,
    params: GrantCreditParams,
  ) {
    const granted = money(params.grantedCNY);

    const existing = await client.subscriptionCredit.findUnique({
      where: { subscriptionId: params.subscriptionId },
    });

    if (existing) {
      const exhausted = existing.usedCNY.greaterThanOrEqualTo(existing.grantedCNY);
      return client.subscriptionCredit.update({
        where: { id: existing.id },
        data: { status: exhausted ? 'EXHAUSTED' : 'ACTIVE' },
      });
    }

    return client.subscriptionCredit.create({
      data: {
        subscriptionId: params.subscriptionId,
        enterpriseId: params.enterpriseId,
        employeeId: params.employeeId,
        grantedCNY: granted,
        usedCNY: 0,
        // 赠送 0 元的额度直接标记用尽，免得前端把它显示成「有额度可用」
        status: granted.greaterThan(0) ? 'ACTIVE' : 'EXHAUSTED',
        sourceType: params.sourceType,
        sourceId: params.sourceId ?? null,
      },
    });
  }

  /**
   * 订阅终止时停用剩余赠送额度。
   *
   * 第一版规则：**不折现、不退回**（见开发计划）。所以这里只把额度置为不可用，
   * 不产生退款流水 —— 真要退赠送金额，必须单独记 REFUND 并写明来源订阅。
   */
  async expireSubscriptionCredit(
    client: Prisma.TransactionClient,
    subscriptionId: string,
  ) {
    await client.subscriptionCredit.updateMany({
      where: { subscriptionId, status: { not: 'EXPIRED' } },
      data: { status: 'EXPIRED' },
    });
  }

  // ── 对话前余额检查 ─────────────────────────────────────────────────────────

  /**
   * 对话前的余额闸门。赠送余额与钱包余额任一有钱就放行 ——
   * 二者是同一个人民币口径的两个来源，没必要分别判断。
   */
  async checkBalanceBeforeConversation(
    enterpriseId: string,
    subscriptionId?: string | null,
  ): Promise<BalanceCheckResult> {
    const [credit, wallet] = await Promise.all([
      subscriptionId
        ? this.prisma.subscriptionCredit.findUnique({
            where: { subscriptionId },
          })
        : Promise.resolve(null),
      this.wallet.ensureWalletExists(enterpriseId),
    ]);

    const creditRemaining =
      credit && credit.status === 'ACTIVE'
        ? Decimal.max(0, credit.grantedCNY.sub(credit.usedCNY))
        : new Decimal(0);
    const walletBalance = Decimal.max(0, wallet.balance);
    const total = creditRemaining.add(walletBalance);

    if (total.lessThanOrEqualTo(0)) {
      return {
        allowed: false,
        creditRemainingCNY: 0,
        walletBalanceCNY: 0,
        totalAvailableCNY: 0,
        reason:
          '该硅基员工的赠送算力余额与企业钱包余额均已用尽，请为企业钱包充值后继续对话',
      };
    }

    return {
      allowed: true,
      creditRemainingCNY: creditRemaining.toNumber(),
      walletBalanceCNY: walletBalance.toNumber(),
      totalAvailableCNY: total.toNumber(),
    };
  }

  // ── 核心：一次模型调用的人民币扣费 ─────────────────────────────────────────

  /**
   * 为一次模型调用扣费并落一条用量账单。
   *
   * 扣费顺序：订阅赠送余额 → 企业钱包。两步在**同一个事务**里，
   * 否则赠送余额扣了而钱包扣失败会让账本对不上。
   *
   * 幂等：以 `sessionId:messageId` 为业务键，唯一约束兜底。流式对话的网络重试
   * 会重复触发计费，靠调用方自觉挡不住 —— 命中唯一约束即视为已入账。
   */
  async chargeUsage(params: ChargeUsageParams): Promise<ChargeUsageResult> {
    const idempotencyKey = `${params.sessionId}:${params.messageId}`;

    // 计价参数在事务外读：它们是配置读取，放进事务只会拉长持锁时间
    const { rate, fallbackConfig } = await this.loadPricingContext();
    const cost = calculateCost(
      params.modelId,
      params.inputTokens,
      params.outputTokens,
      rate,
      fallbackConfig,
    );
    const costCNY = money(cost.costCNY);

    // 钱包必须在事务前就位：事务内新建钱包会和乐观锁的版本比对纠缠在一起
    await this.wallet.ensureWalletExists(params.enterpriseId);

    return this.prisma.$transaction(async (tx) => {
      // 1. 幂等：已入账则原样返回，绝不二次扣费
      const existing = await tx.computeUsageRecord.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return {
          alreadyCharged: true,
          usageRecordId: existing.id,
          costCNY: existing.costCNY,
          creditPaidCNY: existing.creditPaidCNY,
          walletPaidCNY: existing.walletPaidCNY,
          unpaidCNY: existing.unpaidCNY,
          fallbackPricing: existing.fallbackPricing,
        };
      }

      // 2. 先扣当前订阅的赠送余额
      const { creditId, creditPaid } = await this.consumeCreditUpTo(
        tx,
        params.subscriptionId,
        params.enterpriseId,
        costCNY,
      );

      // 3. 差额扣企业钱包；钱包也不够时扣到 0 并记欠费，余额永不为负
      const remaining = costCNY.sub(creditPaid);
      const walletResult = await this.wallet.consumeComputeUpTo(
        tx,
        params.enterpriseId,
        remaining,
        {
          relatedId: params.sessionId,
          description: `对话算力消费（${params.modelId}，${params.inputTokens}+${params.outputTokens} tokens）`,
        },
      );

      // 4. 落账单。Token 在这里只是明细，不参与任何余额判断。
      const record = await tx.computeUsageRecord.create({
        data: {
          enterpriseId: params.enterpriseId,
          subscriptionId: params.subscriptionId ?? null,
          creditId,
          employeeId: params.employeeId ?? null,
          userId: params.userId ?? null,
          sessionId: params.sessionId,
          messageId: params.messageId,
          modelId: params.modelId,
          inputTokens: params.inputTokens,
          outputTokens: params.outputTokens,
          inputPriceUsdPerMillion: money(cost.inputPriceUsdPerMillion),
          outputPriceUsdPerMillion: money(cost.outputPriceUsdPerMillion),
          usdToCnyRate: new Decimal(rate).toDecimalPlaces(4),
          fallbackPricing: cost.isFallback,
          costCNY,
          creditPaidCNY: creditPaid,
          walletPaidCNY: walletResult.paid,
          unpaidCNY: walletResult.unpaid,
          idempotencyKey,
          walletTransactionId: walletResult.transactionId,
        },
      });

      return {
        alreadyCharged: false,
        usageRecordId: record.id,
        costCNY,
        creditPaidCNY: creditPaid,
        walletPaidCNY: walletResult.paid,
        unpaidCNY: walletResult.unpaid,
        fallbackPricing: cost.isFallback,
      };
    });
  }

  /**
   * 从订阅赠送余额里扣「最多 amount」，返回实扣金额。
   * 只认传入的 subscriptionId —— 绝不扫描同企业其他订阅的额度，
   * 否则「按员工赠送」就形同虚设。
   */
  private async consumeCreditUpTo(
    tx: Prisma.TransactionClient,
    subscriptionId: string | null | undefined,
    enterpriseId: string,
    amount: Decimal,
  ): Promise<{ creditId: string | null; creditPaid: Decimal }> {
    if (!subscriptionId || amount.lessThanOrEqualTo(0)) {
      return { creditId: null, creditPaid: new Decimal(0) };
    }

    const credit = await tx.subscriptionCredit.findUnique({
      where: { subscriptionId },
    });

    // 多租户防线：额度必须属于调用方企业，否则拿到别家 subscriptionId 就能花别家的钱
    if (!credit || credit.enterpriseId !== enterpriseId) {
      return { creditId: null, creditPaid: new Decimal(0) };
    }
    if (credit.status !== 'ACTIVE') {
      return { creditId: credit.id, creditPaid: new Decimal(0) };
    }

    const remaining = Decimal.max(0, credit.grantedCNY.sub(credit.usedCNY));
    const paid = money(Decimal.min(remaining, amount));
    if (paid.lessThanOrEqualTo(0)) {
      return { creditId: credit.id, creditPaid: new Decimal(0) };
    }

    const newUsed = credit.usedCNY.add(paid);
    const updated = await tx.subscriptionCredit.updateMany({
      where: { id: credit.id, version: credit.version },
      data: {
        usedCNY: newUsed,
        status: newUsed.greaterThanOrEqualTo(credit.grantedCNY)
          ? 'EXHAUSTED'
          : 'ACTIVE',
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      // 并发扣同一笔赠送额度。整笔重试即可，幂等键保证不会重复入账。
      throw new ConflictException('赠送余额更新冲突，请重试');
    }

    return { creditId: credit.id, creditPaid: paid };
  }

  /** 读取生效汇率与保底单价配置。 */
  private async loadPricingContext(): Promise<{
    rate: number;
    fallbackConfig: FallbackPriceConfigCNY | null;
  }> {
    const [rawRate, rawIn, rawOut] = await Promise.all([
      this.settings.getEffectiveValue(SETTING_KEYS.USD_TO_CNY_RATE),
      this.settings.getEffectiveValue(SETTING_KEYS.FALLBACK_PRICE_INPUT),
      this.settings.getEffectiveValue(SETTING_KEYS.FALLBACK_PRICE_OUTPUT),
    ]);
    return {
      rate: parseUsdToCnyRate(rawRate),
      fallbackConfig: parseFallbackPriceConfig(rawIn, rawOut),
    };
  }

  // ── 查询 ───────────────────────────────────────────────────────────────────

  /** 企业的订阅赠送余额列表（企业算力中心「员工剩余赠送余额」）。 */
  async listSubscriptionCredits(
    enterpriseId: string,
  ): Promise<SubscriptionCreditView[]> {
    const credits = await this.prisma.subscriptionCredit.findMany({
      where: { enterpriseId },
      include: {
        employee: { select: { id: true, name: true, avatar: true } },
        subscription: { select: { name: true } },
      },
      orderBy: { grantedAt: 'desc' },
    });

    return credits.map((c) => ({
      id: c.id,
      subscriptionId: c.subscriptionId,
      employeeId: c.employeeId,
      employeeName: c.subscription?.name ?? c.employee.name,
      employeeAvatar: c.employee.avatar,
      grantedCNY: c.grantedCNY.toFixed(2),
      usedCNY: c.usedCNY.toFixed(2),
      remainingCNY: Decimal.max(0, c.grantedCNY.sub(c.usedCNY)).toFixed(2),
      status: c.status,
      grantedAt: c.grantedAt,
    }));
  }

  /** 企业算力总览：钱包余额 + 赠送余额汇总，全部以元为单位。 */
  async getOverview(enterpriseId: string) {
    const wallet = await this.wallet.ensureWalletExists(enterpriseId);

    const [creditAgg, activeCredits, monthUsage, todayUsage] = await Promise.all([
      this.prisma.subscriptionCredit.aggregate({
        where: { enterpriseId },
        _sum: { grantedCNY: true, usedCNY: true },
      }),
      this.prisma.subscriptionCredit.findMany({
        where: { enterpriseId, status: 'ACTIVE' },
        select: { grantedCNY: true, usedCNY: true },
      }),
      this.sumUsage(enterpriseId, startOfMonth()),
      this.sumUsage(enterpriseId, startOfToday()),
    ]);

    // 可用赠送余额只统计 ACTIVE 的额度：EXPIRED（订阅已终止）的剩余额度
    // 不能再花，把它算进「可用」会让企业以为还有钱
    const creditRemaining = activeCredits.reduce(
      (sum, c) => sum.add(Decimal.max(0, c.grantedCNY.sub(c.usedCNY))),
      new Decimal(0),
    );

    return {
      walletBalanceCNY: wallet.balance.toFixed(2),
      creditRemainingCNY: creditRemaining.toFixed(2),
      totalAvailableCNY: wallet.balance.add(creditRemaining).toFixed(2),
      creditGrantedTotalCNY: (creditAgg._sum.grantedCNY ?? new Decimal(0)).toFixed(2),
      creditUsedTotalCNY: (creditAgg._sum.usedCNY ?? new Decimal(0)).toFixed(2),
      todayConsumeCNY: todayUsage.cost.toFixed(2),
      monthConsumeCNY: monthUsage.cost.toFixed(2),
      monthInputTokens: monthUsage.inputTokens,
      monthOutputTokens: monthUsage.outputTokens,
      totalDepositCNY: wallet.totalDeposit.toFixed(2),
      totalConsumeCNY: wallet.totalConsume.toFixed(2),
    };
  }

  private async sumUsage(enterpriseId: string, since: Date) {
    const agg = await this.prisma.computeUsageRecord.aggregate({
      where: { enterpriseId, createdAt: { gte: since } },
      _sum: { costCNY: true, inputTokens: true, outputTokens: true },
    });
    return {
      cost: agg._sum.costCNY ?? new Decimal(0),
      inputTokens: agg._sum.inputTokens ?? 0,
      outputTokens: agg._sum.outputTokens ?? 0,
    };
  }

  /**
   * 用量账单明细。人民币金额是主口径，Token 作为明细同列展示。
   * 筛选在 SQL 层完成，避免「先分页再过滤」把 total 算错。
   */
  async listUsageRecords(enterpriseId: string, query: UsageRecordQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    const where: Prisma.ComputeUsageRecordWhereInput = {
      enterpriseId,
      ...(query.employeeId && { employeeId: query.employeeId }),
      ...(query.memberId && { userId: query.memberId }),
    };

    if (query.startDate || query.endDate) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.startDate) {
        const start = new Date(query.startDate);
        start.setHours(0, 0, 0, 0);
        createdAt.gte = start;
      }
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }
      where.createdAt = createdAt;
    }

    const [total, records] = await Promise.all([
      this.prisma.computeUsageRecord.count({ where }),
      this.prisma.computeUsageRecord.findMany({
        where,
        include: {
          employee: { select: { id: true, name: true } },
          user: { select: { id: true, name: true, email: true } },
          subscription: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
      records: records.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        employeeId: r.employeeId,
        employeeName: r.subscription?.name ?? r.employee?.name ?? '—',
        memberId: r.userId,
        memberName: r.user?.name ?? r.user?.email ?? null,
        sessionId: r.sessionId,
        modelId: r.modelId,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costCNY: r.costCNY.toFixed(4),
        creditPaidCNY: r.creditPaidCNY.toFixed(4),
        walletPaidCNY: r.walletPaidCNY.toFixed(4),
        unpaidCNY: r.unpaidCNY.toFixed(4),
        fallbackPricing: r.fallbackPricing,
      })),
    };
  }

  /** 单个订阅的赠送余额（员工详情页用）。 */
  async getSubscriptionCredit(enterpriseId: string, subscriptionId: string) {
    const credit = await this.prisma.subscriptionCredit.findUnique({
      where: { subscriptionId },
    });
    // 用 404 而非 403：不向越权者确认该资源是否存在
    if (!credit || credit.enterpriseId !== enterpriseId) {
      throw new NotFoundException('赠送余额不存在');
    }
    return {
      subscriptionId: credit.subscriptionId,
      grantedCNY: credit.grantedCNY.toFixed(2),
      usedCNY: credit.usedCNY.toFixed(2),
      remainingCNY: Decimal.max(
        0,
        credit.grantedCNY.sub(credit.usedCNY),
      ).toFixed(2),
      status: credit.status,
    };
  }
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
