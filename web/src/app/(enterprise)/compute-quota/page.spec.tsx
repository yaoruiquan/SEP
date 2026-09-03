import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ComputeQuotaPage from './page';
import { useAuthStore } from '@/lib/auth-store';

/**
 * 这一页对三种角色开放，但**渲染什么**必须分得干净：
 *
 *   · 企业池、成员额度分配、审计、逐笔账单 —— 这四块读的接口后端对非管理员
 *     一律 403。成员视角必须「不挂载」，而不是挂上再用 CSS 隐藏 ——
 *     否则他一进页面就是四个失败请求，控制台四条红字。
 *   · 「我的算力」（公司给我的额度 + 我的个人余额）两种角色都要有 ——
 *     管理员同样是用的人，个人余额充值入口只在这一块里。
 *
 * 子面板全部换成桩件：这里测的是「按角色挂哪些块」，不是各面板自己的取数。
 */
vi.mock('./compute-balance-strip', () => ({
  ComputeBalanceStrip: () => <div>桩·企业算力池</div>,
}));
vi.mock('./member-allowance-panel', () => ({
  MemberAllowancePanel: () => <div>桩·成员额度分配</div>,
}));
vi.mock('./allowance-audit-panel', () => ({
  AllowanceAuditPanel: () => <div>桩·额度变更审计</div>,
}));
vi.mock('./usage-record-table', () => ({
  UsageRecordTable: () => <div>桩·逐笔账单</div>,
}));
vi.mock('@/features/compute/my-compute-panel', () => ({
  MyComputePanel: () => <div>桩·我的算力</div>,
}));

const ADMIN_ONLY = ['桩·企业算力池', '桩·成员额度分配', '桩·额度变更审计', '桩·逐笔账单'];

const setRole = (roleInEnterprise: string | null) =>
  useAuthStore.setState({
    token: 't',
    user: { id: 'u1', email: '***@***', name: '测试', role: 'USER' },
    enterprise: { id: 'e1', name: '示例科技' },
    roleInEnterprise,
    hydrated: true,
  });

describe('算力余额页按角色分叉', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: null,
      user: null,
      enterprise: null,
      roleInEnterprise: null,
      hydrated: false,
    });
  });

  it('管理员：企业四块 + 他自己的算力都在', () => {
    setRole('ENTERPRISE_ADMIN');
    render(<ComputeQuotaPage />);

    for (const stub of ADMIN_ONLY) {
      expect(screen.getByText(stub)).toBeInTheDocument();
    }
    expect(screen.getByText('桩·我的算力')).toBeInTheDocument();
  });

  it('❗普通成员：只有「我的算力」，企业那四块一块都不挂载', () => {
    setRole('MEMBER');
    render(<ComputeQuotaPage />);

    expect(screen.getByText('桩·我的算力')).toBeInTheDocument();
    for (const stub of ADMIN_ONLY) {
      expect(screen.queryByText(stub)).not.toBeInTheDocument();
    }
  });

  it('DEPT_MANAGER 按普通成员对待 —— 「数据范围」那一层后端还没有', () => {
    setRole('DEPT_MANAGER');
    render(<ComputeQuotaPage />);

    expect(screen.getByText('桩·我的算力')).toBeInTheDocument();
    expect(screen.queryByText('桩·成员额度分配')).not.toBeInTheDocument();
  });

  it('两种角色都带 #my-compute 锚点 —— 对话里「额度用尽」弹窗按它跳回来', () => {
    for (const role of ['ENTERPRISE_ADMIN', 'MEMBER']) {
      setRole(role);
      const { container, unmount } = render(<ComputeQuotaPage />);
      expect(container.querySelector('#my-compute')).not.toBeNull();
      unmount();
    }
  });

  it('成员的底部入口指向用量分析，不指向他看不了的逐笔账单', () => {
    setRole('MEMBER');
    render(<ComputeQuotaPage />);

    expect(screen.getByRole('link', { name: /看我这段时间花在哪/ })).toHaveAttribute(
      'href',
      '/usage',
    );
  });
});
