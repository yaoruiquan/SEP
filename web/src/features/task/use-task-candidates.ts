'use client';

import { useQueries } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { DigitalEmployee, Subscription } from '@/lib/types';
import type { TaskCandidateEmployee } from './task-orchestration';
import { useSubscriptions } from '@/features/subscription/use-subscriptions';

function normalizeCandidate(employee: DigitalEmployee): TaskCandidateEmployee {
  return {
    id: employee.id,
    name: employee.name,
    description: employee.description,
    position: employee.position,
    industry: employee.industry,
    avatar: employee.avatar,
    capabilities: (employee.bindings ?? [])
      .filter((binding) => binding.capability?.id)
      .map((binding) => ({
        id: binding.capability.id,
        name: binding.capability.name,
        description: binding.capability.description,
        type: binding.capability.type,
      })),
  };
}

export function useTaskCandidates() {
  const subscriptions = useSubscriptions();
  const activeIds = Array.from(
    new Set(
      (subscriptions.data ?? [])
        .filter((subscription: Subscription) => subscription.status === 'ACTIVE')
        .map((subscription) => subscription.employee.id),
    ),
  );

  const employeeQueries = useQueries({
    queries: activeIds.map((employeeId) => ({
      queryKey: qk.employee(employeeId),
      queryFn: () => api.get<DigitalEmployee>(`/digital-employees/${employeeId}`),
      staleTime: 60_000,
    })),
  });

  const candidates = employeeQueries
    .map((query) => query.data)
    .filter((employee): employee is DigitalEmployee => Boolean(employee))
    .map(normalizeCandidate);
  const detailError = employeeQueries.find((query) => query.error)?.error;

  return {
    candidates,
    isLoading: subscriptions.isLoading || employeeQueries.some((query) => query.isLoading),
    error: subscriptions.error ?? detailError ?? null,
    hasSubscriptions: activeIds.length > 0,
    refetch: () => {
      void subscriptions.refetch();
      employeeQueries.forEach((query) => void query.refetch());
    },
  };
}

export { normalizeCandidate };
