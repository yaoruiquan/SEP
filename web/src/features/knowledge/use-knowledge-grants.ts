import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── 类型 ──────────────────────────────────────────────────────────────────────

export interface KnowledgeGrant {
  id: string;
  knowledgeBaseId: string;
  instanceId: string | null;
  departmentId: string | null;
  createdAt: string;
  instance?: {
    id: string;
    name: string;
    template: { id: string; name: string };
  } | null;
  department?: {
    id: string;
    name: string;
  } | null;
}

export interface EmployeeInstance {
  id: string;
  name: string;
  status: string;
  template: {
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

/** 企业硅基岗位列表（用于选择授权对象） */
export function useEmployeeInstances() {
  return useQuery<EmployeeInstance[]>({
    queryKey: ['employee-instances'],
    queryFn: () => api.get<EmployeeInstance[]>('/enterprise/instances'),
  });
}

/** 创建授权 */
export function useCreateGrant(knowledgeBaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { instanceId?: string; departmentId?: string }) =>
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
