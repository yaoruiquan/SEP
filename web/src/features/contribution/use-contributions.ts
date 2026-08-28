'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, uploadForm } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { SkillPackageParseResult } from '../../../../backend/src/shared';
import type { ContributionCapability, ContributionCapabilityDetail, ContributionOverview, ContributionRewardEvent, ContributionUsage } from '@/lib/types';

/** 作者版本详情 = 列表里的版本摘要 + 正文。 */
export type AuthorVersionDetail = ContributionCapabilityDetail['skillVersions'][number] & {
  content: string;
  capability: { id: string; name: string; description: string; visibility: string };
};

export function useContributionOverview() {
  return useQuery({ queryKey: qk.contributionOverview, queryFn: () => api.get<ContributionOverview>('/contributions/overview') });
}

export function useMyContributions() {
  return useQuery({ queryKey: qk.contributionMine, queryFn: () => api.get<ContributionCapability[]>('/contributions/mine') });
}

export function useContribution(id: string) {
  return useQuery({ queryKey: qk.contribution(id), queryFn: () => api.get<ContributionCapabilityDetail>(`/contributions/${id}`), enabled: Boolean(id) });
}

export function useContributionRewards() {
  return useQuery({ queryKey: qk.contributionRewards, queryFn: () => api.get<ContributionRewardEvent[]>('/contributions/rewards') });
}

export function useContributionUsage(id: string) {
  return useQuery({ queryKey: [...qk.contribution(id), 'usage'], queryFn: () => api.get<ContributionUsage>(`/contributions/${id}/usage`), enabled: Boolean(id) });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: qk.contributions });
}

export function useCreateContribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<ContributionCapability>('/contributions', body),
    onSuccess: () => invalidate(qc),
  });
}

/**
 * 上传 SKILL 包并拿回解析结果。
 * 创建能力时只回传 sha256 —— 正文由服务端按哈希重新解包，客户端改不动它。
 */
export function useUploadSkillPackage() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return uploadForm<SkillPackageParseResult>('/contributions/skill-package', form);
    },
  });
}

/** 发布新版本。正文来源与创建能力同规则：上传包只送 sha256，或送在线编写的 content。 */
export function useCreateVersion(capabilityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      changeSummary: string;
      parentVersionId?: string;
      content?: string;
      packageSha256?: string;
      packageFilename?: string;
    }) => api.post(`/contributions/${capabilityId}/versions`, body),
    onSuccess: () => {
      invalidate(qc);
      void qc.invalidateQueries({ queryKey: qk.contribution(capabilityId) });
    },
  });
}

/** 提交版本审核。企业版本先过企业管理员，个人版本直投平台 —— 分流在服务端。 */
export function useSubmitVersion(capabilityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => api.post(`/contributions/versions/${versionId}/submit`),
    onSuccess: () => {
      invalidate(qc);
      void qc.invalidateQueries({ queryKey: qk.contribution(capabilityId) });
    },
  });
}

/** 作者视角的版本正文。企业侧那个 preview 要求订阅授权，贡献场景拿不到。 */
export function useAuthorVersion(versionId: string) {
  return useQuery({
    queryKey: ['skill-versions', 'preview', 'author', versionId] as const,
    queryFn: () => api.get<AuthorVersionDetail>(`/contributions/versions/${versionId}`),
    enabled: Boolean(versionId),
  });
}

/** 编辑草稿正文。上传来的版本服务端会拒 —— 包才是它的正文来源。 */
export function useUpdateVersion(capabilityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { versionId: string; content: string; changeSummary?: string }) =>
      api.patch(`/contributions/versions/${data.versionId}`, {
        content: data.content,
        changeSummary: data.changeSummary,
      }),
    onSuccess: (_data, variables) => {
      invalidate(qc);
      void qc.invalidateQueries({ queryKey: qk.contribution(capabilityId) });
      void qc.invalidateQueries({
        queryKey: ['skill-versions', 'preview', 'author', variables.versionId],
      });
    },
  });
}

export function useContributionAction(action: 'submit-enterprise-review' | 'request-platform-review' | 'authorize-platform-submission') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ContributionCapability>(`/contributions/${id}/${action}`),
    onSuccess: (_data, id) => {
      invalidate(qc);
      void qc.invalidateQueries({ queryKey: qk.contribution(id) });
    },
  });
}

export function useReviewContribution(stage: 'enterprise' | 'platform') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; decision: 'APPROVE' | 'REJECT'; comment?: string }) => api.post<ContributionCapability>(`/contributions/${data.id}/${stage}-review`, { decision: data.decision, comment: data.comment }),
    onSuccess: (_data, variables) => {
      invalidate(qc);
      void qc.invalidateQueries({ queryKey: qk.contribution(variables.id) });
    },
  });
}
