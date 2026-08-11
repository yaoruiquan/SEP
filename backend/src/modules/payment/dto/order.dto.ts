import { z } from 'zod';

/**
 * 从购物车创建订单
 */
export const CreateOrderFromCartDtoSchema = z.object({
  // 未来可扩展：优惠券、备注等
});

export type CreateOrderFromCartDto = z.infer<typeof CreateOrderFromCartDtoSchema>;

/**
 * 订单列表查询参数
 */
export const GetOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.enum(['PENDING', 'PAID', 'CLOSED', 'REFUNDED']).optional(),
});

export type GetOrdersQuery = z.infer<typeof GetOrdersQuerySchema>;

/**
 * 支付宝支付参数
 */
export const AlipayPaymentDtoSchema = z.object({
  orderId: z.string(),
});

export type AlipayPaymentDto = z.infer<typeof AlipayPaymentDtoSchema>;
