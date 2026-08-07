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

// ============================================================================
// Phase 2: 检索测试 / 文档状态 / 分析 DTOs
// ============================================================================

/** 检索测试请求 */
export const TestSearchDtoSchema = z.object({
  query: z.string().min(1, '查询内容不能为空').max(1000),
  topK: z.number().int().min(1).max(20).optional().default(5),
  scoreThreshold: z.number().min(0).max(1).optional().default(0.5),
  useRerank: z.boolean().optional().default(false),
});
export type TestSearchDto = z.infer<typeof TestSearchDtoSchema>;

/** 批量重处理请求 */
export const BatchReprocessDtoSchema = z.object({
  /** 不传则重处理该知识库下所有 FAILED 文档 */
  documentIds: z.array(z.string()).optional(),
  /** 过滤状态，不传默认只重处理 FAILED */
  statuses: z.array(z.enum(['PENDING', 'PROCESSING', 'FAILED'])).optional(),
});
export type BatchReprocessDto = z.infer<typeof BatchReprocessDtoSchema>;
