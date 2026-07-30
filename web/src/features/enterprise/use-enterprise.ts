'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type {
  Department,
  EnterpriseMember,
  EmployeeInstance,
  InstanceStatus,
  GrantRecord,
  MyEmployee,
} from '@/lib/types';

// ── 部门 ─────────────────────────────────────────────────────────────────────

export function useDepartments() {
  return useQuery({
    queryKey: qk.departments,
    queryFn: () => api.get<Department[]>('/enterprise/departments'),
  });
}

export function useCreateDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; parentId?: string; sortOrder?: number }) =>
      api.post<Department>('/enterprise/departments', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.departments }),
  });
}

export function useUpdateDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; parentId?: string | null; sortOrder?: number }) =>
      api.patch<Department>(`/enterprise/departments/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.departments }),
  });
}

export function useDeleteDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/enterprise/departments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.departments }),
  });
}

// ── 成员 ─────────────────────────────────────────────────────────────────────

export function useMembers(departmentId?: string) {
  return useQuery({
    queryKey: qk.members(departmentId),
    queryFn: () =>
      api.get<EnterpriseMember[]>(
        departmentId
          ? `/enterprise/members?departmentId=${departmentId}`
          : '/enterprise/members',
      ),
  });
}

export function useCreateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      email: string;
      password: string;
      name?: string;
      role?: 'ENTERPRISE_ADMIN' | 'MEMBER';
      departmentId?: string;
      position?: string;
    }) => api.post<EnterpriseMember>('/enterprise/members', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.members() });
      qc.invalidateQueries({ queryKey: qk.departments });
    },
  });
}

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      role?: 'ENTERPRISE_ADMIN' | 'MEMBER';
      departmentId?: string | null;
      position?: string | null;
    }) => api.patch<EnterpriseMember>(`/enterprise/members/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.members() });
      qc.invalidateQueries({ queryKey: qk.departments });
    },
  });
}

export function useDeleteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/enterprise/members/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.members() });
      qc.invalidateQueries({ queryKey: qk.departments });
    },
  });
}

// ── 实例 ─────────────────────────────────────────────────────────────────────

export function useInstances(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.instances,
    queryFn: () => api.get<EmployeeInstance[]>('/enterprise/instances'),
    enabled: opts?.enabled ?? true,
  });
}

/**
 * 创建实例。前置条件是本企业对该模板有**生效中的订阅** ——
 * 没订阅后端返回 400，这是「订阅=使用权、实例=部署一份」的体现。
 * 同一模板可建多个实例（按部门各部署一份），后端无唯一约束。
 */
export function useCreateInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      templateId: string;
      name: string;
      departmentId?: string;
      config?: Record<string, unknown>;
    }) => api.post<EmployeeInstance>('/enterprise/instances', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.instances });
      qc.invalidateQueries({ queryKey: qk.myEmployees });
    },
  });
}

export function useUpdateInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      departmentId?: string | null;
      config?: Record<string, unknown>;
    }) => api.patch<EmployeeInstance>(`/enterprise/instances/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.instances });
      qc.invalidateQueries({ queryKey: qk.myEmployees });
    },
  });
}

/**
 * 启用 / 停用 / 回收。
 * REVOKED 是终态，转回会被后端拒绝（409）——
 * 前端对已回收实例应禁用操作而非依赖报错提示。
 */
export function useChangeInstanceStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: InstanceStatus }) =>
      api.patch<{ id: string; status: InstanceStatus; changed: boolean }>(
        `/enterprise/instances/${id}/status`,
        { status },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.instances });
      // 停用会让实例从「我的员工」消失，必须一起失效
      qc.invalidateQueries({ queryKey: qk.myEmployees });
    },
  });
}

/** 升级到模板最新版。只改版本号，不迁移 config（决策 14）。 */
export function useUpgradeInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{
        id: string;
        templateVersion: string;
        from: string;
        to: string;
        configReviewRequired: boolean;
      }>(`/enterprise/instances/${id}/upgrade`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.instances });
      qc.invalidateQueries({ queryKey: qk.myEmployees });
    },
  });
}

// ── 授权 ─────────────────────────────────────────────────────────────────────

export function useInstanceGrants(instanceId: string) {
  return useQuery({
    queryKey: qk.instanceGrants(instanceId),
    queryFn: () => api.get<GrantRecord[]>(`/enterprise/instances/${instanceId}/grants`),
    enabled: Boolean(instanceId),
  });
}

export function useCreateGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      instanceId,
      ...body
    }: {
      instanceId: string;
      departmentId?: string;
      memberId?: string;
      expiresAt?: string;
    }) => api.post<GrantRecord>(`/enterprise/instances/${instanceId}/grants`, body),
    onSuccess: (_, { instanceId }) => {
      qc.invalidateQueries({ queryKey: qk.instanceGrants(instanceId) });
      qc.invalidateQueries({ queryKey: qk.myEmployees });
    },
  });
}

export function useDeleteGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ grantId }: { grantId: string; instanceId: string }) =>
      api.delete(`/enterprise/grants/${grantId}`),
    onSuccess: (_, { instanceId }) => {
      qc.invalidateQueries({ queryKey: qk.instanceGrants(instanceId) });
      qc.invalidateQueries({ queryKey: qk.myEmployees });
    },
  });
}

// ── 我的员工 ─────────────────────────────────────────────────────────────────

export function useMyEmployees() {
  return useQuery({
    queryKey: qk.myEmployees,
    queryFn: () => api.get<MyEmployee[]>('/enterprise/my-employees'),
  });
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export interface DashboardStats {
  employeeCount: number;
  memberCount: number;
  monthlySpend: number;
  callCount: number;
  spendTrend: Array<{ date: string; amount: number }>;
  topEmployees: Array<{ id: string; name: string; calls: number }>;
  recentActivities: Array<{
    type: string;
    actor: string;
    target: string;
    time: string;
  }>;
}

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get<DashboardStats>('/enterprise/dashboard-stats'),
  });
}
