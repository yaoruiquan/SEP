/**
 * 企业算力 API Hooks（统一人民币口径）。
 *
 * 财务口径只有「元」：对话先扣该硅基员工的赠送余额，用尽后扣企业钱包。
 * Token 只作为用量明细展示，不是可购买或可扣减的余额。
 *
 * 所有金额字段都是后端序列化的 Decimal 字符串，渲染前用 formatCny 处理，
 * 不要直接 toFixed —— 字符串上没有这个方法。
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';

// ============================================================================
// Types
// ============================================================================

export interface ComputeOverview {
  /** 企业钱包余额（元） */
  walletBalanceCNY: string;
  /**
   * 界面上叫「算力余额」，后端字段叫算力专款 —— 同一个东西，两套词。
   *
   * 用户心智里算力是充值买来的；后端实现上它是钱包余额里贴了
   * 「只能用于与硅基员工对话」标签的一部分，不是第二个账户。
   * 订阅付费动不了它；对话扣费优先消耗它，用尽后仍从自由余额扣，对话不中断。
   */
  computeReservedCNY: string;
  /** 钱包里没被专款占用的部分，订阅等非算力支出只能动这里（元） */
  walletSpendableCNY: string;
  /** 所有在用订阅的剩余赠送余额合计（元） */
  creditRemainingCNY: string;
  /** 钱包 + 赠送，用户视角的「还能对话多少钱」 */
  totalAvailableCNY: string;
  creditGrantedTotalCNY: string;
  creditUsedTotalCNY: string;
  todayConsumeCNY: string;
  monthConsumeCNY: string;
  monthInputTokens: number;
  monthOutputTokens: number;
  totalDepositCNY: string;
  totalConsumeCNY: string;
}

export type CreditStatus = 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED';

export interface SubscriptionCreditItem {
  id: string;
  subscriptionId: string;
  employeeId: string;
  employeeName: string;
  employeeAvatar: string | null;
  grantedCNY: string;
  usedCNY: string;
  remainingCNY: string;
  status: CreditStatus | string;
  grantedAt: string;
}

/** 一位碳基员工的算力分配情况。 */
export interface MemberAllowanceItem {
  userId: string;
  name: string;
  email: string;
  departmentName: string | null;
  /** null = 未分配额度（不限额） */
  limitCNY: string | null;
  enabled: boolean;
  usedCNY: string;
  /** 不限额时为 null */
  remainingCNY: string | null;
  /** 0–100；不限额时为 null */
  usedPct: number | null;
  resetAt: string;
}

export interface UsageRecordItem {
  id: string;
  createdAt: string;
  employeeId: string | null;
  employeeName: string;
  memberId: string | null;
  memberName: string | null;
  sessionId: string | null;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  /** 本次真实成本（元） */
  costCNY: string;
  /** 由赠送余额承担的部分（元） */
  creditPaidCNY: string;
  /** 由企业钱包承担的部分（元） */
  walletPaidCNY: string;
  /** > 0 表示余额已耗尽，本次消费有欠费 */
  unpaidCNY: string;
  /** true = 该模型未配价，按保底价计费 */
  fallbackPricing: boolean;
}

export interface UsageRecordsResponse {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  records: UsageRecordItem[];
}

export interface UsageRecordFilters {
  page?: number;
  pageSize?: number;
  employeeId?: string;
  memberId?: string;
  startDate?: string;
  endDate?: string;
}

// ============================================================================
// Query Keys
// ============================================================================

export const computeCreditKeys = {
  all: ['compute-credit'] as const,
  overview: () => [...computeCreditKeys.all, 'overview'] as const,
  credits: () => [...computeCreditKeys.all, 'subscription-credits'] as const,
  credit: (subscriptionId: string) =>
    [...computeCreditKeys.all, 'subscription-credits', subscriptionId] as const,
  allowances: () => [...computeCreditKeys.all, 'allowances'] as const,
  usage: (filters: UsageRecordFilters) =>
    [...computeCreditKeys.all, 'usage-records', filters] as const,
};

// ============================================================================
// Helpers
// ============================================================================

