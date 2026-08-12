import { z } from 'zod';

/**
 * 加入购物车 DTO
 */
export const AddToCartDtoSchema = z.object({
  employeeId: z.string().min(1), // 放宽验证：支持 cuid 和自定义 ID（如 demo-emp-skills）
  periodMonths: z.number().int().min(1).max(36).default(12),
  quantity: z.number().int().min(1).max(99).default(1),
});

export type AddToCartDto = z.infer<typeof AddToCartDtoSchema>;

/**
 * 更新购物车项 DTO
 */
export const UpdateCartItemDtoSchema = z.object({
  periodMonths: z.number().int().min(1).max(36).optional(),
  quantity: z.number().int().min(1).max(99).optional(),
});

export type UpdateCartItemDto = z.infer<typeof UpdateCartItemDtoSchema>;

/**
 * 购物车项响应（包含计算后的小计）
 */
export const CartItemResponseSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  employeeName: z.string(),
  employeeAvatar: z.string().nullable(),
  unitPrice: z.number(), // annualPriceCNY
  periodMonths: z.number(),
  quantity: z.number(),
  subtotal: z.number(), // unitPrice * quantity * (periodMonths / 12)
  includedComputeCNY: z.number(), // 该项赠送的总算力
  addedAt: z.date(),
});

export type CartItemResponse = z.infer<typeof CartItemResponseSchema>;

/**
 * 购物车汇总响应
 */
export const CartSummaryResponseSchema = z.object({
  items: z.array(CartItemResponseSchema),
  totalAmount: z.number(),
  totalIncludedCompute: z.number(),
  itemCount: z.number(),
});

export type CartSummaryResponse = z.infer<typeof CartSummaryResponseSchema>;
