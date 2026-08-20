import { z } from 'zod';

export const SkillVersionScopeSchema = z.enum(['PLATFORM', 'ENTERPRISE']);
export const SkillVersionStatusSchema = z.enum([
  'DRAFT',
  'PENDING_ENTERPRISE_REVIEW',
  'ENTERPRISE_APPROVED',
  'PENDING_PLATFORM_REVIEW',
  'PLATFORM_APPROVED',
  'ENTERPRISE_REJECTED',
  'PLATFORM_REJECTED',
  'ARCHIVED',
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

export type CreateEnterpriseSkillVersionDto = z.infer<
  typeof CreateEnterpriseSkillVersionDtoSchema
>;
export type UpdateSkillVersionDto = z.infer<typeof UpdateSkillVersionDtoSchema>;
export type ReviewSkillVersionDto = z.infer<typeof ReviewSkillVersionDtoSchema>;
export type SelectSkillVersionDto = z.infer<typeof SelectSkillVersionDtoSchema>;
export type CreatePlatformSkillVersionDto = z.infer<
  typeof CreatePlatformSkillVersionDtoSchema
>;
