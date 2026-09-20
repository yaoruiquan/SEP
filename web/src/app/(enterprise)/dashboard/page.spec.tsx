import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardPage from './page';
import { useAuthStore } from '@/lib/auth-store';

const mockDashboard = vi.hoisted(() => ({ data: null as any }));

const dashboardData = {
  scope: 'enterprise' as const,
  stats: {
    totalEmployees: 4,
    activeEmployees: 2,
    totalDepartments: 2,
    totalMembers: 8,
    conversations: { total: 12, trend: 10 },
    computeUsage: { total: 3.2, trend: 5 },
    balance: 100,
  },
  usageTrend: [],
  topEmployees: [],
  modelDistribution: [],
  tokenTrend: [{ date: '2026-09-20', input: 10, output: 20, cacheCreation: 0, cacheRead: 0 }],
  topMembers: [{ id: 'm1', name: '成员 A', calls: 4, cost: 1.2 }],
};

vi.mock('@/features/dashboard/use-dashboard', () => ({
  useDashboard: () => ({ data: mockDashboard.data, isLoading: false, isError: false }),
}));

function setRole(roleInEnterprise: string) {
  useAuthStore.setState({
    token: 't',
    user: { id: 'u1', email: 'u@example.com', name: '测试用户', avatar: null, role: 'USER' },
    enterprise: { id: 'e1', name: '示例企业' },
    roleInEnterprise,
    hydrated: true,
  });
}

describe('工作台按角色显示数据范围', () => {
  beforeEach(() => {
    mockDashboard.data = dashboardData;
    useAuthStore.setState({ token: null, user: null, enterprise: null, roleInEnterprise: null, hydrated: false });
  });

  it('企业管理员显示成员使用情况', () => {
    setRole('ENTERPRISE_ADMIN');
    render(<DashboardPage />);
    expect(screen.getByText('成员使用情况')).toBeInTheDocument();
    expect(screen.getByText('碳基员工')).toBeInTheDocument();
  });

  it('普通成员不显示企业成员排行，并使用个人口径文案', () => {
    mockDashboard.data = { ...dashboardData, scope: 'member' as const, topMembers: [] };
    setRole('MEMBER');
    render(<DashboardPage />);
    expect(screen.queryByText('成员使用情况')).not.toBeInTheDocument();
    expect(screen.getByText('我的模型使用分析')).toBeInTheDocument();
    expect(screen.getByText('我的 Token 使用趋势')).toBeInTheDocument();
    expect(screen.getByText('我的可用硅基员工')).toBeInTheDocument();
  });
});
