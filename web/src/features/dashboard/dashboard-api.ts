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

export interface DashboardData {
  stats: DashboardStats;
  usageTrend: UsageTrend[];
  topEmployees: TopEmployee[];
}

export async function fetchDashboardData(): Promise<DashboardData> {
  return api.get<DashboardData>('/dashboard');
}
