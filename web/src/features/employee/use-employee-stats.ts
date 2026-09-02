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

/**
 * 硅基员工在本企业的使用情况（会议纪要2 §6.2）。
 *
 * 与上面的 `useEmployeeStats` 不同：那个只统计**当前用户自己**的会话
 * （后端按 userId 过滤），这个是企业范围的「谁在用」。会议要的是后者 ——
 * *点进硅基员工能看到使用情况跟踪：谁在用、用了多少次、聊了什么*。
 */
export interface EmployeeEnterpriseUsage {
  period: { days: number; since: string };
  summary: {
    distinctUserCount: number;
    totalConversations: number;
    totalRounds: number;
    totalExecutions: number;
    /** 没有执行记录时为 null —— 「没跑过」和「全失败」是两件事 */
    successRate: number | null;
    avgDurationMs: number | null;
    lastUsedAt: string | null;
  };
  byMember: Array<{
    userId: string;
    userName: string | null;
    conversations: number;
    rounds: number;
    executions: number;
    lastUsedAt: string;
  }>;
}

export function useEmployeeEnterpriseUsage(employeeId: string, days = 30) {
  return useQuery({
    queryKey: ['employee-enterprise-usage', employeeId, days],
    queryFn: () =>
      api.get<EmployeeEnterpriseUsage>(`/enterprise/employees/${employeeId}/usage?days=${days}`),
    enabled: Boolean(employeeId),
  });
}
