'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { DeptMembersResponse } from '@/lib/types';

// ── 部门成员列表 ──────────────────────────────────────────────────────────────

export interface DeptMembersParams {
  search?: string;
  page?: number;
  limit?: number;
}

export function useDeptMembers(deptId: string, params?: DeptMembersParams) {
  const searchParams = new URLSearchParams();
  if (params?.search) searchParams.set('search', params.search);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const qs = searchParams.toString();

  return useQuery({
    queryKey: qk.deptMembers(deptId, params as Record<string, unknown>),
    queryFn: () =>
      api.get<DeptMembersResponse>(
        `/enterprise/departments/${deptId}/members${qs ? `?${qs}` : ''}`,
      ),
    enabled: Boolean(deptId),
  });
}

// ── 批量分配成员到部门 ────────────────────────────────────────────────────────

export function useAssignDeptMembers(deptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberIds: string[]) =>
      api.post<{ assigned: number }>(
        `/enterprise/departments/${deptId}/members`,
        { memberIds },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.deptMembers(deptId) });
      qc.invalidateQueries({ queryKey: qk.departments });
      qc.invalidateQueries({ queryKey: qk.members() });
    },
  });
}

// ── 从部门移除成员 ────────────────────────────────────────────────────────────

export function useRemoveDeptMember(deptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) =>
      api.delete<{ removed: boolean; memberId: string }>(
        `/enterprise/departments/${deptId}/members/${memberId}`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.deptMembers(deptId) });
      qc.invalidateQueries({ queryKey: qk.departments });
      qc.invalidateQueries({ queryKey: qk.members() });
    },
  });
}

// ── 设置/清除部门主管 ─────────────────────────────────────────────────────────

export function useSetDeptLeader(deptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string | null) =>
      api.put<{ id: string; name: string; leaderId: string | null }>(
        `/enterprise/departments/${deptId}/leader`,
        { memberId },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.deptMembers(deptId) });
      qc.invalidateQueries({ queryKey: qk.departments });
    },
  });
}
