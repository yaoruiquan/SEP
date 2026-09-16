import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EmployeeDetailPage from './page';

const mocks = vi.hoisted(() => ({
  role: 'ENTERPRISE_ADMIN',
  detail: vi.fn(),
  stats: vi.fn(),
  grants: vi.fn(),
  retry: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'sub-1' }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/auth-store', () => ({
  useAuthStore: () => ({ roleInEnterprise: mocks.role }),
}));
vi.mock('@/features/subscription/use-subscriptions', () => ({
  useSubscription: () => ({
    data: {
      id: 'sub-1',
      name: '员工小林',
      status: 'ACTIVE',
      templateVersion: '1',
      config: {},
      employee: {
        id: 'template-1',
        name: '客服',
        description: '处理客户问题',
        avatar: null,
      },
    },
  }),
  useUpdateSubscription: () => ({ mutate: mocks.mutate }),
}));
vi.mock('@/features/enterprise/use-enterprise', () => ({
  useSubscriptionGrants: mocks.grants,
}));
vi.mock('@/features/employee/use-employee-detail', () => ({
  useEmployeeDetail: mocks.detail,
}));
vi.mock('@/features/employee/use-employee-stats', () => ({
  useSubscriptionEmployeeStats: mocks.stats,
}));
vi.mock('@/features/skill-version/use-skill-version', () => ({
  useEmployeeSkillVersions: () => ({ data: { skills: [] } }),
  useCreateEnterpriseSkillVersion: () => ({}),
  useSelectSkillVersion: () => ({}),
}));
vi.mock('@/features/skill-version/SkillVersionPreviewDialog', () => ({
  SkillVersionPreviewDialog: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'ENTERPRISE_ADMIN';
  mocks.detail.mockReturnValue({
    data: { capabilities: [] },
    refetch: mocks.retry,
  });
  mocks.grants.mockReturnValue({ data: [] });
  mocks.stats.mockReturnValue({
    data: {
      scope: 'enterprise',
      summary: {
        callCount: 8,
        total: 4,
        successCount: 3,
        avgDuration: 1500,
        totalTokens: 1200,
        costCNY: 0.5,
      },
      trend: [],
      recentLog: [],
      byMember: [],
    },
  });
});

describe('EmployeeDetailPage', () => {
  it('使用订阅 ID 读取能力和统计，时间范围统一切换', () => {
    render(<EmployeeDetailPage />);
    expect(mocks.detail).toHaveBeenCalledWith('sub-1');
    expect(mocks.stats).toHaveBeenCalledWith('sub-1', 7);
    expect(screen.getByText('本企业使用情况')).toBeTruthy();
    expect(screen.getByText('模型调用')).toBeTruthy();
    expect(screen.queryByText('今日调用')).toBeNull();
    expect(screen.queryByText('累计费用')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '近 30 天' }));
    expect(mocks.stats).toHaveBeenLastCalledWith('sub-1', 30);
  });
  it('能力接口失败显示重试，不假装没有能力', () => {
    mocks.detail.mockReturnValue({ isError: true, refetch: mocks.retry });
    render(<EmployeeDetailPage />);
    fireEvent.click(screen.getByRole('button', { name: '能力' }));
    expect(screen.getByRole('alert')).toHaveTextContent('能力加载失败');
    expect(screen.queryByText('暂未绑定能力')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });
  it('真实空能力显示空态，配置入口打开配置页', () => {
    render(<EmployeeDetailPage />);
    fireEvent.click(screen.getByRole('button', { name: '能力' }));
    expect(screen.getByText('暂未绑定能力')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '编辑配置' }));
    expect(screen.getByDisplayValue('员工小林')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /暂停使用|恢复使用/ }),
    ).toBeNull();
  });
  it('普通成员只显示个人范围，不查询企业授权名单', () => {
    mocks.role = 'MEMBER';
    render(<EmployeeDetailPage />);
    expect(screen.getByText('我的使用情况')).toBeTruthy();
    expect(mocks.grants).toHaveBeenCalledWith('');
    expect(screen.queryByText('授权范围')).toBeNull();
    expect(screen.queryByRole('button', { name: '编辑配置' })).toBeNull();
  });
  it('统计失败不展示零记录或零消费', () => {
    mocks.stats.mockReturnValue({ isError: true, refetch: mocks.retry });
    render(<EmployeeDetailPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('运行数据加载失败');
    expect(screen.queryByText('暂无执行记录')).toBeNull();
    expect(screen.queryByText('¥0.0000')).toBeNull();
  });
});
