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

export const SubmitPersonalSkillVersionDtoSchema = UpdateSkillVersionDtoSchema.extend({
  capabilityId: z.string().min(1).max(128),
  parentVersionId: z.string().min(1).max(128),
}).strict();

export const SkillSubmissionKeySchema = z.string().min(16).max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Idempotency-Key 仅支持字母、数字、下划线和连字符');

export const PersonalSkillReviewQuerySchema = z.object({
  status: z.enum(['PENDING_ENTERPRISE_REVIEW', 'ENTERPRISE_APPROVED', 'ENTERPRISE_REJECTED'])
    .default('PENDING_ENTERPRISE_REVIEW'),
  capabilityId: z.string().min(1).max(128).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const PersonalSkillDiffQuerySchema = PersonalSkillReviewQuerySchema.omit({ status: true }).extend({
  status: z.enum(['PENDING_ENTERPRISE_REVIEW', 'ENTERPRISE_APPROVED', 'ENTERPRISE_REJECTED']).optional(),
});

export type SubmitPersonalSkillVersionDto = z.infer<typeof SubmitPersonalSkillVersionDtoSchema>;
export type PersonalSkillReviewQuery = z.infer<typeof PersonalSkillReviewQuerySchema>;
export type PersonalSkillDiffQuery = z.infer<typeof PersonalSkillDiffQuerySchema>;

export const ReviewSkillVersionDtoSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().trim().max(2000).optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
}).superRefine((value, ctx) => {
  if (value.decision === 'REJECT' && !value.comment) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['comment'],
      message: '驳回时必须填写原因',
    });
  }
});

export const SelectPersonalSkillVersionDtoSchema = z.object({
  // 保留旧请求结构；个人 PIN 和 null/FOLLOW 写入均返回停用错误。
  versionId: z.string().min(1).nullable(),
});

export const SelectSkillVersionDtoSchema = z.object({
  versionId: z.string().min(1),
});

export const CreatePlatformSkillVersionDtoSchema = z.object({
  content: z.string().min(1, '技能正文不能为空').max(500_000, '技能正文不能超过 500KB'),
  changeSummary: z.string().trim().max(2000).optional(),
});

/** 保留旧请求结构；服务仅允许单条原文审核，拒绝多来源和正文覆盖。 */
export const AdoptPersonalVersionsDtoSchema = z.object({
  sourceVersionIds: z
    .array(z.string().min(1))
    .min(1, '至少选择一条改动')
    .max(50, '一次最多审核 50 条'),
  changeSummary: z.string().trim().max(2000).optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  expectedVersions: z.record(z.string().datetime({ offset: true })).optional(),
  expectedMergedContent: z.string().min(1).max(500_000).optional(),
});

export type CreateEnterpriseSkillVersionDto = z.infer<
  typeof CreateEnterpriseSkillVersionDtoSchema
>;
export type UpdateSkillVersionDto = z.infer<typeof UpdateSkillVersionDtoSchema>;
export type ReviewSkillVersionDto = z.infer<typeof ReviewSkillVersionDtoSchema>;
export type SelectPersonalSkillVersionDto = z.infer<typeof SelectPersonalSkillVersionDtoSchema>;
export type SelectSkillVersionDto = z.infer<typeof SelectSkillVersionDtoSchema>;
export type CreatePlatformSkillVersionDto = z.infer<
  typeof CreatePlatformSkillVersionDtoSchema
>;
export type AdoptPersonalVersionsDto = z.infer<
  typeof AdoptPersonalVersionsDtoSchema
>;

/** 运营全量版本监控；企业审核与平台处理独立筛选。 */
export const AdminSkillVersionQuerySchema = z.object({
  scope: SkillVersionScopeSchema.optional(),
  status: SkillVersionStatusSchema.optional(),
  enterpriseId: z.string().min(1).max(128).optional(),
  ownerId: z.string().min(1).max(128).optional(),
  enterpriseName: z.string().trim().max(200).optional(),
  ownerName: z.string().trim().max(200).optional(),
  capabilityId: z.string().min(1).max(128).optional(),
  enterpriseStatus: SkillVersionStatusSchema.optional(),
  enterpriseReviewStatus: z.enum(['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED']).optional(),
  platformProcessingStatus: z.enum(['NOT_SUBMITTED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED']).optional(),
  platformStatus: z.enum([
    'NOT_SELECTED', 'DRAFT', 'PENDING_PLATFORM_REVIEW', 'PLATFORM_APPROVED', 'PLATFORM_REJECTED', 'ARCHIVED',
  ]).optional(),
  search: z.string().trim().max(200).optional(),
  generationType: z.enum(['CLIENT_SUBMISSION', 'LEGACY_WORKING_COPY', 'REVIEW_SNAPSHOT', 'ENTERPRISE_VERSION', 'PLATFORM_CREATED', 'PLATFORM_SELECTED']).optional(),
  createdFrom: z.string().datetime({ offset: true }).optional(),
  createdTo: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).refine((value) => !value.createdFrom || !value.createdTo || new Date(value.createdFrom) <= new Date(value.createdTo),
  { path: ['createdTo'], message: '结束时间不能早于开始时间' });
export type AdminSkillVersionQuery = z.infer<typeof AdminSkillVersionQuerySchema>;

export const SubmitAdminPlatformReviewDtoSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
}).strict();
export type SubmitAdminPlatformReviewDto = z.infer<typeof SubmitAdminPlatformReviewDtoSchema>;

/** 保留旧请求名；选择任意个人／企业来源均须进入平台审核。 */
export const AdoptEnterpriseVersionDtoSchema = z.object({
  mode: z.literal('DRAFT').default('DRAFT'),
  changeSummary: z.string().trim().max(2000).optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
}).strict();
export type AdoptEnterpriseVersionDto = z.infer<typeof AdoptEnterpriseVersionDtoSchema>;

export const PublishPlatformSkillVersionDtoSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  expectedPlatformVersionId: z.string().min(1).max(128).nullable(),
  changeSummary: z.string().trim().max(2000).optional(),
}).strict();
export type PublishPlatformSkillVersionDto = z.infer<typeof PublishPlatformSkillVersionDtoSchema>;
