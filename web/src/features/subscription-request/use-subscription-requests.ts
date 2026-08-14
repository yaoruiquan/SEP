'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { SubscriptionRequest, RequestStatus } from '@/lib/types';

// DTOs
export interface CreateSubscriptionRequestDto {
  employeeId: string;
  reason?: string;
  requestedDays?: number;
}

export interface ApproveSubscriptionRequestDto {
  reviewNote?: string;
  approvedDays?: number;
}

export interface RejectSubscriptionRequestDto {
  reviewNote: string;
}

/**
 * 创建订阅申请（普通成员）
 */
export function useCreateSubscriptionRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateSubscriptionRequestDto) =>
      api.post<SubscriptionRequest>('/subscription-requests', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.mySubscriptionRequests });
      qc.invalidateQueries({ queryKey: qk.pendingSubscriptionRequests });
    },
  });
}

/**
 * 查询我的申请（申请人）
 */
export function useMySubscriptionRequests() {
  return useQuery({
    queryKey: qk.mySubscriptionRequests,
    queryFn: () => api.get<SubscriptionRequest[]>('/subscription-requests/my'),
  });
}

/**
 * 取消自己的申请（申请人）
 */
export function useCancelSubscriptionRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.patch<SubscriptionRequest>(`/subscription-requests/${id}/cancel`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.mySubscriptionRequests });
    },
  });
}

/**
 * 查询待审批申请（管理员）
 */
export function usePendingSubscriptionRequests() {
  return useQuery({
    queryKey: qk.pendingSubscriptionRequests,
    queryFn: () => api.get<SubscriptionRequest[]>('/subscription-requests/pending'),
  });
}

/**
 * 查询所有申请（管理员，可筛选状态）
 */
export function useAllSubscriptionRequests(status?: RequestStatus) {
  const path = status
    ? `/subscription-requests?status=${encodeURIComponent(status)}`
    : '/subscription-requests';
  return useQuery({
    queryKey: [...qk.subscriptionRequests, status ?? 'all'],
    queryFn: () => api.get<SubscriptionRequest[]>(path),
  });
}

/**
 * 审批通过订阅申请（管理员）
 */
export function useApproveSubscriptionRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: ApproveSubscriptionRequestDto }) =>
      api.patch<{ request: SubscriptionRequest; subscription: unknown; grant: unknown }>(
        `/subscription-requests/${id}/approve`,
        dto,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.pendingSubscriptionRequests });
      qc.invalidateQueries({ queryKey: qk.subscriptionRequests });
      qc.invalidateQueries({ queryKey: qk.subscriptions });
    },
  });
}

/**
 * 拒绝订阅申请（管理员）
 */
export function useRejectSubscriptionRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: RejectSubscriptionRequestDto }) =>
      api.patch<SubscriptionRequest>(`/subscription-requests/${id}/reject`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.pendingSubscriptionRequests });
      qc.invalidateQueries({ queryKey: qk.subscriptionRequests });
    },
  });
}
