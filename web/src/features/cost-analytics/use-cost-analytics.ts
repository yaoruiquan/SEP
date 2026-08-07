'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type {
  CostSummary,
  CostByDimensionItem,
  CostTrendPoint,
  CostAlert,
} from '@/lib/types';

export type Granularity = 'day' | 'week' | 'month';

export interface CostQueryParams {
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
}

function buildQs(params: { [key: string]: string | undefined }) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function toRecord(p: CostQueryParams): { [key: string]: string | undefined } {
  return p as { [key: string]: string | undefined };
}

export const costQk = {
  summary: (id: string, p?: CostQueryParams) =>
    ['cost', id, 'summary', p ?? {}] as const,
  byDepartment: (id: string, p?: CostQueryParams) =>
    ['cost', id, 'by-department', p ?? {}] as const,
  byEmployee: (id: string, p?: CostQueryParams) =>
    ['cost', id, 'by-employee', p ?? {}] as const,
  byModel: (id: string, p?: CostQueryParams) =>
    ['cost', id, 'by-model', p ?? {}] as const,
  trend: (id: string, g: Granularity, p?: CostQueryParams) =>
    ['cost', id, 'trend', g, p ?? {}] as const,
  alerts: (id: string) => ['cost', id, 'alerts'] as const,
};

export function useCostSummary(enterpriseId: string, params?: CostQueryParams) {
  return useQuery<CostSummary>({
    queryKey: costQk.summary(enterpriseId, params),
    queryFn: () =>
      api.get<CostSummary>(
        `/enterprises/${enterpriseId}/cost/summary${buildQs(toRecord(params ?? {}))}`,
      ),
    enabled: !!enterpriseId,
  });
}

export function useCostByDepartment(
  enterpriseId: string,
  params?: CostQueryParams,
) {
  return useQuery<CostByDimensionItem[]>({
    queryKey: costQk.byDepartment(enterpriseId, params),
    queryFn: () =>
      api.get<CostByDimensionItem[]>(
        `/enterprises/${enterpriseId}/cost/by-department${buildQs(toRecord(params ?? {}))}`,
      ),
    enabled: !!enterpriseId,
  });
}

export function useCostByEmployee(
  enterpriseId: string,
  params?: CostQueryParams,
) {
  return useQuery<CostByDimensionItem[]>({
    queryKey: costQk.byEmployee(enterpriseId, params),
    queryFn: () =>
      api.get<CostByDimensionItem[]>(
        `/enterprises/${enterpriseId}/cost/by-employee${buildQs(toRecord(params ?? {}))}`,
      ),
    enabled: !!enterpriseId,
  });
}

export function useCostByModel(enterpriseId: string, params?: CostQueryParams) {
  return useQuery<CostByDimensionItem[]>({
    queryKey: costQk.byModel(enterpriseId, params),
    queryFn: () =>
      api.get<CostByDimensionItem[]>(
        `/enterprises/${enterpriseId}/cost/by-model${buildQs(toRecord(params ?? {}))}`,
      ),
    enabled: !!enterpriseId,
  });
}

export function useCostTrend(
  enterpriseId: string,
  granularity: Granularity,
  params?: CostQueryParams,
) {
  return useQuery<CostTrendPoint[]>({
    queryKey: costQk.trend(enterpriseId, granularity, params),
    queryFn: () =>
      api.get<CostTrendPoint[]>(
        `/enterprises/${enterpriseId}/cost/trend${buildQs({
          ...params,
          granularity,
        })}`,
      ),
    enabled: !!enterpriseId,
  });
}

export function useCostAlerts(enterpriseId: string) {
  return useQuery<CostAlert[]>({
    queryKey: costQk.alerts(enterpriseId),
    queryFn: () =>
      api.get<CostAlert[]>(`/enterprises/${enterpriseId}/cost/alerts`),
    enabled: !!enterpriseId,
    refetchInterval: 5 * 60 * 1000, // 每5分钟轮询
  });
}