/** 统一的人民币格式化。后端给的是字符串，Number 化后固定两位小数。 */
export function formatCny(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return `¥${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

/** 账单明细里的小额金额需要更高精度，否则一整页都是 ¥0.00。 */
export function formatCnyPrecise(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '¥0.00';
  return `¥${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
}

// ============================================================================
// Hooks
// ============================================================================

export interface ComputeReserveResult {
  balance: string;
  computeReservedCNY: string;
  spendableCNY: string;
}

/**
 * 钱包自由余额 ↔ 算力专款 的划转。
 *
 * 成功后必须同时失效 compute-credit 总览与 wallet 余额：两个页面读的是
 * 同一笔钱的两个视角，只刷一边会让用户看到自相矛盾的数字。
 */
function useReserveMutation(path: '/wallet/compute-reserve' | '/wallet/compute-release') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amount: number) =>
      api.post<ComputeReserveResult>(path, { amount }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: computeCreditKeys.overview() });
      qc.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
}

/** 从钱包划入算力专款。 */
export function useReserveForCompute() {
  return useReserveMutation('/wallet/compute-reserve');
}

/** 把算力专款划回钱包自由余额。 */
export function useReleaseFromCompute() {
  return useReserveMutation('/wallet/compute-release');
}

/** 企业算力总览：钱包余额 + 赠送余额 + 消费汇总。 */
export function useComputeOverview() {
  return useQuery({
    queryKey: computeCreditKeys.overview(),
    queryFn: () => api.get<ComputeOverview>('/compute-credit/overview'),
  });
}

/** 各硅基员工的剩余赠送算力余额。 */
export function useSubscriptionCredits() {
  return useQuery({
    queryKey: computeCreditKeys.credits(),
    queryFn: () =>
      api.get<SubscriptionCreditItem[]>('/compute-credit/subscription-credits'),
  });
}

/** 单个订阅的赠送余额（员工详情页）。 */
export function useSubscriptionCredit(subscriptionId: string | undefined) {
  return useQuery({
    queryKey: computeCreditKeys.credit(subscriptionId ?? ''),
    enabled: !!subscriptionId,
    queryFn: () =>
      api.get<{
        subscriptionId: string;
        grantedCNY: string;
        usedCNY: string;
        remainingCNY: string;
        status: string;
      }>(`/compute-credit/subscription-credits/${subscriptionId}`),
  });
}

export const USAGE_RECORDS_PATH = '/compute-credit/usage-records';

/**
 * 筛选条件 → 带 query string 的完整请求路径。
 *
 * hook 与 CSV 导出共用同一个拼装函数：两处各拼一遍，迟早会出现
 * 「界面筛了员工、导出的却是全量」这种对不上的账。
 */
export function buildUsageRecordsUrl(filters: UsageRecordFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  if (filters.employeeId) params.set('employeeId', filters.employeeId);
  if (filters.memberId) params.set('memberId', filters.memberId);
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);

  const query = params.toString();
  return `${USAGE_RECORDS_PATH}${query ? `?${query}` : ''}`;
}

/** 单页拉取账单，供 CSV 导出逐页取全量时复用（不进 react-query 缓存）。 */
export function fetchUsageRecords(
  filters: UsageRecordFilters = {},
): Promise<UsageRecordsResponse> {
  return api.get<UsageRecordsResponse>(buildUsageRecordsUrl(filters));
}

/** 算力用量账单（人民币金额 + Token 明细）。 */
export function useUsageRecords(filters: UsageRecordFilters = {}) {
  return useQuery({
    queryKey: computeCreditKeys.usage(filters),
    queryFn: () => fetchUsageRecords(filters),
  });
}

// ── 算力分配（给碳基员工设本周期上限）──────────────────────────────────────

/** 全体碳基员工的本月额度与已用金额。 */
export function useMemberAllowances() {
  return useQuery({
    queryKey: computeCreditKeys.allowances(),
    queryFn: () => api.get<MemberAllowanceItem[]>('/compute-credit/allowances'),
  });
}

/**
 * 给某位成员分配额度。`limitCNY: null` = 取消限额。
 *
 * 成功后要连总览一起失效：分配本身不动余额，但页面上两处都会显示
 * 「已分配几人」这类派生数字，只刷一边会不一致。
 */
export function useSetMemberAllowance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, limitCNY }: { userId: string; limitCNY: number | null }) =>
      api.put<MemberAllowanceItem>(`/compute-credit/allowances/${userId}`, {
        limitCNY,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: computeCreditKeys.allowances() });
      qc.invalidateQueries({ queryKey: computeCreditKeys.overview() });
    },
  });
}
