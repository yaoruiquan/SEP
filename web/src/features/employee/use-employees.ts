'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { DigitalEmployee, MarketEmployee } from '@/lib/types';

export function useEmployees(status?: string) {
  const params = status ? { status } : {};
  return useQuery({
    queryKey: qk.employees(params),
    queryFn: () => {
      const qs = status ? `?status=${encodeURIComponent(status)}` : '';
      return api.get<DigitalEmployee[]>(`/digital-employees${qs}`);
    },
  });
}

export function usePublishedEmployees() {
  return useEmployees('PUBLISHED');
}

export function useEmployee(id: string | undefined) {
  return useQuery({
    queryKey: qk.employee(id ?? ''),
    queryFn: () => api.get<DigitalEmployee>(`/digital-employees/${id}`),
    enabled: !!id,
  });
}

// ── 人才市场（公开，无需登录）─────────────────────────────────────────────────

/**
 * 市场列表。走 /market/employees —— 公开接口，访客也能读。
 *
 * 不要在市场页改用 usePublishedEmployees()：那走 /digital-employees，
 * 挂着 JwtAuthGuard，访客会拿 401 而页面永远停在加载态。
 *
 * 返回的是投影后的字段，没有 systemPrompt / modelId / maxSteps。
 */
export function useMarketEmployees(search?: string) {
  const q = search?.trim() ?? '';
  return useQuery({
    queryKey: qk.marketEmployees(q),
    queryFn: () => {
      const qs = q ? `?search=${encodeURIComponent(q)}` : '';
      return api.get<MarketEmployee[]>(`/market/employees${qs}`);
    },
  });
}

/** 市场员工详情。未上架的返回 404。 */
export function useMarketEmployee(id: string | undefined) {
  return useQuery({
    queryKey: qk.marketEmployee(id ?? ''),
    queryFn: () => api.get<MarketEmployee>(`/market/employees/${id}`),
    enabled: !!id,
  });
}
