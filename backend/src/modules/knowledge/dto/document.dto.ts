import { z } from 'zod';

/**
 * 文档上传响应
 */
export const DocumentUploadResponseSchema = z.object({
  id: z.string(),
  knowledgeBaseId: z.string(),
  filename: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  size: z.number(),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']),
  createdAt: z.date(),
});

export type DocumentUploadResponseDto = z.infer<typeof DocumentUploadResponseSchema>;

/**
 * 文档列表项
 */
export const DocumentListItemSchema = z.object({
  id: z.string(),
  filename: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  size: z.number(),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']),
  chunkCount: z.number().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type DocumentListItemDto = z.infer<typeof DocumentListItemSchema>;
