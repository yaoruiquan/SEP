import { z } from 'zod';

// ── 消费日志查询参数 ──────────────────────────────────────────────────────

export const ConsumptionLogQuerySchema = z.object({
  type: z.enum(['COMPUTE', 'SUBSCRIPTION']).optional(),
  employeeId: z.string().optional(),
  memberId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.number().int().positive().optional().default(1),
  pageSize: z.number().int().positive().max(100).optional().default(20),
});

export type ConsumptionLogQuery = z.infer<typeof ConsumptionLogQuerySchema>;

// ── 消费日志详情 ──────────────────────────────────────────────────────────

export interface ConsumptionLogDetail {
  // 算力消费
  sessionId?: string;
  conversationTitle?: string;
  tokenCount?: number;
  modelName?: string;
  // 订阅消费
  subscriptionId?: string;
  planName?: string;
  billingCycle?: string;
}

export interface ConsumptionLog {
  id: string;
  createdAt: string;
  type: 'COMPUTE' | 'SUBSCRIPTION';
  amount: string; // Decimal as string
  employeeName: string;
  employeeId: string;
  memberName: string | null;
  memberId: string | null;
  detail: ConsumptionLogDetail;
}

export interface ConsumptionLogResponse {
  logs: ConsumptionLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── Top 消费排行 ──────────────────────────────────────────────────────────

export interface TopConsumer {
  employeeId: string;
  employeeName: string;
  employeeAvatar: string | null;
  totalAmount: string; // Decimal as string
  callCount: number;
  percentage: number;
}

export interface TopConsumersResponse {
  consumers: TopConsumer[];
  totalAmount: string;
}
