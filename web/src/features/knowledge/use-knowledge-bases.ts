import { useKnowledgeCacheScope, knowledgeQueryOptions } from './knowledge-cache';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { KnowledgeBase, KnowledgeBaseDetail, KnowledgeBaseList } from '@/lib/types';

export interface KnowledgeListParams { page?: number; pageSize?: number; keyword?: string }

export function knowledgeQuery(params: KnowledgeListParams = {}) {
  const query = new URLSearchParams({ page: String(params.page ?? 1), pageSize: String(params.pageSize ?? 20) });
  if (params.keyword?.trim()) query.set('keyword', params.keyword.trim());
  return query.toString();
}

export function useKnowledgeBases(params: KnowledgeListParams = {}, enabled = true) {
  const scope = useKnowledgeCacheScope();
  return useQuery<KnowledgeBaseList>({
    queryKey: ['knowledge-bases', 'list', params, scope],
    queryFn: () => api.get(`/knowledge-bases?${knowledgeQuery(params)}`),
    enabled,
    ...knowledgeQueryOptions,
    // Keep pagination smooth without carrying data across identity boundaries.
    placeholderData: (previous, query) => query?.queryKey.at(-1) === scope ? previous : undefined,
  });
}

export function useKnowledgeBase(id: string | null, enabled = true) {
  const scope = useKnowledgeCacheScope();
  return useQuery<KnowledgeBaseDetail>({
    queryKey: ['knowledge-bases', 'detail', id, scope],
    queryFn: () => api.get(`/knowledge-bases/${id}`),
    enabled: !!id && enabled,
    ...knowledgeQueryOptions,
  });
}

export function useCreateKnowledgeBase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string }) => api.post<KnowledgeBase>('/knowledge-bases', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['knowledge-bases'] }); },
  });
}

export function useUpdateKnowledgeBase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; description?: string | null } }) =>
      api.patch<KnowledgeBase>(`/knowledge-bases/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['knowledge-bases'] }); },
  });
}

export function useDeleteKnowledgeBase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/knowledge-bases/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['knowledge-bases'] }); },
  });
}
