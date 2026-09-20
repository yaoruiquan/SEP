import { api } from '@/lib/api-client';

export interface DashboardStats {
  totalEmployees: number;
  activeEmployees: number;
  totalDepartments: number;
  totalMembers: number;
  conversations: {
    total: number;
    /** 环比百分比；上月基数为 0 时后端返回 null（无环比基准）。 */
    trend: number | null;
  };
  computeUsage: {
    total: number;
    /** 环比百分比；上月基数为 0 时后端返回 null（无环比基准）。 */
    trend: number | null;
  };
  balance: number;
}

export interface UsageTrend {
  date: string;
  conversations: number;
  compute: number;
}

export interface TopEmployee {
  id: string;
  name: string;
  conversations: number;
  compute: number;
}

export interface ModelDistribution {
  model: string;
  requests: number;
  tokens: number;
  cost: number;
}

export interface TokenTrend {
  date: string;
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

export interface TopMember {
  id: string;
  name: string;
  avatar?: string | null;
  calls: number;
  cost: number;
}

export type DashboardScope = 'enterprise' | 'member';

export interface DashboardData {
  scope: DashboardScope;
  stats: DashboardStats;
  usageTrend: UsageTrend[];
  topEmployees: TopEmployee[];
  modelDistribution: ModelDistribution[];
  tokenTrend: TokenTrend[];
  topMembers: TopMember[];
}

export async function fetchDashboardData(): Promise<DashboardData> {
  const [dashboard, analytics] = await Promise.all([
    api.get<DashboardData>('/dashboard'),
    api.get<{
      scope?: DashboardScope;
      modelDistribution?: ModelDistribution[];
      tokenTrend?: TokenTrend[];
      topMembers?: TopMember[];
    }>('/enterprise/dashboard-stats'),
  ]);

  return {
    ...dashboard,
    // 后端两个接口都按 JWT 解析真实范围；优先使用 /dashboard 的作用域，
    // analytics 作为兼容旧后端的回退。
    scope: dashboard.scope ?? analytics.scope ?? 'enterprise',
    modelDistribution: analytics.modelDistribution ?? [],
    tokenTrend: analytics.tokenTrend ?? [],
    topMembers: analytics.topMembers ?? [],
  };
}
