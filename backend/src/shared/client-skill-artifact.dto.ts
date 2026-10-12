import { z } from 'zod';

export const SkillArtifactSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const SkillArtifactNameSchema = z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const SkillArtifactIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const SkillArtifactFrontmatterSchema = z.object({
  name: SkillArtifactNameSchema,
  description: z.string().min(1).max(1024).refine((value) => value.trim().length > 0),
  license: z.string().optional(),
  compatibility: z.string().min(1).max(500).optional(),
  metadata: z.record(z.string()).optional(),
  'allowed-tools': z.string().optional(),
}).passthrough();

const identity = {
  protocolVersion: z.literal(1),
  capabilityId: SkillArtifactIdSchema,
  versionId: SkillArtifactIdSchema,
  approvedContentSha256: SkillArtifactSha256Schema,
};

export const SkillArtifactBlockedReasonSchema = z.enum([
  'INVALID_ENTRY', 'PACKAGE_REQUIRED', 'PACKAGE_UNAVAILABLE', 'PACKAGE_CONTENT_MISMATCH',
]);

export const ClientSkillArtifactAvailableSchema = z.object({
    ...identity,
    status: z.literal('AVAILABLE'),
    format: z.enum(['single-file', 'zip']),
    installationDirectory: SkillArtifactNameSchema,
    entryPath: z.string().max(1024).refine((value) => {
      const parts = value.split('/');
      return parts.at(-1) === 'SKILL.md' && parts.every((part) => part.length > 0 && part !== '.' && part !== '..')
        && !/[\\\x00-\x1f\x7f:]/.test(value);
    }, '入口必须为安全相对路径'),
    entrySha256: SkillArtifactSha256Schema,
    artifactSha256: SkillArtifactSha256Schema,
    byteLength: z.number().int().positive().max(20 * 1024 * 1024),
    fileCount: z.number().int().positive().max(500),
    downloadPath: z.string().regex(/^\/client\/subscriptions\/[a-zA-Z0-9_-]{1,128}\/skills\/[a-zA-Z0-9_-]{1,128}\/versions\/[a-zA-Z0-9_-]{1,128}\/artifact$/),
  }).strict();
export const ClientSkillArtifactBlockedSchema = z.object({ ...identity, status: z.literal('BLOCKED'), reason: SkillArtifactBlockedReasonSchema }).strict();
export const ClientSkillArtifactSchema = z.discriminatedUnion('status', [
  ClientSkillArtifactAvailableSchema,
  ClientSkillArtifactBlockedSchema,
]);
export type ClientSkillArtifact = z.infer<typeof ClientSkillArtifactSchema>;
export type ClientSkillArtifactAvailable = z.infer<typeof ClientSkillArtifactAvailableSchema>;
export type ClientSkillArtifactBlocked = z.infer<typeof ClientSkillArtifactBlockedSchema>;
export type SkillArtifactBlockedReason = z.infer<typeof SkillArtifactBlockedReasonSchema>;

export const ClientSkillArtifactParamsSchema = z.object({
  subscriptionId: SkillArtifactIdSchema,
  capabilityId: SkillArtifactIdSchema,
  versionId: SkillArtifactIdSchema,
}).strict();
export type ClientSkillArtifactParams = z.infer<typeof ClientSkillArtifactParamsSchema>;
