import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface EmployeeGrant {
  id: string;
  instanceId: string;
  departmentId: string | null;
  memberId: string | null;
  expiresAt: string | null;
  createdAt: string;
  instance?: {
    id: string;
    employee: {
      id: string;
      name: string;
    };
  };
  member?: {
    id: string;
    user: {
      id: string;
      name: string;
      email: string;
    };
    department: {
      id: string;
      name: string;
    } | null;
  } | null;
}

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
 * 获取员工授权列表（某个实例的授权情况）
 */
export function useEmployeeGrants(instanceId: string) {
  return useQuery<EmployeeGrant[]>({
    queryKey: ['grants', instanceId],
    queryFn: async () => {
      return await api.get<EmployeeGrant[]>(`/enterprise/instances/${instanceId}/grants`);
    },
    enabled: !!instanceId,
    staleTime: 30_000,
  });
}

/**
 * 创建授权
 */
export function useCreateGrant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      instanceId: string;
      departmentId?: string | null;
      memberId?: string | null;
    }) => {
      return await api.post(`/enterprise/instances/${data.instanceId}/grants`, {
        departmentId: data.departmentId,
        memberId: data.memberId,
      });
    },
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
    mutationFn: async (params: { grantId: string; instanceId: string }) => {
      await api.delete(`/enterprise/grants/${params.grantId}`);
    },
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
    mutationFn: async (data: {
      instanceId: string;
      reason?: string;
      requestedDays?: number;
    }) => {
      return await api.post<AccessRequest>('/enterprise/access-requests', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-requests'] });
    },
  });
}

/**
 * 获取待审批列表（管理员/部门负责人）
 */
export function usePendingAccessRequests() {
  return useQuery<AccessRequest[]>({
    queryKey: ['access-requests', 'pending'],
    queryFn: async () => {
      return await api.get<AccessRequest[]>('/enterprise/access-requests/pending');
    },
    staleTime: 30_000,
  });
}

/**
 * 获取我的申请历史
 */
export function useMyAccessRequests() {
  return useQuery<AccessRequest[]>({
    queryKey: ['access-requests', 'my'],
    queryFn: async () => {
      return await api.get<AccessRequest[]>('/enterprise/access-requests/my');
    },
    staleTime: 30_000,
  });
}

/**
 * 批准访问申请
 */
export function useApproveAccessRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { requestId: string; reviewNote?: string }) => {
      return await api.post(`/enterprise/access-requests/${params.requestId}/approve`, {
        reviewNote: params.reviewNote,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-requests'] });
    },
  });
}

/**
 * 拒绝访问申请
 */
export function useRejectAccessRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { requestId: string; reviewNote?: string }) => {
      return await api.post(`/enterprise/access-requests/${params.requestId}/reject`, {
        reviewNote: params.reviewNote,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-requests'] });
    },
  });
}
