'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { Subscription } from '@/lib/types';

/**
 * 企业订阅列表。**需要登录**。
 *
 * opts.enabled 用于公开页面（人才市场）—— 访客不该发这个请求：
 * 拿 401 后 api-client 会走一轮 refresh 再 clear，纯属白跑。
 */
export function useSubscriptions(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.subscriptions,
    queryFn: () => api.get<Subscription[]>('/subscriptions'),
    enabled: opts?.enabled ?? true,
  });
}

export function useSubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (employeeId: string) =>
      api.post<Subscription>('/subscriptions', { employeeId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.subscriptions });
      qc.invalidateQueries({ queryKey: qk.employees() });
    },
  });
}

export function useUnsubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/subscriptions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.subscriptions });
    },
  });
}

export function useUpdateSubscriptionConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, config }: { id: string; config: Record<string, unknown> }) =>
      api.patch<Subscription>(`/subscriptions/${id}/config`, { config }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.subscriptions });
    },
  });
}
