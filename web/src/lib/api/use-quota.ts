/**
 * 三级配额系统 API Hooks
 *
 * 三级配额优先级：
 * - Priority 0: UserQuota (碳基员工个人配额) - 优先消耗
 * - Priority 1: SubscriptionQuota (硅基员工订阅配额)
 * - Priority 2: ComputeQuota (企业配额池) - 兜底
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';

// ============================================================================
// Types
// ============================================================================

export interface QuotaSummary {
  user: {
    totalTokens: number;
    usedTokens: number;
  };
  subscription: {
    totalTokens: number;
    usedTokens: number;
  };
  enterprise: {
    totalTokens: number;
    usedTokens: number;
  };
}

export interface UserQuotaItem {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  avatar: string | null;
  role: string;
  quota: {
    id: string;
    totalTokens: number;
    usedTokens: number;
    status: string;
    allocatedAt: string;
    allocatedBy: string | null;
    notes: string | null;
  } | null;
}

export interface SubscriptionQuotaItem {
  id: string;
  subscriptionId: string;
  employeeName: string | null;
  employeeId: string | null;
  totalTokens: number;
  usedTokens: number;
  status: string;
  createdAt: string;
}

export interface EnterpriseQuotaItem {
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
}

export interface AllocateUserQuotaDto {
  targetUserId: string;
  totalTokens: number;
  notes?: string;
}

export interface AllocateEnterpriseQuotaDto {
  type: 'FREE' | 'STANDARD' | 'PREMIUM';
  totalTokens: number;
  expiresAt?: string;
}

// ============================================================================
// Query Keys
// ============================================================================

export const quotaKeys = {
  all: ['quota'] as const,
  summary: () => [...quotaKeys.all, 'summary'] as const,
  userQuotas: () => [...quotaKeys.all, 'user-quotas'] as const,
  subscriptionQuotas: () => [...quotaKeys.all, 'subscription-quotas'] as const,
  enterpriseQuotas: () => [...quotaKeys.all, 'enterprise-quotas'] as const,
};

// ============================================================================
// Hooks
// ============================================================================

/**
 * 获取三级配额总览
 */
export function useQuotaSummary() {
  return useQuery({
    queryKey: quotaKeys.summary(),
    queryFn: async () => {
      return api.get<QuotaSummary>('/compute-quota/summary');
    },
  });
}

/**
 * 获取碳基员工个人配额列表
 */
export function useUserQuotas() {
  return useQuery({
    queryKey: quotaKeys.userQuotas(),
    queryFn: async () => {
      return api.get<UserQuotaItem[]>('/compute-quota/user-quotas');
    },
  });
}

/**
 * 获取硅基员工订阅配额列表
 */
export function useSubscriptionQuotas() {
  return useQuery({
    queryKey: quotaKeys.subscriptionQuotas(),
    queryFn: async () => {
      return api.get<SubscriptionQuotaItem[]>('/compute-quota/subscription-quotas');
    },
  });
}

/**
 * 获取企业配额池列表
 */
export function useEnterpriseQuotas() {
  return useQuery({
    queryKey: quotaKeys.enterpriseQuotas(),
    queryFn: async () => {
      return api.get<EnterpriseQuotaItem[]>('/compute-quota/enterprise-quotas');
    },
  });
}

/**
 * 分配个人配额给碳基员工
 */
export function useAllocateUserQuota() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: AllocateUserQuotaDto) => {
      return api.post('/compute-quota/user-quotas/allocate', data);
    },
    onSuccess: () => {
      // 刷新所有相关查询
      queryClient.invalidateQueries({ queryKey: quotaKeys.summary() });
      queryClient.invalidateQueries({ queryKey: quotaKeys.userQuotas() });
    },
  });
}

/**
 * 分配企业配额池
 */
export function useAllocateEnterpriseQuota() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: AllocateEnterpriseQuotaDto) => {
      return api.post('/compute-quota/enterprise-quotas/allocate', data);
    },
    onSuccess: () => {
      // 刷新所有相关查询
      queryClient.invalidateQueries({ queryKey: quotaKeys.summary() });
      queryClient.invalidateQueries({ queryKey: quotaKeys.enterpriseQuotas() });
    },
  });
}
