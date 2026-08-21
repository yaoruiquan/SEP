/**
 * 企业算力分配 API Hooks。
 * 对话扣减顺序由后端保证：当前硅基员工的订阅赠送额度 → 当前碳基员工的已分配额度。
 * 企业池只作为管理员分配额度的来源，不参与对话自动兜底。
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
    allocatedTokens: number;
    availableTokens: number;
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
  employeeAvatar?: string | null;
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

export interface QuotaPackage {
  id: string;
  name: string;
  priceCny: number;
  tokens: number;
  detail: string;
  recommended?: boolean;
  unitPriceCnyPerMillion: number;
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
  packages: () => [...quotaKeys.all, 'packages'] as const,
};

// ============================================================================
// Hooks
// ============================================================================

/**
 * 获取企业算力管理总览
 */
export function useQuotaSummary() {
  return useQuery({
    queryKey: quotaKeys.summary(),
    queryFn: async () => {
      return api.get<QuotaSummary>('/compute-quota/summary');
    },
  });
}

export function useQuotaPackages() {
  return useQuery({
    queryKey: quotaKeys.packages(),
    queryFn: () => api.get<QuotaPackage[]>('/compute-quota/packages'),
  });
}

export function usePurchaseQuotaPackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (packageId: string) => api.post('/compute-quota/packages/purchase', { packageId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: quotaKeys.summary() });
      queryClient.invalidateQueries({ queryKey: quotaKeys.enterpriseQuotas() });
      queryClient.invalidateQueries({ queryKey: ['wallet', 'balance'] });
      queryClient.invalidateQueries({ queryKey: ['wallet', 'transactions'] });
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
 * 获取企业可分配池列表
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
