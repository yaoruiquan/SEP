import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── 类型 ──────────────────────────────────────────────────────────────────────

export interface KnowledgeGrant {
  id: string;
  knowledgeBaseId: string;
  subscriptionId: string | null;
  departmentId: string | null;
  createdAt: string;
  subscription?: {
    id: string;
    /** 企业自定义称呼，可能为空 */
    name: string | null;
    employee: { id: string; name: string };
  } | null;
  department?: {
    id: string;
    name: string;
  } | null;
}

/** 授权对象：雇佣关系。收敛后即「本企业在册的某个硅基员工」 */
export interface GrantableSubscription {
  id: string;
  name: string;
  status: string;
  employee: {
    id: string;
    name: string;
    avatar: string | null;
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/** 知识库授权列表 */
export function useKnowledgeGrants(knowledgeBaseId: string | null) {
  return useQuery<KnowledgeGrant[]>({
    queryKey: ['knowledge-grants', knowledgeBaseId],
    queryFn: () => api.get<KnowledgeGrant[]>(`/knowledge-bases/${knowledgeBaseId}/grants`),
    enabled: !!knowledgeBaseId,
  });
}

/** 企业雇佣关系列表（用于选择授权对象） */
export function useGrantableSubscriptions() {
  return useQuery<GrantableSubscription[]>({
    queryKey: ['subscriptions'],
    queryFn: () => api.get<GrantableSubscription[]>('/subscriptions'),
  });
}

/** 创建授权 */
export function useCreateGrant(knowledgeBaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { subscriptionId?: string; departmentId?: string }) =>
      api.post<KnowledgeGrant>(`/knowledge-bases/${knowledgeBaseId}/grants`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge-grants', knowledgeBaseId] });
      qc.invalidateQueries({ queryKey: ['knowledge-bases', knowledgeBaseId] });
    },
  });
}

/** 删除授权 */
export function useDeleteGrant(knowledgeBaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) =>
      api.delete<{ success: boolean }>(`/knowledge-bases/grants/${grantId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge-grants', knowledgeBaseId] });
      qc.invalidateQueries({ queryKey: ['knowledge-bases', knowledgeBaseId] });
    },
  });
}
