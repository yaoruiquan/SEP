'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { EnterpriseSkillReviewStatus, SkillVersionScope, SkillVersionStatus } from '@/lib/types';
import { useAuthStore } from '@/lib/auth-store';

/**
 * 「技能库」的数据层。
 *
 * 与 `use-skill-version.ts` 的分工：那个是「按员工看技能」（我这位员工带哪些技能），
 * 这个是「按技能做迭代」（这个技能改过几版、谁在用、现在用哪版）。
 */

export const capabilityIterationKeys = {
  list: () => ['capability-iteration', 'list'] as const,
  versions: (capabilityId: string) => ['capability-iteration', 'versions', capabilityId] as const,
  usage: (capabilityId: string) => ['capability-iteration', 'usage', capabilityId] as const,
  executions: (capabilityId: string) => ['capability-iteration', 'executions', capabilityId] as const,
  personalDiffs: (capabilityId: string) =>
    ['capability-iteration', 'personal-diffs', capabilityId] as const,
  submissions: (capabilityId: string) => ['capability-iteration', 'submissions', capabilityId] as const,
  insights: (capabilityId: string) => ['capability-iteration', 'insights', capabilityId] as const,
};

const liveSkillQueryOptions = {
  staleTime: 0,
  refetchOnMount: true,
  refetchOnWindowFocus: true,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
} as const;

export interface IterableCapability {
  capability: { id: string; name: string; description: string };
  employees: Array<{
    employeeId: string;
    employeeName: string;
    /** 分组头的头像。DiceBear 生成，运营未设置时为 null，前端回落到名字首字 */
    employeeAvatar: string | null;
    employeePosition: string;
    employeeIndustry: string;
    /** 职能分类（EmployeeCategory）。分组头副标题优先用它 —— 见下方注释 */
    employeeCategory: string;
    subscriptionId: string;
  }>;
  currentVersion: { id: string; version: string; scope: SkillVersionScope } | null;
  usage: { totalRounds: number; distinctUserCount: number };
  /** 待审核改动数；保留旧字段名以兼容接口。 */
  pendingAdoptionCount: number;
  /** 历史个人工作副本 ID，仅供来源追溯。 */
  myPersonalVersionId: string | null;
  myPersonalVersionActive: boolean;
}

export interface IterableCapabilityList {
  canManage: boolean;
  /** 顶部汇总条的四个数由接口给出，前端不再重算 */
  summary: {
    capabilityCount: number;
    customizedCount: number;
    pendingAdoptionTotal: number;
    totalRounds: number;
  };
  items: IterableCapability[];
}

export function useIterableCapabilities() {
  const identity = useSkillIdentity();
  return useQuery({
    queryKey: [...capabilityIterationKeys.list(), identity],
    queryFn: () => api.get<IterableCapabilityList>('/enterprise/capabilities'),
    ...liveSkillQueryOptions,
  });
}

export interface VersionReviewRecord {
  id: string;
  actorType: 'ENTERPRISE' | 'PLATFORM';
  decision: 'APPROVE' | 'REJECT';
  comment: string | null;
  createdAt: string;
  reviewer: { id: string; name: string | null };
  versionId?: string;
  version?: string;
  publishedVersion?: PublishedSkillVersion | null;
}

export interface TimelineVersion {
  id: string;
  capabilityId: string;
  ownerId?: string | null;
  /** 后端依据真实工作副本关系返回，不能按状态推断来源。 */
  isWorkingCopy?: boolean;
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
  platformReviewedAt?: string | null;
  rejectionReason: string | null;
  reviews: VersionReviewRecord[];
  hasPlatformSubmission: boolean;
  /** 是否为企业当前选定的生效版本 */
  isCurrent: boolean;
  sourceSubmissionId?: string | null;
}

