import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

interface TextChunk {
  id: string;
  title: string | null;
  content: string;
  source: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  creator: {
    id: string;
    name: string | null;
    email: string;
  } | null;
}

interface CreateTextChunkDto {
  title?: string;
  content: string;
  tags?: string[];
}

interface UpdateTextChunkDto {
  title?: string;
  content?: string;
  tags?: string[];
}

/**
 * 获取知识库的文本片段列表
 */
export function useTextChunks(knowledgeBaseId: string | null, search?: string) {
  return useQuery<TextChunk[]>({
    queryKey: ['text-chunks', knowledgeBaseId, search],
    queryFn: async () => {
      if (!knowledgeBaseId) throw new Error('No knowledge base ID');
      const params = search ? `?search=${encodeURIComponent(search)}` : '';
      const data = await api.get<TextChunk[]>(
        `/knowledge-bases/${knowledgeBaseId}/chunks${params}`
      );
      return data;
    },
    enabled: !!knowledgeBaseId,
  });
}

/**
 * 获取单个文本片段详情
 */
export function useTextChunk(knowledgeBaseId: string | null, chunkId: string | null) {
  return useQuery<TextChunk>({
    queryKey: ['text-chunks', knowledgeBaseId, chunkId],
    queryFn: async () => {
      if (!knowledgeBaseId || !chunkId) throw new Error('Missing IDs');
      const data = await api.get<TextChunk>(
        `/knowledge-bases/${knowledgeBaseId}/chunks/${chunkId}`
      );
      return data;
    },
    enabled: !!knowledgeBaseId && !!chunkId,
  });
}

/**
 * 创建文本片段
 */
export function useCreateTextChunk(knowledgeBaseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateTextChunkDto) => {
      return await api.post<TextChunk>(`/knowledge-bases/${knowledgeBaseId}/chunks`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['text-chunks', knowledgeBaseId] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases', knowledgeBaseId] });
    },
  });
}

/**
 * 更新文本片段
 */
export function useUpdateTextChunk(knowledgeBaseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateTextChunkDto }) => {
      return await api.patch<TextChunk>(
        `/knowledge-bases/${knowledgeBaseId}/chunks/${id}`,
        data
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['text-chunks', knowledgeBaseId] });
      queryClient.invalidateQueries({
        queryKey: ['text-chunks', knowledgeBaseId, variables.id],
      });
    },
  });
}

/**
 * 删除文本片段
 */
export function useDeleteTextChunk(knowledgeBaseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (chunkId: string) => {
      await api.delete(`/knowledge-bases/${knowledgeBaseId}/chunks/${chunkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['text-chunks', knowledgeBaseId] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases', knowledgeBaseId] });
    },
  });
}
