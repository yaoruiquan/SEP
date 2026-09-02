'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

/**
 * ⚠️ 算力有两个口径，别混用：
 *   · `costCNY` / `todayCostCNY` —— 人民币，**财务口径**，页面上带 ¥ 的都必须读它
 *   · `tokens` / `todayTokens`   —— token 数，**用量口径**，只能当明细展示
 *
 * 曾经三处（KPI 卡、趋势图、Top 10 企业）把 tokens 套上 ¥ 渲染，
 * 于是 ¥2.08 的当日消费显示成 ¥162221.00 —— 差了近 8 万倍。
 */
export interface AdminStats {
  kpi: {
    totalEnterprises: number;
    suspendedEnterprises: number;
    enterpriseTrendPct: number;
    totalEmployees: number;
    pendingEmployees: number;
    employeeTrendPct: number;
    pendingCapabilities: number;
    /** 今日 token 用量（输入 + 输出），用量口径 */
    todayTokens: number;
    /** 今日算力消费（元），财务口径 */
    todayCostCNY: number;
    /** 环比趋势按人民币成本算 —— 换模型会让同样的 token 数对应完全不同的成本 */
    tokenTrendPct: number;
    todayActiveUsers: number;
    userTrendPct: number;
  };
  computeTrend: Array<{ date: string; tokens: number; costCNY: number }>;
  enterpriseTrend: Array<{ date: string; count: number }>;
  topEnterprises: Array<{ id: string; name: string; tokens: number; costCNY: number }>;
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
