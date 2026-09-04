import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import UsagePage from './page';
import { useAuthStore } from '@/lib/auth-store';
import type { BreakdownRow, UsageBreakdown } from '@/lib/api/use-compute-credit';

/**
 * 用量分析对两种角色是**两份口径**：管理员看全公司，成员只看自己。
 *
 * 后端已经按调用者身份定死了作用域（成员的 byDepartment / byMember 是空数组），
 * 这一页要做对的是：那两块**不渲染**。照渲染出来会是两张
 * 「这个区间还没有部门产生花费」的空卡片 —— 成员会以为全公司这个月没人花钱，
 * 而真相是他没有权限看。
 */
const row = (label: string): BreakdownRow => ({
  key: label,
  label,
  costCNY: '10.0000',
  callCount: 2,
  pct: 50,
});

const BREAKDOWN: UsageBreakdown = {
  rangeDays: 30,
  totalCNY: '20.0000',
  prevTotalCNY: '10.0000',
  deltaPct: 100,
  callCount: 4,
  inputTokens: 100,
  outputTokens: 200,
  // 趋势留空：折线用 recharts，jsdom 里量不到容器尺寸，与本用例无关
  trend: [],
  byModel: [row('gpt-4o')],
  byDepartment: [row('技术部')],
  byMember: [row('张三')],
  byEmployee: [row('小助手')],
};

vi.mock('@/lib/api/use-compute-credit', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/api/use-compute-credit')
  >('@/lib/api/use-compute-credit');
  return {
    ...actual,
    // 只替掉取数，金额格式化仍用真实实现（口径也是被测内容的一部分）
    useUsageBreakdown: () => ({ data: BREAKDOWN, isLoading: false }),
  };
});

const setRole = (roleInEnterprise: string | null) =>
  useAuthStore.setState({
    token: 't',
    user: { id: 'u1', email: '***@***', name: '测试', role: 'USER' },
    enterprise: { id: 'e1', name: '示例科技' },
    roleInEnterprise,
    hydrated: true,
  });

describe('用量分析按角色显示维度', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: null,
      user: null,
      enterprise: null,
      roleInEnterprise: null,
      hydrated: false,
    });
  });

  it('管理员：四个维度都在', () => {
    setRole('ENTERPRISE_ADMIN');
    render(<UsagePage />);

    for (const title of ['按模型', '按部门', '按碳基员工', '按硅基员工']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it('❗普通成员：没有「按部门 / 按碳基员工」，自己的两个维度照给', () => {
    setRole('MEMBER');
    render(<UsagePage />);

    expect(screen.queryByText('按部门')).not.toBeInTheDocument();
    expect(screen.queryByText('按碳基员工')).not.toBeInTheDocument();
    expect(screen.getByText('按模型')).toBeInTheDocument();
    expect(screen.getByText('按硅基员工')).toBeInTheDocument();
  });

  it('DEPT_MANAGER 按普通成员对待', () => {
    setRole('DEPT_MANAGER');
    render(<UsagePage />);

    expect(screen.queryByText('按部门')).not.toBeInTheDocument();
  });

  it('汇总数字说清是谁的钱 —— 成员那栏写「我」', () => {
    setRole('MEMBER');
    const { unmount } = render(<UsagePage />);
    expect(screen.getByText(/^我近 30 天算力花费$/)).toBeInTheDocument();
    unmount();

    setRole('ENTERPRISE_ADMIN');
    render(<UsagePage />);
    expect(screen.getByText(/^近 30 天算力花费$/)).toBeInTheDocument();
  });

  it('底部入口分角色：管理员去逐笔账单，成员去自己的额度', () => {
    setRole('ENTERPRISE_ADMIN');
    const { unmount } = render(<UsagePage />);
    expect(
      screen.getByRole('link', { name: /查看逐笔算力消费明细/ }),
    ).toHaveAttribute('href', '/compute-quota#usage-records');
    unmount();

    setRole('MEMBER');
    render(<UsagePage />);
    // 成员点逐笔账单只会看到一屏 403，所以这条入口对他必须换成别的去处
    expect(
      screen.queryByRole('link', { name: /查看逐笔算力消费明细/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /看公司给我的额度还剩多少/ }),
    ).toHaveAttribute('href', '/compute-quota#my-compute');
  });
});
