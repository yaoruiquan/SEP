import type { Decimal } from "@prisma/client/runtime/library";
import type { AllowancePeriod } from "./allowance-period";
import type { TopUpRow } from "./allowance-carryover";

export interface AllowanceRow {
  id: string;
  enterpriseId: string;
  userId: string;
  limitCNY: Decimal | null;
  period: AllowancePeriod;
  carryOver: boolean;
  enabled: boolean;
  createdAt: Date;
}

/** 一位成员在某个周期窗口内的完整状态。 */
export interface WindowState {
  /** 未落库时为 null（不限额的成员不建窗口行） */
  windowId: string | null;
  periodStart: Date;
  periodEnd: Date;
  limitCNY: Decimal | null;
  carriedInCNY: Decimal;
  usedCNY: Decimal;
}

/** 一位碳基员工的算力分配情况。金额一律元，Decimal 序列化为字符串。 */
export interface MemberAllowanceView {
  userId: string;
  name: string;
  email: string;
  departmentName: string | null;
  /** null = 未分配额度（不限额） */
  limitCNY: string | null;
  period: AllowancePeriod;
  /** 周期口径的中文名（每月 / 每周 …），前端不必再维护一份映射 */
  periodLabel: string;
  carryOver: boolean;
  enabled: boolean;
  /** 上一周期结转进来的金额（元）。未开启结转或不限额时为 "0.00" */
  carriedInCNY: string;
  /** 本周期已消耗的**企业资金**（赠送 + 企业钱包 + 欠费，不含个人自付） */
  usedCNY: string;
  /** 常规额度（上限 + 结转）还剩多少。不限额时为 null */
  remainingCNY: string | null;
  /** 未用完的一次性追加额度合计（跨周期存活） */
  topUpRemainingCNY: string;
  /** 常规 + 追加，本周期还能花的企业资金合计。不限额时为 null */
  totalRemainingCNY: string | null;
  /** 已用占「上限 + 结转」的百分比（0–100）。不限额时为 null */
  usedPct: number | null;
  /** 本周期开始时刻 */
  periodStart: string;
  /** 本周期结束、额度重置的时刻 */
  resetAt: string;
}

/**
 * 闸门判定结果。
 *
 * 两个布尔值刻意分开：额度用尽**不是**「不能对话」，而是「不能再花公司的钱」。
 * 个人钱包有余额时对话照常发生，只是这次由成员自己付（方案 §5.7 ④ 改道语义）。
 */
export interface AllowanceCheckResult {
  /** 能否动用企业资金（订阅赠送额度 + 企业钱包） */
  enterpriseFundsAllowed: boolean;
  /** 本次对话能否发生（企业资金 or 个人余额任一可用） */
  allowed: boolean;
  /** 拦下或改道的说明。allowed 为 true 且走企业资金时为 undefined */
  reason?: string;
  /** 命中的周期窗口 id，扣费时写进账单，账单因此能按周期归集 */
  windowId?: string;
  limitCNY?: string;
  usedCNY?: string;
  /** 常规 + 追加还剩多少企业资金 */
  remainingCNY?: string;
  personalBalanceCNY?: string;
}

/**
 * 扣费事务内的额度计划：**企业资金这一笔最多能出多少**，以及回写追加额度所需的原料。
 *
 * 分「先算计划、扣完再落账」两步，是因为闸门必须在扣企业资金**之前**给出上限：
 * 事后才发现超额，钱已经从企业钱包出去了。两步共用一次窗口解析与一次追加额度
 * 读取，热路径（每轮对话都跑）不会因为拆成两步而多打库。
 *
 * `enterpriseCapCNY` 是金额而不是布尔值：剩 ¥0.30 时来了一笔 ¥0.50 的调用，
 * 布尔值只能二选一 —— 要么让公司超额付 ¥0.50，要么让成员自付 ¥0.50 而白白
 * 浪费公司给的 ¥0.30。给出金额上限，这笔自然拆成 0.30 + 0.20。
 */
export interface AllowanceChargePlan {
  /** 归属的周期窗口行；null = 这笔消费发生时该成员没有限额 */
  windowId: string | null;
  /** 企业资金本次最多能承担多少；null = 不限额，不设上限 */
  enterpriseCapCNY: Decimal | null;
  /** 常规额度（上限 + 结转）还剩多少 —— 超出这部分的才记到追加额度上 */
  regularRemainingCNY: Decimal;
  /**
   * 本周期上限快照；null = 不限额。
   *
   * 扣费本身不需要它（`enterpriseCapCNY` 已经把上限、结转、追加额度算成一个数），
   * 带上它是为了让扣完之后的**通知判定不再打库**：闸门刚刚把这一笔要用的
   * 全部数字读齐了，「已用是否过 80%」的分母就在其中，再查一遍是纯浪费 ——
   * 而这段判定每轮对话都要跑一次。
   */
  limitCNY: Decimal | null;
  /** 上一周期结转进来的额度。与 `limitCNY` 之和才是本周期常规预算（= 百分比的分母） */
  carriedInCNY: Decimal;
  /** 未用完的追加额度批次，按发放先后排列（含 version 供乐观锁） */
  topUps: readonly TopUpRow[];
}

/** 追加额度记录（管理端「额度变更记录」用）。 */
export interface MemberAllowanceTopUpView {
  id: string;
  userId: string;
  /** 成员姓名（无名字则回落邮箱）。留痕列表只有 userId 等于不可读 */
  userName: string;
  amountCNY: string;
  consumedCNY: string;
  remainingCNY: string;
  note: string | null;
  grantedByName: string | null;
  createdAt: string;
}

/** 额度变更留痕。 */
export interface MemberAllowanceChangeView {
  id: string;
  userId: string;
  /** 成员姓名（无名字则回落邮箱） */
  userName: string;
  fromLimitCNY: string | null;
  toLimitCNY: string | null;
  fromPeriod: AllowancePeriod | null;
  toPeriod: AllowancePeriod | null;
  fromCarryOver: boolean | null;
  toCarryOver: boolean | null;
  usedAtChangeCNY: string | null;
  changedByName: string | null;
  note: string | null;
  createdAt: string;
}
