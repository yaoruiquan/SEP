import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface EmployeeStatsSummary {
  total: number;
  successCount: number;
  failedCount: number;
  avgDuration: number; // ms
}

export interface EmployeeStatsTrendPoint {
  date: string; // YYYY-MM-DD
  total: number;
  success: number;
  failed: number;
}

export interface EmployeeStatsLogEntry {
  id: string;
  toolName: string;
  status: 'SUCCESS' | 'FAILED' | string;
  duration: number | null;
  createdAt: string;
}

export interface EmployeeStats {
  period: { days: number; startDate: string };
  summary: EmployeeStatsSummary;
  trend: EmployeeStatsTrendPoint[];
  recentLog: EmployeeStatsLogEntry[];
}

async function fetchEmployeeStats(employeeId: string, days: number): Promise<EmployeeStats> {
  return api.get<EmployeeStats>(`/digital-employees/${employeeId}/stats?days=${days}`);
}

export function useEmployeeStats(employeeId: string, days: number = 7) {
  return useQuery({
    queryKey: ['employee-stats', employeeId, days],
    queryFn: () => fetchEmployeeStats(employeeId, days),
    staleTime: 60_000, // refresh every minute
    enabled: Boolean(employeeId),
  });
}
