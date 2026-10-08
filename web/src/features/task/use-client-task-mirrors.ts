'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';

export interface ClientTaskMirror {
  id: string;
  clientTaskId: string;
  clientRunId: string;
  userId: string;
  user?: { id: string; name: string | null };
  enterpriseId: string | null;
  subscriptionId: string;
  title: string;
  taskType: string;
  modelId: string | null;
  status: string;
  progress: number;
  currentStep: string | null;
  activity: string | null;
  errorSummary: string | null;
  clientVersion: string | null;
  lastSequence: number;
  lastHeartbeatAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientTaskMirrorEvent {
  id: string;
  clientRunId?: string;
  sequence: number;
  type: string;
  stepKey: string | null;
  message: string | null;
  progress: number | null;
  occurredAt: string | null;
  createdAt: string;
}

export interface ClientTaskMirrorPage {
  items: ClientTaskMirror[];
  total: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
  /** Older servers return only their most recent 100 records. */
  legacy?: boolean;
}

export interface ClientTaskMirrorListOptions {
  page?: number;
  limit?: number;
  scope?: 'mine' | 'enterprise';
}

export function normalizeClientTaskMirrorPage(
  response: ClientTaskMirrorPage | ClientTaskMirror[],
  page: number,
  limit: number,
): ClientTaskMirrorPage {
  if (!Array.isArray(response)) return response;
  const offset = (page - 1) * limit;
  return {
    items: response.slice(offset, offset + limit),
    total: response.length,
    page,
    limit,
    hasNextPage: offset + limit < response.length,
    legacy: true,
  };
}

export function useClientTaskMirrors(enabled = true, options: ClientTaskMirrorListOptions = {}) {
  const { page = 1, limit = 50, scope } = options;
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (scope) params.set('scope', scope);
  return useQuery({
    queryKey: qk.clientTaskMirrorList({ page, limit, scope }),
    queryFn: async () => normalizeClientTaskMirrorPage(
      await api.get<ClientTaskMirrorPage | ClientTaskMirror[]>(`/client/tasks?${params}`),
      page,
      limit,
    ),
    enabled,
    refetchInterval: 15000,
  });
}

export function useClientTaskMirror(id: string, enabled = true) {
  return useQuery({
    queryKey: qk.clientTaskMirror(id),
    queryFn: () => api.get<ClientTaskMirror & { events: ClientTaskMirrorEvent[] }>(`/client/tasks/${id}`),
    enabled: enabled && Boolean(id),
    refetchInterval: 10000,
  });
}
