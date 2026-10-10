'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { ReviewSkillVersionDtoSchema, type ReviewSkillVersionDto } from '../../../../backend/src/shared/skill-version.dto';
import type { AdminVersionRow } from './group-admin-versions';
import type {
  EmployeeSkillVersionsResponse,
  EnterpriseSkillReviewStatus,
  EnterpriseSkillVersionReviewItem,
  EnterpriseSkillVersionReviewResult,
  EnterpriseSkillVersionReviewResponse,
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
  reviews: (enterpriseId: string | null) => ['skill-versions', 'enterprise-reviews', enterpriseId] as const,
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
  const identity = useAuthStore((state) => [state.enterprise?.id, state.user?.id, state.roleInEnterprise].join(':'));
  return useQuery({
    queryKey: [...skillVersionKeys.preview(versionId, source), identity],
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

export type EnterpriseReviewItem = EnterpriseSkillVersionReviewItem & { isWorkingCopy?: boolean };

export function useEnterpriseSkillVersionReviews(filters: {
  enterpriseId: string | null;
  status: EnterpriseSkillReviewStatus;
  capabilityId?: string;
  page?: number;
  limit?: number;
}, enabled = true) {
  const { enterpriseId, status, capabilityId, page = 1, limit = 20 } = filters;
  const params = new URLSearchParams({ status, page: String(page), limit: String(limit) });
  if (capabilityId) params.set('capabilityId', capabilityId);
  return useQuery({
    queryKey: [...skillVersionKeys.reviews(enterpriseId), { status, capabilityId, page, limit }],
    queryFn: () => api.get<Omit<EnterpriseSkillVersionReviewResponse, 'items'> & { items: EnterpriseReviewItem[] }>(
      `/enterprise/skill-version-reviews?${params.toString()}`,
    ),
    enabled: enabled && Boolean(enterpriseId),
    // 审核队列不能继承全局5分钟缓存/禁用焦点刷新，否则跨端提交会延迟可见。
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

export function useReviewEnterprisePersonalSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ReviewSkillVersionDto & { id: string }) =>
      api.post<EnterpriseSkillVersionReviewResult>(
        `/enterprise/skill-versions/${data.id}/review`,
        ReviewSkillVersionDtoSchema.parse({
          decision: data.decision,
          comment: data.comment,
          ...(data.expectedUpdatedAt !== undefined ? { expectedUpdatedAt: data.expectedUpdatedAt } : {}),
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['skill-versions'] }),
        qc.invalidateQueries({ queryKey: ['capability-iteration'] }),
      ]);
    },
  });
}

interface AdminSkillVersionListResponse {
  total: number;
  page: number;
  limit: number;
  items: AdminVersionRow[];
}

export function useAdminSkillVersions(filters?: {
  status?: SkillVersionStatus;
  scope?: SkillVersionScope;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.scope) params.set('scope', filters.scope);
  // 列表按「企业 → 技能」折叠展示，一页 20 条会把一个企业的版本截断在中间 ——
  // 看起来像完整的一组，其实少了几版。拉到后端上限，超出时界面上明说。
  params.set('limit', String(filters?.limit ?? 100));
  return useQuery({
    queryKey: [...skillVersionKeys.admin(), filters],
    queryFn: () =>
      api.get<AdminSkillVersionListResponse>(`/admin/skill-versions?${params.toString()}`),
  });
}

/**
 * 运营主动采纳一个企业版本 —— 不等企业投稿。
 *
 * 会议纪要2 §6 的阶梯顶端是「采纳与否由平台自己决定（数据本身都在平台）」，
 * 这个 mutation 就是那条入口。`DRAFT` 收成待审草稿再走一遍通过/驳回，
 * `PUBLISH` 直接落成平台版并成为员工模板的默认版。
 */
export function useAdoptEnterpriseSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; mode: 'DRAFT' | 'PUBLISH'; changeSummary?: string }) =>
      api.post<SkillVersionPreview>(`/admin/skill-versions/${data.id}/adopt`, {
        mode: data.mode,
        changeSummary: data.changeSummary,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['skill-versions'] });
      void qc.invalidateQueries({ queryKey: ['capability-iteration'] });
    },
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
