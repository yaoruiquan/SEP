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

export interface TransactionListParams {
  type?: 'RECHARGE' | 'CONSUME' | 'REFUND';
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  page?: number;
  pageSize?: number;
}

export interface TransactionListResult {
  total: number;
  page: number;
  pageSize: number;
  transactions: ComputeTransaction[];
}

export function useComputeTransactions(params?: TransactionListParams) {
  return useQuery<TransactionListResult>({
    queryKey: ['compute', 'transactions', params],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (params?.type) sp.append('type', params.type);
      if (params?.startDate) sp.append('startDate', params.startDate);
      if (params?.endDate) sp.append('endDate', params.endDate);
      if (params?.page) sp.append('page', params.page.toString());
      if (params?.pageSize) sp.append('pageSize', params.pageSize.toString());

      const qs = sp.toString();
      return api.get(`/compute/transactions${qs ? `?${qs}` : ''}`);
    },
  });
}

export interface RechargeOrder {
  orderId: string;
  orderNo: string;
  amount: number;
  status: 'PENDING' | 'PAID' | 'CLOSED';
  paidAt?: string;
  createdAt: string;
}

export function useCreateRechargeOrder() {
  return useMutation({
    mutationFn: (data: { amount: number }) =>
      api.post<RechargeOrder>('/compute/recharge/orders', data),
  });
}

export function useRechargeOrder(orderNo: string | null) {
  return useQuery<RechargeOrder>({
    queryKey: ['compute', 'recharge', 'order', orderNo],
    queryFn: () => api.get<RechargeOrder>(`/compute/recharge/orders/${orderNo}`),
    enabled: !!orderNo,
    refetchInterval: (query) => {
      const data = query.state.data;
      // 如果订单状态为 PENDING，每 2 秒轮询一次
      return data?.status === 'PENDING' ? 2000 : false;
    },
  });
}

/**
 * @deprecated 旧的模拟充值接口，已废弃。请使用 useCreateRechargeOrder() 创建支付订单。
 */
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
