'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface AdminStats {
  kpi: {
    totalEnterprises: number;
    suspendedEnterprises: number;
    enterpriseTrendPct: number;
    totalEmployees: number;
    pendingEmployees: number;
    employeeTrendPct: number;
    pendingCapabilities: number;
    todayTokens: number;
    tokenTrendPct: number;
    todayActiveUsers: number;
    userTrendPct: number;
  };
  computeTrend: Array<{ date: string; tokens: number }>;
  enterpriseTrend: Array<{ date: string; count: number }>;
  topEnterprises: Array<{ id: string; name: string; tokens: number }>;
  topEmployees: Array<{ id: string; name: string; type: string; calls: number }>;
}

export function useAdminStats() {
  return useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.get<AdminStats>('/admin/stats'),
    // 仪表盘数据，1 分钟内视为新鲜
    staleTime: 60_000,
  });
}