export interface VersionTimeline {
  capability: { id: string; name: string; description: string };
  subscriptionId: string;
  /**
   * 这个能力绑在哪几位员工身上，以及各自的选版。
   *
   * 正式执行统一跟随企业当前启用版本，个人选版字段仅保留历史兼容。
   */
  subscriptions: Array<{
    subscriptionId: string;
    employeeId: string;
    employeeName: string;
    /** 企业当前启用版本。 */
    currentVersionId: string | null;
    personalVersionId: string | null;
    personalSelectionMode: 'FOLLOW_ENTERPRISE' | 'AUTO' | 'PINNED';
    effectiveVersionId: string | null;
    effectiveVersionScope: SkillVersionScope | null;
    enterpriseVersionId: string | null;
    canSelectPersonal: boolean;
    selectedAt: string | null;
  }>;
  canManage: boolean;
  currentVersionId: string | null;
  selectedAt: string | null;
  versions: TimelineVersion[];
  myPersonalVersionId: string | null;
  effectiveVersionState?: 'EXPLICIT' | 'AUTOMATIC' | 'MIXED' | 'NONE';
  effectiveVersion?: PublishedSkillVersion | null;
  pendingTotal?: number;
}

export function useVersionTimeline(capabilityId: string) {
  const identity = useSkillIdentity();
  return useQuery({
    queryKey: [...capabilityIterationKeys.versions(capabilityId), identity],
    queryFn: () => api.get<VersionTimeline>(`/enterprise/capabilities/${capabilityId}/versions`),
    enabled: Boolean(capabilityId),
    ...liveSkillQueryOptions,
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
 * 管理员切换企业共享默认版本；不是个人选版。
 *
 * 成功后连带失效版本时间线与能力列表：列表上的 currentVersion 也变了。
 */
export function useSelectEffectiveVersion(capabilityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ versionId }: { versionId: string }) =>
      api.post(
        `/enterprise/capabilities/${capabilityId}/default-version`,
        { versionId },
      ),
    onSuccess: () => invalidateSkillViews(qc, capabilityId),
  });
}

export interface PersonalDiffItem {
  id: string;
  owner: { id: string; name: string | null; email: string } | null;
  basedOn: { id: string; scope: SkillVersionScope; version: string } | null;
  changeSummary: string | null;
  content: string;
  updatedAt: string;
  adopted: boolean;
  adoptedAt: string | null;
  /** 当前内容是否可审核。 */
  pending: boolean;
  status: SkillVersionStatus;
  reviewStatus: EnterpriseSkillReviewStatus;
  submittedAt: string | null;
  enterpriseReviewedAt: string | null;
  reviewedBy: { id: string; name: string | null } | null;
  rejectionReason: string | null;
  publishedVersionId: string | null;
  publishedVersion?: PublishedSkillVersion | null;
  isWorkingCopy: boolean;
  canEdit: boolean;
  isLegacyUnpublished: boolean;
}

export interface PersonalDiffList {
  canManage: boolean;
  /** 对比基线：企业当前生效版本，没有企业版时是最新平台版 */
  baseline: { id: string; scope: SkillVersionScope; version: string; content: string } | null;
  items: PersonalDiffItem[];
  total: number;
  page: number;
  limit: number;
  myWorkingCopy: PersonalDiffItem | null;
  pendingTotal?: number;
}

export interface PublishedSkillVersion {
  id: string;
  scope: SkillVersionScope;
  version: string;
  isCurrent?: boolean;
}

export interface SkillSubmissionDetail {
  canManage: boolean;
  item: PersonalDiffItem & { version: string };
  source: (PublishedSkillVersion & { content: string }) | null;
  sourceState: 'AVAILABLE' | 'UNREADABLE' | 'NONE';
  currentBaseline: (PublishedSkillVersion & { content: string }) | null;
  currentBaselineState: 'EXPLICIT' | 'AUTOMATIC' | 'MIXED' | 'NONE';
  reviews: VersionReviewRecord[];
}

