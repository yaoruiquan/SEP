import { z } from 'zod';

// ── 创建充值订单 DTO ───────────────────────────────────────────────────────
export const CreateRechargeOrderDtoSchema = z.object({
  amount: z.number().min(1, '充值金额必须大于等于 1 元'),
});

export type CreateRechargeOrderDto = z.infer<typeof CreateRechargeOrderDtoSchema>;

// ── 充值订单响应 DTO ───────────────────────────────────────────────────────
export const RechargeOrderResponseDtoSchema = z.object({
  orderId: z.string(),
  orderNo: z.string(),
  amount: z.number(),
  status: z.enum(['PENDING', 'PAID', 'CLOSED']),
  paymentUrl: z.string().optional(),
  createdAt: z.string(),
});

export type RechargeOrderResponseDto = z.infer<typeof RechargeOrderResponseDtoSchema>;
