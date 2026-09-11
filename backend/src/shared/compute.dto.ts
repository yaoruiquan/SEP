import { z } from 'zod';

// ============================================================================
// Compute Account DTOs
// ============================================================================

export const RechargeCreateDtoSchema = z.object({
  amount: z.number().positive().min(1),
  description: z.string().max(200).optional(),
});
export type RechargeCreateDto = z.infer<typeof RechargeCreateDtoSchema>;

/**
 * 钱包自由余额 ↔ 算力专款 的划转。
 *
 * 上限 100 万只是防手滑多按几个零 —— 真实校验在服务端（不能超过可划入余额）。
 * 两位小数：财务口径就是元，六位小数是数据库为累计误差留的余量，不是输入口径。
 */
export const ComputeReserveDtoSchema = z.object({
  amount: z.number().positive().max(1_000_000).multipleOf(0.01),
});
export type ComputeReserveDto = z.infer<typeof ComputeReserveDtoSchema>;

/**
 * 给碳基员工分配算力额度。
 *
 * `limitCNY: null` = 取消限额。用 nullable 而不是 optional：
 * 「没传」和「明确要求不限额」必须能区分，否则清空额度会变成静默无操作。
 */
export const AllowancePeriodSchema = z.enum([
  'DAY',
  'WEEK',
  'MONTH',
  'QUARTER',
  'YEAR',
]);
export type AllowancePeriodDto = z.infer<typeof AllowancePeriodSchema>;

export const MemberAllowanceSetDtoSchema = z.object({
  /** 旧版单周期字段，保留兼容；新页面使用 dailyLimitCNY/monthlyLimitCNY。 */
  limitCNY: z.number().positive().max(1_000_000).multipleOf(0.01).nullable().optional(),
  dailyLimitCNY: z.number().positive().max(1_000_000).multipleOf(0.01).nullable().optional(),
  monthlyLimitCNY: z.number().positive().max(1_000_000).multipleOf(0.01).nullable().optional(),
  /** ISO 时间；设为当天结束时间表示临时放开今日每日限额。 */
  dailyBypassUntil: z.string().datetime().nullable().optional(),
  /// 结算周期。不传 = 沿用现有设置（新建时默认自然月）。
  period: AllowancePeriodSchema.optional(),
  /// 未用完是否结转到下一周期（上限固定 1 个周期，即最多攒到 2 倍）。
  /// 不传 = 沿用现有设置（新建时默认结转）。
  carryOver: z.boolean().optional(),
  /// 变更备注，写进 MemberAllowanceChange 留痕。
  note: z.string().max(200).optional(),
});
export type MemberAllowanceSetDto = z.infer<typeof MemberAllowanceSetDtoSchema>;

/**
 * 给某成员充值企业算力余额。
 *
 * 与「调高上限」不同：充值余额**跨周期存活**，企业钱包在充值时立即扣款，
 * 月度额度仍独立限制每周期消费。
 */
export const MemberAllowanceTopUpDtoSchema = z.object({
  amountCNY: z.number().positive().max(1_000_000).multipleOf(0.01),
  note: z.string().max(200).optional(),
});
export type MemberAllowanceTopUpDto = z.infer<
  typeof MemberAllowanceTopUpDtoSchema
>;

/**
 * 个人充值下单（成员自掏腰包）。
 *
 * 这个 DTO 只决定「下多少钱的单」，不决定余额 —— 余额由支付回调履约。
 * 上限 10 万：个人自费的量级，超出多半是把企业充值当成了这里。
 */
export const PersonalRechargeCreateDtoSchema = z.object({
  amountCNY: z.number().positive().max(100_000).multipleOf(0.01),
  /** 支付完成后跳回的前端地址；不传则用后端默认的结果页 */
  returnUrl: z.string().url().max(500).optional(),
});
export type PersonalRechargeCreateDto = z.infer<
  typeof PersonalRechargeCreateDtoSchema
>;

export const TransactionQueryDtoSchema = z.object({
  type: z.enum(['RECHARGE', 'CONSUME', 'REFUND']).optional(),
  startDate: z.string().optional(), // ISO date string YYYY-MM-DD
  endDate: z.string().optional(),   // ISO date string YYYY-MM-DD
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type TransactionQueryDto = z.infer<typeof TransactionQueryDtoSchema>;

export interface ComputeAccountView {
  id: string;
  balance: number;
  enterpriseId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ComputeTransactionView {
  id: string;
  type: 'RECHARGE' | 'CONSUME' | 'REFUND';
  amount: number;
  description: string | null;
  sessionId: string | null;
  createdAt: string;
  metadata?: any;
}

export interface ComputeStatsView {
  balance: number;
  todayConsume: number;
  monthConsume: number;
  trendData: Array<{ date: string; amount: number }>;
}