export function useSkillSubmissionDetail(capabilityId: string, submissionId: string | null) {
  const identity = useSkillIdentity();
  return useQuery({
    queryKey: [...capabilityIterationKeys.submissions(capabilityId), identity, submissionId],
    queryFn: () => api.get<SkillSubmissionDetail>(`/enterprise/capabilities/${capabilityId}/submissions/${submissionId}`),
    enabled: Boolean(capabilityId && submissionId),
    retry: false,
    ...liveSkillQueryOptions,
  });
}

export function usePersonalDiffs(capabilityId: string, enabled = true, page = 1, status?: EnterpriseSkillReviewStatus) {
  const identity = useSkillIdentity();
  const params = new URLSearchParams({ page: String(page), limit: '20' });
  if (status) params.set('status', status);
  return useQuery({
    queryKey: [...capabilityIterationKeys.personalDiffs(capabilityId), { page, limit: 20, status }, identity],
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey.at(-1) === identity ? keepPreviousData(previous) : undefined,
    queryFn: () =>
      api.get<PersonalDiffList>(`/enterprise/capabilities/${capabilityId}/personal-diffs?${params.toString()}`),
    enabled: Boolean(capabilityId) && enabled,
    ...liveSkillQueryOptions,
  });
}

export function useSkillIdentity() {
  return useAuthStore((state) => [state.enterprise?.id, state.user?.id, state.roleInEnterprise].join(':'));
}

/**
 * 启用版本后同步刷新个人改动、时间线、能力列表与技能查询（含预览）。
 * 抽成一个函数，避免每个 mutation 各写一遍漏掉一处。
 */
function invalidateSkillViews(qc: ReturnType<typeof useQueryClient>, capabilityId: string) {
  void qc.invalidateQueries({ queryKey: capabilityIterationKeys.versions(capabilityId) });
  void qc.invalidateQueries({ queryKey: ['skill-versions'] });
  void qc.invalidateQueries({ queryKey: capabilityIterationKeys.personalDiffs(capabilityId) });
  void qc.invalidateQueries({ queryKey: capabilityIterationKeys.submissions(capabilityId) });
  void qc.invalidateQueries({ queryKey: capabilityIterationKeys.list() });
}

// ──────────── 智能沉淀建议（会议纪要2 §6.5）────────────

export interface InsightFinding {
  phenomenon: string;
  suggestion: string;
  affectedSnippet?: string;
  confidence: number;
}

export interface CapabilityInsight {
  id: string;
  scope: 'MEMBER' | 'ALL';
  memberId: string | null;
  findings: InsightFinding[];
  sampleSize: number;
  personalCount: number;
  modelId: string;
  status: 'PENDING' | 'ADOPTED' | 'DISMISSED';
  adoptedVersionId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  createdBy: { id: string; name: string | null };
  adoptedBy: { id: string; name: string | null } | null;
}

export function useCapabilityInsights(capabilityId: string, enabled = true) {
  return useQuery({
    queryKey: capabilityIterationKeys.insights(capabilityId),
    queryFn: () =>
      api.get<CapabilityInsight[]>(`/enterprise/capabilities/${capabilityId}/insights`),
    enabled: Boolean(capabilityId) && enabled,
  });
}

export function useGenerateInsight(capabilityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { scope: 'MEMBER' | 'ALL'; memberId?: string }) =>
      api.post<CapabilityInsight>(
        `/enterprise/capabilities/${capabilityId}/insights/generate`,
        payload,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: capabilityIterationKeys.insights(capabilityId) });
    },
  });
}

export function useResolveInsight(capabilityId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: capabilityIterationKeys.insights(capabilityId) });
    void qc.invalidateQueries({ queryKey: capabilityIterationKeys.versions(capabilityId) });
    void qc.invalidateQueries({ queryKey: capabilityIterationKeys.list() });
  };
  const dismiss = useMutation({
    mutationFn: (insightId: string) => api.post(`/enterprise/insights/${insightId}/dismiss`, {}),
    onSuccess: invalidate,
  });
  return { dismiss };
}
