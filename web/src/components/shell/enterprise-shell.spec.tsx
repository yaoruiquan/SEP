import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EnterpriseShell } from './enterprise-shell';
import { useAuthStore } from '@/lib/auth-store';
// 断言引用文案单一来源，避免文案调整后测试与实现漂移
import { nav } from '@/locales/zh-CN';

// next/navigation 在测试环境没有 router 上下文：NavItem 用 usePathname 判高亮，
// 顶栏里的 CartButton 用 useRouter 跳购物车 —— 少 mock 一个整个 shell 都渲染不出来。
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

// logout 会发请求，这里只关心导航渲染
vi.mock('@/features/auth/use-auth', () => ({
  useLogout: () => ({ mutate: vi.fn() }),
}));

// 真 ThemeProvider 在 effect 里读 localStorage，测试环境不可用。
// 导航渲染与主题无关，给个固定值即可。
vi.mock('@/lib/theme-provider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));

const setRole = (roleInEnterprise: string | null) =>
  useAuthStore.setState({
    token: 't',
    user: { id: 'u1', email: 'a@b.c', name: '测试', role: 'USER' },
    enterprise: { id: 'e1', name: '示例科技' },
    roleInEnterprise,
    hydrated: true,
  });

/**
 * 外壳内含 NotificationBell，它用 useQuery 拉未读数，
 * 缺少 QueryClientProvider 会直接抛错 —— 故所有渲染都走这个包装。
 * 主题不走真 Provider（它读 localStorage），改为 mock，见上方。
 */
const renderShell = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <EnterpriseShell>内容</EnterpriseShell>
    </QueryClientProvider>,
  );
};

describe('EnterpriseShell 导航角色过滤', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: null,
      user: null,
      enterprise: null,
      roleInEnterprise: null,
      hydrated: false,
    });
  });

  it('企业管理员能看到「组织」组的部门与碳基员工', () => {
    setRole('ENTERPRISE_ADMIN');
    renderShell();

    expect(screen.getByText(nav.departments)).toBeInTheDocument();
    expect(screen.getByText(nav.members)).toBeInTheDocument();
  });

  it('普通成员看不到部门/团队成员 —— 进去也什么都改不了', () => {
    setRole('MEMBER');
    renderShell();

    expect(screen.queryByText(nav.departments)).not.toBeInTheDocument();
    expect(screen.queryByText(nav.members)).not.toBeInTheDocument();
  });

  it('DEPT_MANAGER 本版按普通成员对待，同样看不到组织组', () => {
    // 该角色要名副其实需要「数据范围」那一层，后端尚无，
    // 故不给它任何高于 MEMBER 的可见项
    setRole('DEPT_MANAGER');
    renderShell();

    expect(screen.queryByText(nav.departments)).not.toBeInTheDocument();
  });

  it('所有角色都能看到「我的硅基员工」与用量统计', () => {
    for (const role of ['ENTERPRISE_ADMIN', 'MEMBER', 'DEPT_MANAGER']) {
      setRole(role);
      const { unmount } = renderShell();
      expect(screen.getByText(nav.myEmployees)).toBeInTheDocument();
      expect(screen.getByText(nav.usage)).toBeInTheDocument();
      unmount();
    }
  });

  it('侧边栏显示企业名而非平台名（多租户下确认在哪家企业）', () => {
    setRole('MEMBER');
    renderShell();

    expect(screen.getByText('示例科技')).toBeInTheDocument();
  });

  it('「员工授权」仅管理员可见 —— 普通成员进去全是点不动的按钮', () => {
    setRole('ENTERPRISE_ADMIN');
    const { unmount } = renderShell();
    expect(screen.getByText(nav.instances)).toBeInTheDocument();
    unmount();

    setRole('MEMBER');
    renderShell();
    expect(screen.queryByText(nav.instances)).not.toBeInTheDocument();
    // 但「我的硅基员工」仍在 —— 这是成员的主页面
    expect(screen.getByText(nav.myEmployees)).toBeInTheDocument();
  });

  // 原有断言「导航里没有对话中心入口（会话已暂停）」已删除：
  // 会话功能在 4f0704a 恢复，导航入口与 chat/page.tsx 都已回归，
  // 该断言是暂停期的遗留，与当前实现矛盾。
  it('对话中心与任务中心对所有角色可见', () => {
    setRole('MEMBER');
    renderShell();

    expect(screen.getByText(nav.chat)).toBeInTheDocument();
    expect(screen.getByText(nav.tasks)).toBeInTheDocument();
  });
});
