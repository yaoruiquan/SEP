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
  preview: (versionId: string, source: PreviewSource) =>
    ['skill-versions', 'preview', source, versionId] as const,
  enterprise: () => ['skill-versions', 'enterprise'] as const,
  admin: () => ['skill-versions', 'admin'] as const,
};

/**
 * 正文从哪条授权路径取。
 *   - `author`：贡献中心，按 capability.contributorId 授权。
 *   - `enterprise`：企业成员看已订阅员工绑定的技能，要求订阅授权。
 *   - `admin`：平台运营审核。
 *
 * 三者不能混用：贡献中心用 `enterprise` 会必然 403 —— 刚贡献的能力没有任何
 * 员工绑定，`assertCapabilityGrant` 找不到授权订阅。
 */
export type PreviewSource = 'author' | 'enterprise' | 'admin';

const PREVIEW_PATH: Record<PreviewSource, (versionId: string) => string> = {
  author: (id) => `/contributions/versions/${id}`,
  enterprise: (id) => `/enterprise/skill-versions/${id}/preview`,
  admin: (id) => `/admin/skill-versions/${id}`,
};

/** 导出供测试断言路由表，避免三条路径被悄悄改混。 */
export const previewPathFor = (source: PreviewSource, versionId: string) =>
  PREVIEW_PATH[source](versionId);

export function useSkillVersionPreview(versionId: string, source: PreviewSource = 'enterprise') {
  return useQuery({
    queryKey: skillVersionKeys.preview(versionId, source),
    queryFn: () => api.get<SkillVersionPreview>(PREVIEW_PATH[source](versionId)),
    enabled: Boolean(versionId),
  });
}

export function useEmployeeSkillVersions(employeeId: string) {
  return useQuery({
    queryKey: skillVersionKeys.employee(employeeId),
    queryFn: () =>
      api.get<EmployeeSkillVersionsResponse>(`/enterprise/employees/${employeeId}/skills`),
    enabled: Boolean(employeeId),
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
