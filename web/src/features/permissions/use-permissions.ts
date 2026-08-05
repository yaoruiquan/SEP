import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { GrantRecord } from '@/lib/types';

export type { GrantRecord };

export interface AccessRequest {
  id: string;
  enterpriseId: string;
  requesterId: string;
  instanceId: string;
  reason: string | null;
  requestedDays: number | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewerId: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  requester: {
    id: string;
    user: {
      id: string;
      name: string;
      email: string;
      avatar: string | null;
    };
    department: {
      id: string;
      name: string;
    } | null;
  };
  instance: {
    id: string;
    employee: {
      id: string;
      name: string;
    };
  };
  reviewer?: {
    id: string;
    name: string;
    email: string;
  } | null;
}

/**
 * 获取单个实例的授权列表
 */
export function useEmployeeGrants(instanceId: string) {
  return useQuery<GrantRecord[]>({
    queryKey: ['grants', instanceId],
    queryFn: () => api.get<GrantRecord[]>(`/enterprise/instances/${instanceId}/grants`),
    enabled: !!instanceId,
    staleTime: 30_000,
  });
}

/**
 * 并行获取多个实例的授权列表（用于部门视图）
 */
export function useAllInstanceGrants(instanceIds: string[]) {
  return useQueries({
    queries: instanceIds.map((id) => ({
      queryKey: ['grants', id],
      queryFn: () => api.get<GrantRecord[]>(`/enterprise/instances/${id}/grants`),
      enabled: instanceIds.length > 0,
      staleTime: 30_000,
    })),
  });
}

/**
 * 创建授权（支持过期时间）
 */
export function useCreateGrant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      instanceId: string;
      departmentId?: string | null;
      memberId?: string | null;
      expiresAt?: string | null;
    }) =>
      api.post<GrantRecord>(`/enterprise/instances/${data.instanceId}/grants`, {
        departmentId: data.departmentId ?? null,
        memberId: data.memberId ?? null,
        expiresAt: data.expiresAt ?? null,
      }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['grants', vars.instanceId] });
    },
  });
}

/**
 * 删除授权
 */
export function useDeleteGrant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { grantId: string; instanceId: string }) =>
      api.delete(`/enterprise/grants/${params.grantId}`),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['grants', vars.instanceId] });
    },
  });
}

/**
 * 提交访问申请
 */
export function useCreateAccessRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { instanceId: string; reason?: string; requestedDays?: number }) =>
      api.post<AccessRequest>('/enterprise/access-requests', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-requests'] });
    },
  });
}

/**
 * 获取待审批列表（管理员）
 */
export function usePendingAccessRequests() {
  return useQuery<AccessRequest[]>({
    queryKey: ['access-requests', 'pending'],
    queryFn: () => api.get<AccessRequest[]>('/enterprise/access-requests/pending'),
    staleTime: 30_000,
  });
}

/**
 * 获取我的申请历史
 */
export function useMyAccessRequests() {
  return useQuery<AccessRequest[]>({
    queryKey: ['access-requests', 'my'],
    queryFn: () => api.get<AccessRequest[]>('/enterprise/access-requests/my'),
    staleTime: 30_000,
  });
}

/**
 * 批准申请
 */
export function useApproveAccessRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { requestId: string; reviewNote?: string }) =>
      api.post(`/enterprise/access-requests/${params.requestId}/approve`, {
        reviewNote: params.reviewNote,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-requests'] });
    },
  });
}

/**
 * 拒绝申请
 */
export function useRejectAccessRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { requestId: string; reviewNote?: string }) =>
      api.post(`/enterprise/access-requests/${params.requestId}/reject`, {
        reviewNote: params.reviewNote,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-requests'] });
    },
  });
}
