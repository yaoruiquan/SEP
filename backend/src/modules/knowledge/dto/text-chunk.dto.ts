import { z } from 'zod';

/**
 * 创建文本片段
 */
export const CreateTextChunkDtoSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(200, '标题最多 200 字符').optional(),
  content: z.string().min(1, '内容不能为空').max(10000, '内容最多 10000 字符'),
  tags: z.array(z.string()).max(10, '最多 10 个标签').optional(),
});

export type CreateTextChunkDto = z.infer<typeof CreateTextChunkDtoSchema>;

/**
 * 更新文本片段
 */
export const UpdateTextChunkDtoSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(200, '标题最多 200 字符').optional(),
  content: z.string().min(1, '内容不能为空').max(10000, '内容最多 10000 字符').optional(),
  tags: z.array(z.string()).max(10, '最多 10 个标签').optional(),
});

export type UpdateTextChunkDto = z.infer<typeof UpdateTextChunkDtoSchema>;

/**
 * 文本片段列表项
 */
export const TextChunkListItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  content: z.string(),
  source: z.string(),
  tags: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
  creator: z.object({
    id: z.string(),
    name: z.string().nullable(),
    email: z.string(),
  }).nullable(),
});

export type TextChunkListItemDto = z.infer<typeof TextChunkListItemSchema>;
