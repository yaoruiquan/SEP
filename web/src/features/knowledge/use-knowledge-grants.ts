import { useKnowledgeCacheScope, knowledgeQueryOptions } from './knowledge-cache';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { KnowledgeMemberDisplay, KnowledgeMemberGrant, KnowledgePage } from '@/lib/types';
import { knowledgeQuery, type KnowledgeListParams } from './use-knowledge-bases';

export function useKnowledgeGrants(id: string | null, params: KnowledgeListParams = {}, enabled = true) {
  const scope = useKnowledgeCacheScope();
  return useQuery<KnowledgePage<KnowledgeMemberGrant>>({
    queryKey: ['knowledge-grants', id, params, scope],
    queryFn: () => api.get(`/knowledge-bases/${id}/grants?${knowledgeQuery(params)}`),
    enabled: !!id && enabled,
    ...knowledgeQueryOptions,
  });
}

export function useGrantableMembers(params: KnowledgeListParams = {}, enabled = true) {
  const scope = useKnowledgeCacheScope();
  return useQuery<KnowledgePage<KnowledgeMemberDisplay>>({
    queryKey: ['knowledge-grant-candidates', params, scope],
    queryFn: () => api.get(`/enterprise/members?view=knowledge-grant&${knowledgeQuery(params)}`),
    enabled,
    ...knowledgeQueryOptions,
  });
}

export function useCreateGrant(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { memberIds: string[] }) => api.post(`/knowledge-bases/${id}/grants`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge-grants', id] });
      qc.invalidateQueries({ queryKey: ['knowledge-bases'] });
    },
  });
}

export function useDeleteGrant(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => api.delete(`/knowledge-bases/${id}/grants/${memberId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge-grants', id] });
      qc.invalidateQueries({ queryKey: ['knowledge-bases'] });
    },
  });
}
