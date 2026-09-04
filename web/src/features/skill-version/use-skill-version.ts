'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { AdminVersionRow } from './group-admin-versions';
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

/**
 * 发布企业版草稿并立即生效。
 *
 * 取代了原先的「提交审核 → 通过/驳回」两步 —— 会议纪要2 §6.4 否掉了企业内提审流，
 * 管理员自建草稿再自审是纯仪式（批准人和提交人是同一个人）。后端那两个端点已删除。
 */
export function usePublishEnterpriseSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ affectedSubscriptions: number }>(
        `/enterprise/skill-versions/${id}/publish`,
        {},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['skill-versions'] });
      void qc.invalidateQueries({ queryKey: ['capability-iteration'] });
    },
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

/**
 * 把企业版本投稿到平台市场。只有 ENTERPRISE_APPROVED 的版本能投，一份只能投一次
 * （后端靠 sourceVersionId 的唯一约束兜底）。
 *
 * 除了 skill-versions，还要失效 capability-iteration —— 技能库的版本时间线读的是
 * 后者，不一起失效的话按钮点完不会变成「已投稿」。
 */
export function useSubmitPlatformSkillReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post(`/enterprise/skill-versions/${id}/submit-platform-review`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skill-versions'] });
      qc.invalidateQueries({ queryKey: ['capability-iteration'] });
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
