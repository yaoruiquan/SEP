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
  balance: string; // Decimal as string from wallet
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
 * 主动向支付宝核对订单状态（兜底）。
 *
 * 异步通知可能丢失（回调地址错配、服务重启、网络问题），
 * 只靠轮询本地状态会永远停在 PENDING。此 hook 让结果页在等待若干秒后
 * 主动触发一次对账，把「支付宝已收钱、平台未入账」的情况救回来。
 */
export function useReconcileRechargeOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (orderNo: string) =>
      api.post<{ status: string; reconciled: boolean }>(
        '/payment/alipay/recharge/reconcile',
        { orderNo },
      ),
    onSuccess: (result, orderNo) => {
      if (result.reconciled) {
        // 对账补履约成功，刷新订单与余额
        queryClient.invalidateQueries({
          queryKey: ['compute', 'recharge', 'order', orderNo],
        });
        queryClient.invalidateQueries({ queryKey: ['compute', 'account'] });
      }
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

// ── Consumption Logs ───────────────────────────────────────────────────────

export interface ConsumptionLogDetail {
  sessionId?: string;
  conversationTitle?: string;
  tokenCount?: number;
  modelName?: string;
  subscriptionId?: string;
  planName?: string;
  billingCycle?: string;
}

export interface ConsumptionLog {
  id: string;
  createdAt: string;
  type: 'COMPUTE' | 'SUBSCRIPTION';
  amount: string;
  employeeName: string;
  employeeId: string;
  memberName: string | null;
  memberId: string | null;
  detail: ConsumptionLogDetail;
}

export interface ConsumptionLogQuery {
  type?: 'COMPUTE' | 'SUBSCRIPTION';
  employeeId?: string;
  memberId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

export interface ConsumptionLogResponse {
  logs: ConsumptionLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TopConsumer {
  employeeId: string;
  employeeName: string;
  employeeAvatar: string | null;
  totalAmount: string;
  callCount: number;
  percentage: number;
}

export interface TopConsumersResponse {
  consumers: TopConsumer[];
  totalAmount: string;
}

export function useConsumptionLogs(query: ConsumptionLogQuery) {
  return useQuery<ConsumptionLogResponse>({
    queryKey: ['compute', 'consumption-logs', query],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (query.type) sp.append('type', query.type);
      if (query.employeeId) sp.append('employeeId', query.employeeId);
      if (query.memberId) sp.append('memberId', query.memberId);
      if (query.startDate) sp.append('startDate', query.startDate);
      if (query.endDate) sp.append('endDate', query.endDate);
      if (query.page) sp.append('page', query.page.toString());
      if (query.pageSize) sp.append('pageSize', query.pageSize.toString());

      const qs = sp.toString();
      return api.get(`/compute/consumption-logs${qs ? `?${qs}` : ''}`);
    },
  });
}

export function useTopConsumers(limit = 5) {
  return useQuery<TopConsumersResponse>({
    queryKey: ['compute', 'top-consumers', limit],
    queryFn: () => {
      const sp = new URLSearchParams();
      sp.append('limit', limit.toString());
      return api.get(`/compute/top-consumers?${sp.toString()}`);
    },
  });
}
