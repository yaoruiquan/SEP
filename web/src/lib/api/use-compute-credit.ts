/**
 * 企业算力 API Hooks（统一人民币口径）。
 *
 * 财务口径只有「元」：对话先扣该硅基员工的赠送余额，用尽后扣企业钱包。
 * Token 只作为用量明细展示，不是可购买或可扣减的余额。
 *
 * 所有金额字段都是后端序列化的 Decimal 字符串，渲染前用 formatCny 处理，
 * 不要直接 toFixed —— 字符串上没有这个方法。
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client';

// ============================================================================
// Types
// ============================================================================

export interface ComputeOverview {
  /** 企业钱包余额（元） */
  walletBalanceCNY: string;
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

/** 算力用量账单（人民币金额 + Token 明细）。 */
export function useUsageRecords(filters: UsageRecordFilters = {}) {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  if (filters.employeeId) params.set('employeeId', filters.employeeId);
  if (filters.memberId) params.set('memberId', filters.memberId);
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);

  const query = params.toString();

  return useQuery({
    queryKey: computeCreditKeys.usage(filters),
    queryFn: () =>
      api.get<UsageRecordsResponse>(
        `/compute-credit/usage-records${query ? `?${query}` : ''}`,
      ),
  });
}
