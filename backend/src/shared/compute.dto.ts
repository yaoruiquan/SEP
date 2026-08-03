import { z } from 'zod';

// ============================================================================
// Compute Account DTOs
// ============================================================================

export const RechargeCreateDtoSchema = z.object({
  amount: z.number().positive().min(1),
  description: z.string().max(200).optional(),
});
export type RechargeCreateDto = z.infer<typeof RechargeCreateDtoSchema>;

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
