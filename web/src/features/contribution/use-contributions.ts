'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, uploadForm } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { SkillPackageParseResult } from '../../../../backend/src/shared';
import type { ContributionCapability, ContributionCapabilityDetail, ContributionOverview, ContributionRewardEvent, ContributionUsage } from '@/lib/types';

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
