import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EnterpriseShell } from './enterprise-shell';
import { useAuthStore } from '@/lib/auth-store';

// next/navigation 在测试环境没有 router 上下文，NavItem 用 usePathname 判高亮
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

// logout 会发请求，这里只关心导航渲染
vi.mock('@/features/auth/use-auth', () => ({
  useLogout: () => ({ mutate: vi.fn() }),
}));

const setRole = (roleInEnterprise: string | null) =>
  useAuthStore.setState({
    token: 't',
    user: { id: 'u1', email: 'a@b.c', name: '测试', role: 'USER' },
    enterprise: { id: 'e1', name: '示例科技' },
    roleInEnterprise,
    hydrated: true,
  });

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

  it('企业管理员能看到「组织」组的部门与成员管理', () => {
    setRole('ENTERPRISE_ADMIN');
    render(<EnterpriseShell>内容</EnterpriseShell>);

    expect(screen.getByText('部门管理')).toBeInTheDocument();
    expect(screen.getByText('成员管理')).toBeInTheDocument();
  });

  it('普通成员看不到部门/成员管理 —— 进去也什么都改不了', () => {
    setRole('MEMBER');
    render(<EnterpriseShell>内容</EnterpriseShell>);

    expect(screen.queryByText('部门管理')).not.toBeInTheDocument();
    expect(screen.queryByText('成员管理')).not.toBeInTheDocument();
  });

  it('DEPT_MANAGER 本版按普通成员对待，同样看不到组织组', () => {
    // 该角色要名副其实需要「数据范围」那一层，后端尚无，
    // 故不给它任何高于 MEMBER 的可见项
    setRole('DEPT_MANAGER');
    render(<EnterpriseShell>内容</EnterpriseShell>);

    expect(screen.queryByText('部门管理')).not.toBeInTheDocument();
  });

  it('所有角色都能看到「我的员工」与用量统计', () => {
    for (const role of ['ENTERPRISE_ADMIN', 'MEMBER', 'DEPT_MANAGER']) {
      setRole(role);
      const { unmount } = render(<EnterpriseShell>内容</EnterpriseShell>);
      expect(screen.getByText('我的员工')).toBeInTheDocument();
      expect(screen.getByText('用量统计')).toBeInTheDocument();
      unmount();
    }
  });

  it('侧边栏显示企业名而非平台名（多租户下确认在哪家企业）', () => {
    setRole('MEMBER');
    render(<EnterpriseShell>内容</EnterpriseShell>);

    expect(screen.getByText('示例科技')).toBeInTheDocument();
  });

  it('「员工实例」仅管理员可见 —— 普通成员进去全是点不动的按钮', () => {
    setRole('ENTERPRISE_ADMIN');
    const { unmount } = render(<EnterpriseShell>内容</EnterpriseShell>);
    expect(screen.getByText('员工实例')).toBeInTheDocument();
    unmount();

    setRole('MEMBER');
    render(<EnterpriseShell>内容</EnterpriseShell>);
    expect(screen.queryByText('员工实例')).not.toBeInTheDocument();
    // 但「我的员工」仍在 —— 这是成员的主页面
    expect(screen.getByText('我的员工')).toBeInTheDocument();
  });

  it('导航里没有对话中心入口（会话已暂停）', () => {
    setRole('ENTERPRISE_ADMIN');
    render(<EnterpriseShell>内容</EnterpriseShell>);

    expect(screen.queryByText('对话中心')).not.toBeInTheDocument();
  });
});
