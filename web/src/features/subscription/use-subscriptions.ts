'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { Subscription } from '@/lib/types';

export function useSubscriptions() {
  return useQuery({
    queryKey: qk.subscriptions,
    queryFn: () => api.get<Subscription[]>('/subscriptions'),
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
