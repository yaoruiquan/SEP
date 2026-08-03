'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface ComputeAccount {
  id: string;
  balance: number;
  enterpriseId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ComputeTransaction {
  id: string;
  type: 'RECHARGE' | 'CONSUME' | 'REFUND';
  amount: number;
  description: string | null;
  sessionId: string | null;
  createdAt: string;
  metadata?: any;
}

export interface ComputeStats {
  balance: number;
  todayConsume: number;
  monthConsume: number;
  trendData: Array<{ date: string; amount: number }>;
}

export function useComputeAccount() {
  return useQuery<ComputeAccount>({
    queryKey: ['compute', 'account'],
    queryFn: () => api.get<ComputeAccount>('/compute/account'),
  });
}

export function useComputeStats() {
  return useQuery<ComputeStats>({
    queryKey: ['compute', 'stats'],
    queryFn: () => api.get<ComputeStats>('/compute/stats'),
  });
}

export function useComputeTransactions(params?: {
  type?: 'RECHARGE' | 'CONSUME' | 'REFUND';
  limit?: number;
  offset?: number;
}) {
  return useQuery<{ total: number; transactions: ComputeTransaction[] }>({
    queryKey: ['compute', 'transactions', params],
    queryFn: () => {
      const searchParams = new URLSearchParams();
      if (params?.type) searchParams.append('type', params.type);
      if (params?.limit) searchParams.append('limit', params.limit.toString());
      if (params?.offset) searchParams.append('offset', params.offset.toString());

      const qs = searchParams.toString();
      return api.get(`/compute/transactions${qs ? `?${qs}` : ''}`);
    },
  });
}

export function useRecharge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { amount: number; description?: string }) =>
      api.post<ComputeTransaction>('/compute/recharge', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compute', 'account'] });
      queryClient.invalidateQueries({ queryKey: ['compute', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['compute', 'transactions'] });
    },
  });
}
