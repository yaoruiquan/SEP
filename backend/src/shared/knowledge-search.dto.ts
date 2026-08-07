import { z } from 'zod';

/**
 * 知识库检索请求
 */
export const KnowledgeSearchDtoSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(1000),
  instanceId: z.string().cuid('Invalid instance ID'),
  topK: z.number().int().min(1).max(20).optional().default(5),
  scoreThreshold: z.number().min(0).max(1).optional().default(0.7),
});

export type KnowledgeSearchDto = z.infer<typeof KnowledgeSearchDtoSchema>;

/**
 * 知识库检索响应
 */
export const KnowledgeSearchResultSchema = z.object({
  content: z.string(),
  source: z.string(),
  score: z.number(),
  knowledgeBaseId: z.string(),
  chunkId: z.string(),
});

export type KnowledgeSearchResult = z.infer<typeof KnowledgeSearchResultSchema>;

/**
 * 按知识库 ID 搜索请求
 */
export const SearchByKnowledgeBaseDtoSchema = z.object({
  query: z.string().min(1).max(1000),
  knowledgeBaseIds: z.array(z.string().cuid()).min(1, 'At least one knowledge base required'),
  topK: z.number().int().min(1).max(20).optional().default(5),
  scoreThreshold: z.number().min(0).max(1).optional().default(0.7),
});

export type SearchByKnowledgeBaseDto = z.infer<typeof SearchByKnowledgeBaseDtoSchema>;
