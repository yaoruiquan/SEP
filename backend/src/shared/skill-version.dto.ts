import { z } from 'zod';

export const SkillVersionScopeSchema = z.enum(['PLATFORM', 'ENTERPRISE', 'PERSONAL']);
export const SkillVersionStatusSchema = z.enum([
  'DRAFT',
  'PENDING_ENTERPRISE_REVIEW',
  'ENTERPRISE_APPROVED',
  'PENDING_PLATFORM_REVIEW',
  'PLATFORM_APPROVED',
  'ENTERPRISE_REJECTED',
  'PLATFORM_REJECTED',
  'ARCHIVED',
  'PERSONAL_ACTIVE',
]);

export const CreateEnterpriseSkillVersionDtoSchema = z.object({
  capabilityId: z.string().min(1),
  parentVersionId: z.string().min(1),
  changeSummary: z.string().trim().max(2000).optional(),
});

export const UpdateSkillVersionDtoSchema = z.object({
  content: z.string().min(1, '技能正文不能为空').max(500_000, '技能正文不能超过 500KB'),
  changeSummary: z.string().trim().max(2000).optional(),
});

export const ReviewSkillVersionDtoSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().trim().max(2000).optional(),
}).superRefine((value, ctx) => {
  if (value.decision === 'REJECT' && !value.comment) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['comment'],
      message: '驳回时必须填写原因',
    });
  }
});

export const SelectSkillVersionDtoSchema = z.object({
  versionId: z.string().min(1),
});

export const CreatePlatformSkillVersionDtoSchema = z.object({
  content: z.string().min(1, '技能正文不能为空').max(500_000, '技能正文不能超过 500KB'),
  changeSummary: z.string().trim().max(2000).optional(),
});

/**
 * 采纳成员的个人改动。
 *
 * 一个 id 是「逐条采纳」，多个 id 是「一键采纳多人改动」—— 会议两种都要，
 * 所以接口只有一个、靠数组长度区分，而不是两个端点。
 */
export const AdoptPersonalVersionsDtoSchema = z.object({
  sourceVersionIds: z
    .array(z.string().min(1))
    .min(1, '至少选择一条改动')
    .max(50, '一次最多采纳 50 条'),
  changeSummary: z.string().trim().max(2000).optional(),
});

export type CreateEnterpriseSkillVersionDto = z.infer<
  typeof CreateEnterpriseSkillVersionDtoSchema
>;
export type UpdateSkillVersionDto = z.infer<typeof UpdateSkillVersionDtoSchema>;
export type ReviewSkillVersionDto = z.infer<typeof ReviewSkillVersionDtoSchema>;
export type SelectSkillVersionDto = z.infer<typeof SelectSkillVersionDtoSchema>;
export type CreatePlatformSkillVersionDto = z.infer<
  typeof CreatePlatformSkillVersionDtoSchema
>;
export type AdoptPersonalVersionsDto = z.infer<
  typeof AdoptPersonalVersionsDtoSchema
>;

/**
 * 平台主动采纳一个企业版本（运营侧发起）。
 *
 * 会议纪要2 §6 的三层阶梯里，最上面那一级写的是「采纳与否由平台自己决定
 * （数据本身都在平台）」。此前只有企业管理员能发起（submitPlatformReview），
 * 运营在企业版本列表里看得到却动不了 —— 这个 DTO 补的是那条缺失的入口。
 */
export const AdoptEnterpriseVersionDtoSchema = z.object({
  /**
   * DRAFT   = 收成待审草稿，再走一遍现有的通过/驳回；
   * PUBLISH = 直接落成平台版并成为平台默认，跳过审核。
   */
  mode: z.enum(['DRAFT', 'PUBLISH']),
  changeSummary: z.string().trim().max(2000).optional(),
});

export type AdoptEnterpriseVersionDto = z.infer<typeof AdoptEnterpriseVersionDtoSchema>;
