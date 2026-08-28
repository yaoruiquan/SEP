import { Decimal } from '@prisma/client/runtime/library';

/** 赠送额度来源，用于对账时区分是哪条链路产生的额度。 */
export type CreditSourceType = 'subscription' | 'order' | 'migration';

export interface GrantCreditParams {
  subscriptionId: string;
  enterpriseId: string;
  employeeId: string;
  /** 赠送金额（元）。允许 0 —— 运营明确「本员工不赠送」。 */
  grantedCNY: number;
  sourceType: CreditSourceType;
  sourceId?: string | null;
}

export interface ChargeUsageParams {
  enterpriseId: string;
  /** 当前对话对应的订阅。缺失时整笔走企业钱包。 */
  subscriptionId?: string | null;
  employeeId?: string | null;
  userId?: string | null;
  sessionId: string;
  /** 幂等锚点：同一条 assistant 消息只入账一次。 */
  messageId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ChargeUsageResult {
  /** true = 幂等命中，本次没有产生新的扣费 */
  alreadyCharged: boolean;
  usageRecordId: string;
  costCNY: Decimal;
  creditPaidCNY: Decimal;
  walletPaidCNY: Decimal;
  /** > 0 表示余额已耗尽，本次消费有欠费 */
  unpaidCNY: Decimal;
  fallbackPricing: boolean;
}

export interface BalanceCheckResult {
  allowed: boolean;
  /** 该订阅剩余赠送余额（元） */
  creditRemainingCNY: number;
  /** 企业钱包可用余额（元） */
  walletBalanceCNY: number;
  /** 两者之和 —— 用户视角的「还能对话多少钱」 */
  totalAvailableCNY: number;
  reason?: string;
}

export interface SubscriptionCreditView {
  id: string;
  subscriptionId: string;
  employeeId: string;
  employeeName: string;
  employeeAvatar: string | null;
  grantedCNY: string;
  usedCNY: string;
  remainingCNY: string;
  status: string;
  grantedAt: Date;
}

export interface UsageRecordQuery {
  page?: number;
  pageSize?: number;
  employeeId?: string;
  memberId?: string;
  startDate?: string;
  endDate?: string;
}
