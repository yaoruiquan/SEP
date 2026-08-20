'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type {
  EmployeeSkillVersionsResponse,
  SkillVersionPreview,
  SkillVersionScope,
  SkillVersionStatus,
  SkillVersionSummary,
} from '@/lib/types';

export const skillVersionKeys = {
  employee: (employeeId: string) => ['skill-versions', 'employee', employeeId] as const,
  preview: (versionId: string) => ['skill-versions', 'preview', versionId] as const,
  enterprise: () => ['skill-versions', 'enterprise'] as const,
  admin: () => ['skill-versions', 'admin'] as const,
};

export function useEmployeeSkillVersions(employeeId: string) {
  return useQuery({
    queryKey: skillVersionKeys.employee(employeeId),
    queryFn: () =>
      api.get<EmployeeSkillVersionsResponse>(`/enterprise/employees/${employeeId}/skills`),
    enabled: Boolean(employeeId),
  });
}

export function useSkillVersionPreview(versionId: string, admin = false) {
  return useQuery({
    queryKey: skillVersionKeys.preview(versionId),
    queryFn: () =>
      api.get<SkillVersionPreview>(
        admin
          ? `/admin/skill-versions/${versionId}`
          : `/enterprise/skill-versions/${versionId}/preview`,
      ),
    enabled: Boolean(versionId),
  });
}

export function useEnterpriseSkillVersions() {
  return useQuery({
    queryKey: skillVersionKeys.enterprise(),
    queryFn: () => api.get<Array<SkillVersionSummary & { capability: { id: string; name: string; description: string } }>>('/enterprise/skill-versions'),
  });
}

export function useCreateEnterpriseSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      subscriptionId: string;
      capabilityId: string;
      parentVersionId: string;
      changeSummary?: string;
    }) =>
      api.post<SkillVersionPreview>(
        `/enterprise/subscriptions/${data.subscriptionId}/skill-versions`,
        {
          capabilityId: data.capabilityId,
          parentVersionId: data.parentVersionId,
          changeSummary: data.changeSummary,
        },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skill-versions'] }),
  });
}

export function useUpdateEnterpriseSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; content: string; changeSummary?: string }) =>
      api.patch<SkillVersionPreview>(`/enterprise/skill-versions/${data.id}`, {
        content: data.content,
        changeSummary: data.changeSummary,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skill-versions'] }),
  });
}

export function useSubmitEnterpriseSkillReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/enterprise/skill-versions/${id}/submit-review`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skill-versions'] }),
  });
}

export function useReviewEnterpriseSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; decision: 'APPROVE' | 'REJECT'; comment?: string }) =>
      api.post(`/enterprise/skill-versions/${data.id}/review`, {
        decision: data.decision,
        comment: data.comment,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skill-versions'] }),
  });
}

export function useSelectSkillVersion(employeeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      subscriptionId: string;
      capabilityId: string;
      versionId: string;
    }) =>
      api.post(
        `/enterprise/subscriptions/${data.subscriptionId}/skills/${data.capabilityId}/select-version`,
        { versionId: data.versionId },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: skillVersionKeys.employee(employeeId) }),
  });
}

export function useSubmitPlatformSkillReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post(`/enterprise/skill-versions/${id}/submit-platform-review`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skill-versions'] }),
  });
}

interface AdminSkillVersionListResponse {
  total: number;
  page: number;
  limit: number;
  items: Array<
    SkillVersionSummary & {
      capability: { id: string; name: string; description: string };
      enterprise: { id: string; name: string } | null;
    }
  >;
}

export function useAdminSkillVersions(filters?: {
  status?: SkillVersionStatus;
  scope?: SkillVersionScope;
}) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.scope) params.set('scope', filters.scope);
  return useQuery({
    queryKey: [...skillVersionKeys.admin(), filters],
    queryFn: () =>
      api.get<AdminSkillVersionListResponse>(`/admin/skill-versions?${params.toString()}`),
  });
}

export function useReviewPlatformSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; decision: 'APPROVE' | 'REJECT'; comment?: string }) =>
      api.post(`/admin/skill-versions/${data.id}/review`, {
        decision: data.decision,
        comment: data.comment,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: skillVersionKeys.admin() }),
  });
}
