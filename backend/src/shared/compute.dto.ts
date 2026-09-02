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
export const MemberAllowanceSetDtoSchema = z.object({
  limitCNY: z.number().positive().max(1_000_000).multipleOf(0.01).nullable(),
});
export type MemberAllowanceSetDto = z.infer<typeof MemberAllowanceSetDtoSchema>;

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
