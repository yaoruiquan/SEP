import { z } from 'zod';

// ============================================================================
// Compute Account DTOs
// ============================================================================

export const RechargeCreateDtoSchema = z.object({
  amount: z.number().positive().min(1),
  description: z.string().max(200).optional(),
});
export type RechargeCreateDto = z.infer<typeof RechargeCreateDtoSchema>;

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
