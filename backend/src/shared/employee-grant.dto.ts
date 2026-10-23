import { z } from "zod";

export const EMPLOYEE_GRANT_BATCH_LIMIT = 100;

const targetIds = z
  .array(z.string().trim().min(1))
  .min(1)
  .max(EMPLOYEE_GRANT_BATCH_LIMIT)
  .refine((ids) => new Set(ids).size === ids.length, "授权对象不能重复");

export const GrantBatchCreateDtoSchema = z
  .object({
    memberIds: targetIds.optional(),
    departmentIds: targetIds.optional(),
    expiresAt: z.string().datetime().optional(),
    renewExpired: z.boolean().default(false),
  })
  .strict()
  .refine(
    (data) => Boolean(data.memberIds) !== Boolean(data.departmentIds),
    "请选择成员或部门，不能同时指定或都不指定",
  );

export type GrantBatchCreateDto = z.infer<typeof GrantBatchCreateDtoSchema>;

export interface GrantBatchResult {
  target: "member" | "department";
  createdIds: string[];
  renewedIds: string[];
  skippedIds: string[];
}
