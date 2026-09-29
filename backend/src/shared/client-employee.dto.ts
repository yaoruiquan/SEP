import { z } from 'zod';

export const ClientPlatformEmployeeQuerySchema = z.object({
  keyword: z.string().trim().max(100).optional(),
  capabilityId: z.string().trim().min(1).max(100).optional(),
  functionalCategory: z
    .enum([
      'TECH',
      'PRODUCT_DESIGN',
      'MARKETING_GROWTH',
      'ECOMMERCE',
      'SALES_CUSTOMER',
      'OPERATIONS_ORG',
      'FINANCE_LEGAL',
    ])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum(['updatedAt_desc', 'createdAt_desc', 'name_asc'])
    .default('updatedAt_desc'),
});

export type ClientPlatformEmployeeQuery = z.infer<
  typeof ClientPlatformEmployeeQuerySchema
>;

export const ClientEmployeeAccessRequestSchema = z
  .object({
    targetType: z.enum(['ENTERPRISE_SUBSCRIPTION', 'PLATFORM_EMPLOYEE']),
    subscriptionId: z.string().trim().min(1).max(100).nullable().optional(),
    employeeId: z.string().trim().min(1).max(100).nullable().optional(),
    reason: z.string().trim().min(1).max(2000),
    requestedCapabilities: z
      .array(z.string().trim().min(1).max(100))
      .max(50)
      .default([]),
  })
  .superRefine((value, ctx) => {
    if (value.targetType === 'ENTERPRISE_SUBSCRIPTION' && !value.subscriptionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subscriptionId'],
        message: '企业订阅申请必须提供 subscriptionId',
      });
    }
    if (value.targetType === 'PLATFORM_EMPLOYEE' && !value.employeeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['employeeId'],
        message: '平台员工申请必须提供 employeeId',
      });
    }
  });

export type ClientEmployeeAccessRequest = z.infer<
  typeof ClientEmployeeAccessRequestSchema
>;

export interface ClientPlatformEmployeeItem {
  employeeId: string;
  name: string;
  avatar: string | null;
  avatarAsset: unknown;
  position: string;
  description: string;
  functionalCategory: string;
  employeeStatus: string;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  canApply: boolean;
  capabilities: Array<{
    id: string;
    name: string;
    description: string;
    type: string;
  }>;
  updatedAt: string;
}

export interface ClientPlatformEmployeeListResponse {
  items: ClientPlatformEmployeeItem[];
  page: number;
  pageSize: number;
  total: number;
  hasNextPage: boolean;
}
