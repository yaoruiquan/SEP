'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { SkillVersionScope, SkillVersionStatus } from '@/lib/types';

/**
 * 「能力迭代」的数据层。
 *
 * 与 `use-skill-version.ts` 的分工：那个是「按员工看技能」（我这位员工带哪些技能），
 * 这个是「按技能做迭代」（这个技能改过几版、谁在用、现在用哪版）。
 */

export const capabilityIterationKeys = {
  list: () => ['capability-iteration', 'list'] as const,
  versions: (capabilityId: string) => ['capability-iteration', 'versions', capabilityId] as const,
  usage: (capabilityId: string) => ['capability-iteration', 'usage', capabilityId] as const,
  executions: (capabilityId: string) => ['capability-iteration', 'executions', capabilityId] as const,
};

export interface IterableCapability {
  capability: { id: string; name: string; description: string };
  employees: Array<{ employeeId: string; employeeName: string; subscriptionId: string }>;
  currentVersion: { id: string; version: string; scope: SkillVersionScope } | null;
  usage: { totalRounds: number; distinctUserCount: number };
}

export interface IterableCapabilityList {
  canManage: boolean;
  items: IterableCapability[];
}

export function useIterableCapabilities() {
  return useQuery({
    queryKey: capabilityIterationKeys.list(),
    queryFn: () => api.get<IterableCapabilityList>('/enterprise/capabilities'),
  });
}

export interface VersionReviewRecord {
  id: string;
  actorType: 'ENTERPRISE' | 'PLATFORM';
  decision: 'APPROVE' | 'REJECT';
  comment: string | null;
  createdAt: string;
  reviewer: { id: string; name: string | null };
}

export interface TimelineVersion {
  id: string;
  capabilityId: string;
  scope: SkillVersionScope;
  enterpriseId: string | null;
  parentVersionId: string | null;
  sourceVersionId: string | null;
  version: string;
  changeSummary: string | null;
  status: SkillVersionStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string | null };
  enterpriseReviewedBy: { id: string; name: string | null } | null;
  enterpriseReviewedAt: string | null;
  rejectionReason: string | null;
  reviews: VersionReviewRecord[];
  hasPlatformSubmission: boolean;
  /** 是否为企业当前选定的生效版本 */
  isCurrent: boolean;
}

export interface VersionTimeline {
  capability: { id: string; name: string; description: string };
  subscriptionId: string;
  canManage: boolean;
  currentVersionId: string | null;
  selectedAt: string | null;
  versions: TimelineVersion[];
}

export function useVersionTimeline(capabilityId: string) {
  return useQuery({
    queryKey: capabilityIterationKeys.versions(capabilityId),
    queryFn: () => api.get<VersionTimeline>(`/enterprise/capabilities/${capabilityId}/versions`),
    enabled: Boolean(capabilityId),
  });
}

export interface UsageSummary {
  summary: {
    /** 会议要的「本企业使用人数」 */
    distinctUserCount: number;
    totalConversations: number;
    totalRounds: number;
  };
  byEmployee: Array<{ employeeId: string; employeeName: string; rounds: number }>;
  /** 仅企业管理员可见 */
  byMember?: Array<{ userId: string; userName: string | null; rounds: number }>;
}

export function useCapabilityUsage(capabilityId: string, enabled = true) {
  return useQuery({
    queryKey: capabilityIterationKeys.usage(capabilityId),
    queryFn: () => api.get<UsageSummary>(`/enterprise/capabilities/${capabilityId}/usage`),
    enabled: Boolean(capabilityId) && enabled,
  });
}

export interface ExecutionDetail {
  id: string;
  sessionId: string;
  input: unknown;
  output: unknown;
  status: 'SUCCESS' | 'FAILED';
  errorMessage: string | null;
  duration: number | null;
  skillVersionId: string | null;
  /** 用于显示「平台版」或「企业版」标签 */
  versionScope: SkillVersionScope | null;
  userId: string | null;
  userName: string | null;
  createdAt: string;
}

export interface ExecutionList {
  items: ExecutionDetail[];
  nextCursor: string | null;
}

/**
 * 执行明细。仅企业管理员有权限 —— 涉及成员的输入内容。
 * `enabled` 由调用方按 canManage 控制，避免普通成员触发一次必然 403 的请求。
 */
export function useCapabilityExecutions(capabilityId: string, enabled = true) {
  return useQuery({
    queryKey: capabilityIterationKeys.executions(capabilityId),
    queryFn: () =>
      api.get<ExecutionList>(`/enterprise/capabilities/${capabilityId}/executions?limit=30`),
    enabled: Boolean(capabilityId) && enabled,
  });
}

/**
 * 切换生效版本 —— 「回滚」在实现上就是选回旧版本。
 *
 * 成功后连带失效版本时间线与能力列表：列表上的 currentVersion 也变了。
 */
export function useSelectEffectiveVersion(capabilityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ subscriptionId, versionId }: { subscriptionId: string; versionId: string }) =>
      api.post(
        `/enterprise/subscriptions/${subscriptionId}/skills/${capabilityId}/select-version`,
        { versionId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: capabilityIterationKeys.versions(capabilityId) });
      void qc.invalidateQueries({ queryKey: capabilityIterationKeys.list() });
    },
  });
}
