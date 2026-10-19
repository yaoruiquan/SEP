import { z } from 'zod';

export const MediaKindSchema = z.enum(['image', 'video']);
export type MediaKind = z.infer<typeof MediaKindSchema>;

export const MediaOperationSchema = z.enum(['generate', 'edit']);
export type MediaOperation = z.infer<typeof MediaOperationSchema>;

export const MediaExecutionModeSchema = z.enum(['async-query', 'sync-response']);
export type MediaExecutionMode = z.infer<typeof MediaExecutionModeSchema>;

export const MediaCapabilitiesSchema = z.object({
  supportsReferenceImage: z.boolean().default(false),
  maxOutputs: z.number().int().min(1).max(8).default(1),
  sizes: z.array(z.string().regex(/^[1-9]\d{0,4}x[1-9]\d{0,4}$/)).min(1).max(32),
}).strict();

export const MediaProfileSchema = z.object({
  profileId: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/),
  kind: z.literal('image'),
  displayName: z.string().trim().min(1).max(80),
  modelId: z.string().trim().min(1).max(160),
  configVersion: z.string().trim().min(1).max(80),
  operations: z.array(MediaOperationSchema).min(1).max(2),
  executionMode: MediaExecutionModeSchema,
  capabilities: MediaCapabilitiesSchema,
  enabled: z.boolean(),
  verified: z.boolean(),
}).strict();
export type MediaProfile = z.infer<typeof MediaProfileSchema>;

export const MediaAvailableProfileSchema = MediaProfileSchema.omit({ modelId: true });
export type MediaAvailableProfile = z.infer<typeof MediaAvailableProfileSchema>;

export const MediaPolicySchema = z.object({
  enabledProfileIds: z.array(MediaProfileSchema.shape.profileId).max(100).default([]),
  defaultProfileId: z.string().nullable().default(null),
  allowedOperations: z.array(MediaOperationSchema).default(['generate', 'edit']),
  maxOutputs: z.number().int().min(1).max(8).default(4),
  maxWidth: z.number().int().min(1).max(16384).default(4096),
  maxHeight: z.number().int().min(1).max(16384).default(4096),
}).strict();
export type MediaPolicy = z.infer<typeof MediaPolicySchema>;

export const CreateMediaProfileDtoSchema = z.object({
  profileId: MediaProfileSchema.shape.profileId,
  kind: z.literal('image'),
  displayName: MediaProfileSchema.shape.displayName,
  modelId: MediaProfileSchema.shape.modelId,
  operations: MediaProfileSchema.shape.operations,
  executionMode: MediaProfileSchema.shape.executionMode,
  capabilities: MediaCapabilitiesSchema,
  enabled: z.boolean().default(false),
}).strict().superRefine((value, ctx) => {
  if (value.operations.includes('edit') && value.capabilities.supportsReferenceImage !== true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['capabilities', 'supportsReferenceImage'], message: '编辑能力必须支持参考图' });
  }
});
export type CreateMediaProfileDto = z.infer<typeof CreateMediaProfileDtoSchema>;

export const UpdateMediaProfileDtoSchema = z.object({
  displayName: MediaProfileSchema.shape.displayName.optional(),
  modelId: MediaProfileSchema.shape.modelId.optional(),
  operations: MediaProfileSchema.shape.operations.optional(),
  executionMode: MediaProfileSchema.shape.executionMode.optional(),
  capabilities: MediaCapabilitiesSchema.partial().optional(),
  enabled: z.boolean().optional(),
  expectedConfigVersion: MediaProfileSchema.shape.configVersion,
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'expectedConfigVersion'), '至少提供一个修改字段');
export type UpdateMediaProfileDto = z.infer<typeof UpdateMediaProfileDtoSchema>;

export const DiscoverMediaModelsDtoSchema = z.object({}).strict();
export const MediaModelDiscoverySchema = z.object({
  checkedAt: z.string().datetime(),
  models: z.array(z.object({
    modelId: MediaProfileSchema.shape.modelId,
    displayName: MediaProfileSchema.shape.displayName,
    compatible: z.boolean(),
    reason: z.string().nullable(),
    suggested: z.object({
      operations: MediaProfileSchema.shape.operations,
      executionMode: MediaExecutionModeSchema,
      capabilities: MediaCapabilitiesSchema,
    }).strict().nullable(),
  }).strict()).max(2000),
}).strict();
export type MediaModelDiscovery = z.infer<typeof MediaModelDiscoverySchema>;

export const VerifyMediaProfileDtoSchema = z.object({
  expectedConfigVersion: MediaProfileSchema.shape.configVersion,
}).strict();
export type VerifyMediaProfileDto = z.infer<typeof VerifyMediaProfileDtoSchema>;
export const MediaProfileVerificationSchema = z.object({
  profile: MediaProfileSchema,
  checkedAt: z.string().datetime(),
  executionTested: z.literal(false),
}).strict();
export type MediaProfileVerification = z.infer<typeof MediaProfileVerificationSchema>;

export const UpdateMediaConnectionDtoSchema = z.object({
  baseUrl: z.string().trim().url().superRefine((value, ctx) => {
    let url: URL;
    try { url = new URL(value); } catch { return; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '媒体连接必须是无内嵌凭据、查询或片段的 HTTP(S) sub2api 地址' });
    }
  }),
  /** 留空表示保留现有密钥，避免表单回填时覆盖密钥。 */
  apiKey: z.string().trim().max(4096).optional(),
}).strict();
export type UpdateMediaConnectionDto = z.infer<typeof UpdateMediaConnectionDtoSchema>;

export const UpdateMediaPolicyDtoSchema = z.object({
  enabledProfileIds: MediaPolicySchema.shape.enabledProfileIds.optional(),
  defaultProfileId: z.string().nullable().optional(),
  allowedOperations: z.array(MediaOperationSchema).min(1).optional(),
  maxOutputs: z.number().int().min(1).max(8).optional(),
  maxWidth: z.number().int().min(1).max(16384).optional(),
  maxHeight: z.number().int().min(1).max(16384).optional(),
}).strict();
export type UpdateMediaPolicyDto = z.infer<typeof UpdateMediaPolicyDtoSchema>;

export const MediaRuntimeProfileSchema = MediaProfileSchema.omit({ modelId: true, enabled: true, verified: true }).extend({
  capabilities: MediaCapabilitiesSchema.extend({
    maxWidth: z.number().int().positive(),
    maxHeight: z.number().int().positive(),
  }),
});

export const MediaRuntimeSchema = z.object({
  protocolVersion: z.literal(1),
  executionAvailable: z.boolean(),
  defaultProfileId: z.string().nullable(),
  tools: z.array(z.string()),
  profiles: z.array(MediaRuntimeProfileSchema),
}).strict();
export type MediaRuntime = z.infer<typeof MediaRuntimeSchema>;

export const MediaRuntimeQuerySchema = z.object({
  mediaProtocolVersion: z.coerce.number().int().min(1).optional(),
  skillArtifactProtocolVersion: z.coerce.number().int().min(1).optional(),
}).strict();
export type MediaRuntimeQuery = z.infer<typeof MediaRuntimeQuerySchema>;
