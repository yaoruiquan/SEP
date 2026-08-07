import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { KnowledgeBase, KnowledgeBaseDetail } from '@/lib/types';

interface CreateKnowledgeBaseDto {
  name: string;
  description?: string;
}

interface UpdateKnowledgeBaseDto {
  name?: string;
  description?: string;
}

/**
 * 获取知识库列表
 */
export function useKnowledgeBases() {
  return useQuery<KnowledgeBase[]>({
    queryKey: ['knowledge-bases'],
    queryFn: async () => {
      const data = await api.get<KnowledgeBase[]>('/knowledge');
      return data;
    },
  });
}

/**
 * 获取知识库详情
 */
export function useKnowledgeBase(id: string | null) {
  return useQuery<KnowledgeBaseDetail>({
    queryKey: ['knowledge-bases', id],
    queryFn: async () => {
      if (!id) throw new Error('No knowledge base ID');
      const data = await api.get<KnowledgeBaseDetail>(`/knowledge/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

/**
 * 创建知识库
 */
export function useCreateKnowledgeBase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateKnowledgeBaseDto) => {
      return await api.post<KnowledgeBase>('/knowledge', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
    },
  });
}

/**
 * 更新知识库
 */
export function useUpdateKnowledgeBase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateKnowledgeBaseDto }) => {
      return await api.patch<KnowledgeBase>(`/knowledge/${id}`, data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases', variables.id] });
    },
  });
}

/**
 * 删除知识库
 */
export function useDeleteKnowledgeBase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/knowledge/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
    },
  });
}
