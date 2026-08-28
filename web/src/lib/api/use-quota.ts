/**
 * 旧 Token 配额体系的**只读** Hooks（迁移期对账用）。
 *
 * ⚠️ 这里的所有 token 数字都已停用，不是可用余额：
 *   - 对话扣费走人民币账本，见 `use-compute-credit.ts`
 *   - 企业充值只进钱包，不再生成 Token 配额
 *   - 赠送额度只由订阅履约以人民币发放
 *
 * 保留它只为让企业还能看到「我有一批旧额度没处理」。展示时必须显式标注已停用，
 * 否则用户会把它当成还能花的钱。分配/购买入口已随后端写入端点一并移除。
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client';

// ============================================================================
// Types
// ============================================================================

export interface LegacyQuotaBucket {
  totalTokens: number;
  usedTokens: number;
  remainingTokens: number;
}

export interface LegacyQuotaSummary {
  /** 恒为 true —— 提醒调用方这是历史数据 */
  deprecated: true;
  user: LegacyQuotaBucket;
  subscription: LegacyQuotaBucket;
  enterprise: LegacyQuotaBucket;
}

export interface LegacySubscriptionQuotaItem {
  id: string;
  subscriptionId: string;
  employeeId: string | null;
  employeeName: string | null;
  employeeAvatar?: string | null;
  totalTokens: number;
  usedTokens: number;
  status: string;
  createdAt: string;
  legacy: true;
}

export interface LegacyUserQuotaItem {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  avatar: string | null;
  totalTokens: number;
  usedTokens: number;
  status: string;
  allocatedAt: string;
  notes: string | null;
  legacy: true;
}

export interface LegacyEnterpriseQuotaItem {
  id: string;
  enterpriseId: string;
  type: string;
  totalTokens: number;
  usedTokens: number;
  expiresAt: string | null;
  status: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
  legacy: true;
}

// ============================================================================
// Query Keys
// ============================================================================

export const legacyQuotaKeys = {
  all: ['legacy-quota'] as const,
  summary: () => [...legacyQuotaKeys.all, 'summary'] as const,
  userQuotas: () => [...legacyQuotaKeys.all, 'user-quotas'] as const,
  subscriptionQuotas: () =>
    [...legacyQuotaKeys.all, 'subscription-quotas'] as const,
  enterpriseQuotas: () => [...legacyQuotaKeys.all, 'enterprise-quotas'] as const,
};

// ============================================================================
// Hooks
// ============================================================================

/** 旧 Token 配额汇总。`deprecated` 恒为 true。 */
export function useLegacyQuotaSummary() {
  return useQuery({
    queryKey: legacyQuotaKeys.summary(),
    queryFn: () => api.get<LegacyQuotaSummary>('/compute-quota/legacy-summary'),
  });
}

export function useLegacySubscriptionQuotas() {
  return useQuery({
    queryKey: legacyQuotaKeys.subscriptionQuotas(),
    queryFn: () =>
      api.get<LegacySubscriptionQuotaItem[]>(
        '/compute-quota/subscription-quotas',
      ),
  });
}

export function useLegacyUserQuotas() {
  return useQuery({
    queryKey: legacyQuotaKeys.userQuotas(),
    queryFn: () => api.get<LegacyUserQuotaItem[]>('/compute-quota/user-quotas'),
  });
}

export function useLegacyEnterpriseQuotas() {
  return useQuery({
    queryKey: legacyQuotaKeys.enterpriseQuotas(),
    queryFn: () =>
      api.get<LegacyEnterpriseQuotaItem[]>('/compute-quota/enterprise-quotas'),
  });
}
