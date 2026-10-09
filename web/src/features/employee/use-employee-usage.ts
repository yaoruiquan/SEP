"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { ClientTaskMirrorEvent } from "@/features/task/use-client-task-mirrors";

export type UsageSource = "client" | "client-legacy" | "web-conversation" | "web-task";
export interface UsageFilters {
  page?: number;
  limit?: number;
  userId?: string;
  source?: UsageSource;
  order?: "asc" | "desc";
  from?: string;
  to?: string;
}
export interface EmployeeUsageRecord {
  source: UsageSource;
  recordId: string;
  title: string | null;
  taskType: string;
  status: string;
  userId: string;
  userName: string | null;
  usedAt: string;
  timeBasis: string;
}
export interface EmployeeUsageList {
  items: EmployeeUsageRecord[];
  total: number;
  page: number;
  limit: number;
  members?: Array<{ userId: string; userName: string | null }>;
  modelConsumption: { callCount: number; totalTokens: number; costCNY: number };
  coverage: { legacyClientTaskCount: number; readableLegacyClientTaskCount?: number };
}
export type EmployeeUsageDetail =
  | {
      source: "client";
      recordId: string;
      task: { id: string; clientTaskId: string; title: string | null };
      runs: Array<{
        clientRunId: string;
        queuedAt: string;
        participations: Array<{
          id: string;
          clientRunId: string;
          nodeId: string | null;
          title: string | null;
          subscriptionName: string;
          status: string;
          startedAt: string | null;
          completedAt: string | null;
          events: ClientTaskMirrorEvent[];
        }>;
      }>;
    }
  | {
      source: "client-legacy";
      recordId: string;
      task: { id: string; clientTaskId: string; title: string | null };
      run: {
        clientRunId: string;
        status: string;
        queuedAt: string | null;
        startedAt: string | null;
        completedAt: string | null;
        usedAt: string;
        timeBasis: "legacy-started" | "legacy-input" | "legacy-queued" | "legacy-received";
      };
      events: ClientTaskMirrorEvent[];
    }
  | {
      source: "web-conversation" | "web-task";
      recordId: string;
      session: { title: string | null };
      messages: Array<{
        id: string;
        role: string;
        content: string | null;
        createdAt: string;
      }>;
    };

export function usageQueryString(filters: UsageFilters): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  return query.toString();
}

export function useEmployeeUsage(
  subscriptionId: string,
  filters: UsageFilters,
) {
  return useQuery({
    queryKey: ["subscriptions", subscriptionId, "usage-records", filters],
    queryFn: () =>
      api.get<EmployeeUsageList>(
        `/subscriptions/${encodeURIComponent(subscriptionId)}/usage-records?${usageQueryString(filters)}`,
      ),
    enabled: Boolean(subscriptionId),
  });
}

export function useEmployeeUsageDetail(
  subscriptionId: string,
  record: Pick<EmployeeUsageRecord, "source" | "recordId"> | null,
  refetchInterval?: number,
) {
  return useQuery({
    queryKey: [
      "subscriptions",
      subscriptionId,
      "usage-record-detail",
      record?.source,
      record?.recordId,
    ],
    queryFn: () =>
      api.get<EmployeeUsageDetail>(
        `/subscriptions/${encodeURIComponent(subscriptionId)}/usage-records/${record!.source}/${encodeURIComponent(record!.recordId)}`,
      ),
    enabled: Boolean(subscriptionId && record),
    staleTime: 0,
    refetchInterval,
  });
}

export function businessDateRange(
  days: number,
  now = new Date(),
): Pick<UsageFilters, "from" | "to"> {
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const end = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + 1,
  );
  return {
    from: new Date(end - days * 86400000).toISOString().slice(0, 10),
    to: new Date(end).toISOString().slice(0, 10),
  };
}
