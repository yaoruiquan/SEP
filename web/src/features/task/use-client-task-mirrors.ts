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
  queuedAt?: string | null;
  protocolVersion?: number;
  subscriptionSummary?: {
    coverage: 'proven' | 'limited';
    subscriptions: (ClientTaskSubscriptionOption & { executionCount: number })[];
    legacySubscriptionId: string | null;
  };
  runs?: ClientTaskMirrorRun[];
}

export interface ClientTaskMirrorParticipation {
  id: string;
  executionId: string;
  clientRunId: string;
  subscriptionId: string;
  employeeId: string | null;
  employeeName: string | null;
  subscriptionName: string | null;
  nodeId: string | null;
  title: string | null;
  modelId: string | null;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  events?: ClientTaskMirrorEvent[];
}

export interface ClientTaskMirrorRun {
  id: string;
  clientRunId: string;
  subscriptionId: string;
  employeeId: string | null;
  employeeName: string | null;
  subscriptionName: string | null;
  protocolVersion: number;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  status: string;
  participations: ClientTaskMirrorParticipation[];
}

export interface ClientTaskMirrorEvent {
  id: string;
  clientRunId?: string;
  participationId?: string | null;
  sequence: number;
  type: string;
  stepKey: string | null;
  message: string | null;
  progress: number | null;
  occurredAt: string | null;
  createdAt: string;
}

export interface ClientTaskMirrorDetail extends ClientTaskMirror {
  runs?: ClientTaskMirrorRun[];
  events: ClientTaskMirrorEvent[];
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
  subscriptionId?: string;
  userId?: string;
  statuses?: string;
  view?: 'active' | 'attention' | 'history';
  taskType?: string;
  from?: string;
  to?: string;
  q?: string;
  sort?: ClientTaskMirrorSort;
}

export type ClientTaskMirrorSort = 'queuedAt_desc' | 'queuedAt_asc' | 'startedAt_desc' | 'startedAt_asc' | 'updatedAt_desc' | 'updatedAt_asc';

export interface ClientTaskSubscriptionOption {
  subscriptionId: string;
  employeeId: string | null;
  employeeName: string | null;
  subscriptionName: string | null;
}

export interface ClientTaskMirrorFilterOptions {
  users: { id: string; name: string | null }[];
  subscriptions: ClientTaskSubscriptionOption[];
  taskTypes: string[];
  counts: { active: number; attention: number; history: number };
}

export function useClientTaskMirrorFilterOptions(options: ClientTaskMirrorListOptions = {}) {
  const { page: _page, limit: _limit, sort: _sort, view: _view, statuses: _statuses, ...filters } = options;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return useQuery({
    queryKey: qk.clientTaskMirrorFilterOptions(filters),
    queryFn: () => api.get<ClientTaskMirrorFilterOptions>(`/client/tasks/filter-options${params.size ? `?${params}` : ''}`),
    refetchInterval: 15000,
  });
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
  const { page = 1, limit = 50, ...filters } = options;
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return useQuery({
    queryKey: qk.clientTaskMirrorList({ page, limit, ...filters }),
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
    queryFn: () => api.get<ClientTaskMirrorDetail>(`/client/tasks/${encodeURIComponent(id)}`),
    enabled: enabled && Boolean(id),
    refetchInterval: 10000,
  });
}
