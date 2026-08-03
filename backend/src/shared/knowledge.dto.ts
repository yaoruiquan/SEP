import { z } from 'zod';

// ============================================================================
// Knowledge Base DTOs
// ============================================================================

export const KnowledgeBaseCreateDtoSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});
export type KnowledgeBaseCreateDto = z.infer<typeof KnowledgeBaseCreateDtoSchema>;

export const KnowledgeBaseUpdateDtoSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
});
export type KnowledgeBaseUpdateDto = z.infer<typeof KnowledgeBaseUpdateDtoSchema>;

export const DocumentUploadDtoSchema = z.object({
  // File upload handled by multer, metadata validation only
  originalName: z.string().min(1),
  mimeType: z.string(),
  fileSize: z.number().int().positive(),
});
export type DocumentUploadDto = z.infer<typeof DocumentUploadDtoSchema>;

export const KnowledgeGrantCreateDtoSchema = z.object({
  instanceId: z.string().optional(),
  departmentId: z.string().optional(),
}).refine(data => data.instanceId || data.departmentId, {
  message: 'Either instanceId or departmentId must be provided',
});
export type KnowledgeGrantCreateDto = z.infer<typeof KnowledgeGrantCreateDtoSchema>;
