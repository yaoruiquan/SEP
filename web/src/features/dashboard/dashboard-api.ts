import { api } from '@/lib/api-client';

export interface DashboardStats {
  totalEmployees: number;
  activeEmployees: number;
  totalDepartments: number;
  totalMembers: number;
  conversations: {
    total: number;
    trend: number;
  };
  computeUsage: {
    total: number;
    trend: number;
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

export interface DashboardData {
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
      modelDistribution?: ModelDistribution[];
      tokenTrend?: TokenTrend[];
      topMembers?: TopMember[];
    }>('/enterprise/dashboard-stats'),
  ]);

  return {
    ...dashboard,
    modelDistribution: analytics.modelDistribution ?? [],
    tokenTrend: analytics.tokenTrend ?? [],
    topMembers: analytics.topMembers ?? [],
  };
}
