import { Decimal } from "@prisma/client/runtime/library";

/**
 * 结转与可用额度的纯算术。不碰数据库，便于单测穷举边界。
 *
 * 账本精度 6 位小数，与 compute-credit.service.ts 的 `money()` 同一口径。
 */
const MONEY_DP = 6;

function money(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(MONEY_DP, Decimal.ROUND_HALF_UP);
}

export interface CarryOverInput {
  /** 本周期的上限（元）。null = 不限额，结转无意义。 */
  limitCNY: Decimal | null;
  /** 上一周期的上限快照。取不到时退回本周期上限。 */
  previousLimitCNY: Decimal | null;
  /** 上一周期结转进来的金额 */
  previousCarriedInCNY: Decimal;
  /** 上一周期实际用掉的企业资金（credit + wallet + unpaid，**不含个人自付**） */
  previousUsedCNY: Decimal;
}

/**
 * 结转金额：`carriedIn(N) = min(limit, limit(N-1) + carriedIn(N-1) − used(N-1))`，下限 0。
 *
 * **上限恰好是 1 个周期的额度**（所以最多攒到 2 倍）。这不是保守，是这套设计成立的前提：
 *
 *   · 不封顶 → 每天 ¥50 攒 30 天，某天能花 ¥1500。而设 DAY 周期的唯一目的
 *     就是限制单日爆炸半径（跑飞的循环、误操作、滥用），无上限结转恰好摧毁它要保护的东西
 *   · 封顶 N>1 个周期 → 结转要链式回溯到额度创建那天才能算准，
 *     而这是每轮对话都要跑的热路径。封顶 1 个周期让它只需读上一行窗口，O(1)
 *
 * 「攒 30 天一天花光」不是任何人的真实需求 —— 那个场景走一次性追加额度。
 */
export function computeCarriedIn(input: CarryOverInput): Decimal {
  const { limitCNY } = input;
  if (!limitCNY || limitCNY.lessThanOrEqualTo(0)) return new Decimal(0);

  const previousLimit = input.previousLimitCNY ?? limitCNY;
  const leftover = previousLimit
    .add(input.previousCarriedInCNY)
    .sub(input.previousUsedCNY);

  // 上一周期可能超支（管理员中途调低上限），leftover 为负时不倒扣下一周期
  if (leftover.lessThanOrEqualTo(0)) return new Decimal(0);
  return money(Decimal.min(limitCNY, leftover));
}

export interface AvailabilityInput {
  /** null = 不限额 */
  limitCNY: Decimal | null;
  carriedInCNY: Decimal;
  /** 本周期已用的企业资金 */
  usedCNY: Decimal;
  /** 尚未用完的一次性追加额度合计 */
  topUpRemainingCNY: Decimal;
}

export interface Availability {
  /** 常规周期额度还剩多少（含结转）。不限额时为 null。 */
  regularRemainingCNY: Decimal | null;
  /** 常规 + 追加，合计还能花多少企业资金。不限额时为 null。 */
  totalRemainingCNY: Decimal | null;
  /** 企业资金是否还能动 */
  enterpriseFundsAllowed: boolean;
}

/**
 * 还能花多少企业资金。
 *
 * 顺序是「先常规、后追加」（方案 §5.4 Q1）：追加额度的语义是**追加不是替代**，
 * 先花常规，追加就能活到下个周期，管理员不必每期重批。
 * 这个顺序可观测（追加额度跨周期存活，常规额度不），所以必须定死。
 */
export function computeAvailability(input: AvailabilityInput): Availability {
  if (!input.limitCNY) {
    return {
      regularRemainingCNY: null,
      totalRemainingCNY: null,
      enterpriseFundsAllowed: true,
    };
  }

  const regular = Decimal.max(
    0,
    input.limitCNY.add(input.carriedInCNY).sub(input.usedCNY),
  );
  const total = regular.add(Decimal.max(0, input.topUpRemainingCNY));

  return {
    regularRemainingCNY: money(regular),
    totalRemainingCNY: money(total),
    enterpriseFundsAllowed: total.greaterThan(0),
  };
}

export interface TopUpRow {
  id: string;
  amountCNY: Decimal;
  consumedCNY: Decimal;
  version: number;
}

export interface TopUpAllocation {
  id: string;
  version: number;
  /** 这笔追加额度本次要记多少消耗 */
  consumeCNY: Decimal;
}

/**
 * 把一笔超出常规额度的消费按 FIFO 摊到追加额度上（先批的先花完）。
 *
 * 返回的分配可能少于 `amount` —— 追加额度也不够时差额由调用方作为欠费记录，
 * 余额永不为负是硬约束，这里不负责让它够。
 */
export function allocateTopUps(
  rows: readonly TopUpRow[],
  amount: Decimal,
): { allocations: TopUpAllocation[]; allocatedCNY: Decimal } {
  const allocations: TopUpAllocation[] = [];
  let left = money(amount);
  if (left.lessThanOrEqualTo(0)) {
    return { allocations, allocatedCNY: new Decimal(0) };
  }

  for (const row of rows) {
    if (left.lessThanOrEqualTo(0)) break;
    const remaining = Decimal.max(0, row.amountCNY.sub(row.consumedCNY));
    if (remaining.lessThanOrEqualTo(0)) continue;
    const take = money(Decimal.min(remaining, left));
    allocations.push({ id: row.id, version: row.version, consumeCNY: take });
    left = left.sub(take);
  }

  return {
    allocations,
    allocatedCNY: allocations.reduce(
      (sum, a) => sum.add(a.consumeCNY),
      new Decimal(0),
    ),
  };
}

/** 尚可用的追加额度合计。 */
export function sumTopUpRemaining(rows: readonly TopUpRow[]): Decimal {
  return rows.reduce(
    (sum, r) => sum.add(Decimal.max(0, r.amountCNY.sub(r.consumedCNY))),
    new Decimal(0),
  );
}
