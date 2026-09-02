'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { SkillVersionScope, SkillVersionStatus } from '@/lib/types';

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
  insights: (capabilityId: string) => ['capability-iteration', 'insights', capabilityId] as const,
};

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
  /** 管理员：待采纳的成员改动数。成员：自己那条待采纳时为 1 */
  pendingAdoptionCount: number;
  /** 我自己的副本 id。有值时显示「我的副本已生效」 */
  myPersonalVersionId: string | null;
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
  /**
   * 这个能力绑在哪几位员工身上，以及各自的选版。
   *
   * 一个技能可能被多位员工带着 —— 切版是按订阅（雇佣关系）生效的，
   * 所以管理员要先选「给哪位员工切」。后端 `listVersionTimeline` 恒返回此字段。
   */
  subscriptions: Array<{
    subscriptionId: string;
    employeeId: string;
    employeeName: string;
    currentVersionId: string | null;
    selectedAt: string | null;
  }>;
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

/**
 * 发布企业版草稿并生效。
 *
 * 取代了原先的「提交审核 → 通过/驳回」两个按钮 —— 会议否掉提审流后，
 * 管理员自建草稿再自审是纯仪式，批准人和提交人是同一个人。
 */
export function usePublishEnterpriseVersion(capabilityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) =>
      api.post<{ affectedSubscriptions: number }>(
        `/enterprise/skill-versions/${versionId}/publish`,
        {},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: capabilityIterationKeys.versions(capabilityId) });
      void qc.invalidateQueries({ queryKey: capabilityIterationKeys.list() });
    },
  });
}

// ──────────── 个人副本与采纳（会议纪要2 §6.4）────────────

export interface PersonalDiffItem {
  id: string;
  owner: { id: string; name: string | null; email: string } | null;
  basedOn: { id: string; scope: SkillVersionScope; version: string } | null;
  changeSummary: string | null;
  content: string;
  updatedAt: string;
  adopted: boolean;
  adoptedAt: string | null;
  /** 从未采纳，或采纳后又改过 —— 两种都要管理员再看一眼 */
  pending: boolean;
}

export interface PersonalDiffList {
  canManage: boolean;
  /** 对比基线：企业当前生效版本，没有企业版时是最新平台版 */
  baseline: { id: string; scope: SkillVersionScope; version: string; content: string } | null;
  items: PersonalDiffItem[];
}

export function usePersonalDiffs(capabilityId: string, enabled = true) {
  return useQuery({
    queryKey: capabilityIterationKeys.personalDiffs(capabilityId),
    queryFn: () =>
      api.get<PersonalDiffList>(`/enterprise/capabilities/${capabilityId}/personal-diffs`),
    enabled: Boolean(capabilityId) && enabled,
  });
}

/**
 * 个人副本相关的写操作，失效范围一致：改动列表 + 能力列表（待采纳数变了）。
 * 抽成一个函数，避免每个 mutation 各写一遍漏掉一处。
 */
function invalidatePersonal(qc: ReturnType<typeof useQueryClient>, capabilityId: string) {
  void qc.invalidateQueries({ queryKey: capabilityIterationKeys.personalDiffs(capabilityId) });
  void qc.invalidateQueries({ queryKey: capabilityIterationKeys.list() });
}

export function useCreatePersonalVersion(capabilityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ id: string; content: string }>(
        `/enterprise/capabilities/${capabilityId}/personal-version`,
        {},
      ),
    onSuccess: () => invalidatePersonal(qc, capabilityId),
  });
}

export function useUpdatePersonalVersion(capabilityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      versionId,
      content,
      changeSummary,
    }: {
      versionId: string;
      content: string;
      changeSummary?: string;
    }) => api.patch(`/enterprise/personal-versions/${versionId}`, { content, changeSummary }),
    onSuccess: () => invalidatePersonal(qc, capabilityId),
  });
}

export function useDiscardPersonalVersion(capabilityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => api.delete(`/enterprise/personal-versions/${versionId}`),
    onSuccess: () => invalidatePersonal(qc, capabilityId),
  });
}

/** 采纳。一个 id 是逐条，多个 id 是一键 —— 会议两种都要，接口只有一个。 */
export function useAdoptPersonalVersions(capabilityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { sourceVersionIds: string[]; changeSummary?: string }) =>
      api.post<{ adoptedCount: number; affectedSubscriptions: number }>(
        `/enterprise/capabilities/${capabilityId}/adopt`,
        payload,
      ),
    onSuccess: () => {
      invalidatePersonal(qc, capabilityId);
      // 采纳会生成新企业版并切为生效 —— 时间线必须一起刷
      void qc.invalidateQueries({ queryKey: capabilityIterationKeys.versions(capabilityId) });
    },
  });
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
  const adopt = useMutation({
    mutationFn: ({
      insightId,
      content,
      changeSummary,
    }: {
      insightId: string;
      content: string;
      changeSummary?: string;
    }) => api.post(`/enterprise/insights/${insightId}/adopt`, { content, changeSummary }),
    onSuccess: invalidate,
  });
  const dismiss = useMutation({
    mutationFn: (insightId: string) => api.post(`/enterprise/insights/${insightId}/dismiss`, {}),
    onSuccess: invalidate,
  });
  return { adopt, dismiss };
}
