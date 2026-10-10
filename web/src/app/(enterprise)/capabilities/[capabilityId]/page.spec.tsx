import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VersionTimeline } from '@/features/capability-iteration/use-capability-iteration';
import { useAuthStore } from '@/lib/auth-store';
import CapabilityIterationDetailPage from './page';

const { useVersionTimeline, useSearchParams } = vi.hoisted(() => ({
  useVersionTimeline: vi.fn(),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ capabilityId: 'cap-1' }),
  useSearchParams,
}));
vi.mock('@/features/capability-iteration/use-capability-iteration', () => ({ useVersionTimeline }));
vi.mock('@/features/capability-iteration/version-timeline-panel', () => ({
  formatDate: (value: string) => value,
  VersionTimelinePanel: ({ releaseId }: { releaseId: string | null }) => <div>版本面板<span>{releaseId}</span></div>,
}));
vi.mock('@/features/capability-iteration/personal-changes-panel', () => ({
  PersonalChangesPanel: ({ initialStatus, initialPage, submissionId }: {
    initialStatus: string | null; initialPage: number; submissionId: string | null;
  }) => <div>提交面板<output aria-label="提交导航状态">{JSON.stringify({ initialStatus, initialPage, submissionId })}</output></div>,
}));
vi.mock('@/features/capability-iteration/usage-panel', () => ({
  UsagePanel: () => <div>使用面板</div>,
}));
vi.mock('@/features/capability-iteration/insights-panel', () => ({
  InsightsPanel: () => <div>建议面板</div>,
}));

function renderPage() {
  // 企业路由的 PageTransition 使用纵向 flex；自动横向 margin 会取消子项拉伸。
  return render(<div className="flex flex-col"><CapabilityIterationDetailPage /></div>);
}

function expectFullWidth(container: HTMLElement) {
  expect(container.firstElementChild?.firstElementChild).toHaveClass('mx-auto', 'w-full', 'max-w-[1120px]');
}

function selectTab(label: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name: label }), { button: 0, ctrlKey: false });
}

function makeTimeline(overrides: Partial<VersionTimeline> = {}): VersionTimeline {
  return {
    capability: { id: 'cap-1', name: '用户需求挖掘', description: '简短描述' },
    canManage: false, subscriptions: [], subscriptionId: '', selectedAt: null,
    currentVersionId: 'release-1', myPersonalVersionId: null, versions: [],
    effectiveVersion: { id: 'release-1', scope: 'ENTERPRISE', version: '1.0.0' },
    effectiveVersionState: 'EXPLICIT', ...overrides,
  };
}

describe('技能库详情页导航与摘要', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/capabilities/cap-1');
    useAuthStore.setState({ user: null, enterprise: null, roleInEnterprise: null });
    useSearchParams.mockReturnValue(new URLSearchParams());
    useVersionTimeline.mockReturnValue({
      data: makeTimeline(),
      isLoading: false,
      isError: false,
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('加载态也占满可用宽度，避免骨架收缩和加载后的宽度跳变', () => {
    useVersionTimeline.mockReturnValue({ isLoading: true });
    expectFullWidth(renderPage().container);
  });

  it('错误态保留相同宽度和返回入口', () => {
    const refetch = vi.fn();
    useVersionTimeline.mockReturnValue({ isError: true, error: new Error('加载失败'), refetch });
    expectFullWidth(renderPage().container);
    expect(screen.getByRole('link', { name: '返回技能库' })).toHaveAttribute('href', '/capabilities');
    expect(screen.getByText('加载失败')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it.each([false, true])('四个标签名称一致且摘要始终位于标签外（管理员：%s）', (canManage) => {
    useVersionTimeline.mockReturnValue({
      data: makeTimeline({ canManage }),
    });
    const { container } = renderPage();
    expectFullWidth(container);
    const summary = screen.getByRole('region', { name: '企业当前启用' });
    const tablist = screen.getByRole('tablist', { name: '技能详情' });
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['发布版本', '提交与审核', '使用统计', '迭代建议']);
    expect(summary.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const [label, panel] of [
      ['发布版本', '版本面板'],
      ['提交与审核', '提交面板'],
      ['使用统计', '使用面板'],
      ['迭代建议', '建议面板'],
    ]) {
      selectTab(label);
      expect(screen.getByText(panel)).toBeVisible();
      expect(screen.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
      expect(within(summary).getByText('企业版 1.0.0')).toBeVisible();
      expect(summary.closest('[role="tabpanel"]')).toBeNull();
      expectFullWidth(container);
    }
  });

  it.each(['pending', 'approved', 'rejected'])('直接打开提交标签恢复%s状态、页码与详情', (status) => {
    useSearchParams.mockReturnValue(new URLSearchParams(`tab=changes&status=${status}&page=3&submission=sub-1&release=release-1`));
    expectFullWidth(renderPage().container);
    expect(screen.getByText('提交面板')).toBeVisible();
    expect(screen.getByLabelText('提交导航状态')).toHaveTextContent(JSON.stringify({ initialStatus: status, initialPage: 3, submissionId: 'sub-1' }));
  });

  it('本地标签切换使用pushState并保留其他查询参数', () => {
    const query = 'tab=changes&status=pending&page=2&submission=sub-1&release=release-1&custom=keep';
    useSearchParams.mockReturnValue(new URLSearchParams(query));
    window.history.replaceState(null, '', `/capabilities/cap-1?${query}`);
    const pushState = vi.spyOn(window.history, 'pushState');
    renderPage();
    selectTab('发布版本');
    expect(screen.getByText('版本面板')).toBeVisible();
    expect(screen.getByText('release-1')).toBeVisible();
    expect(pushState).toHaveBeenCalledExactlyOnceWith(null, '', `/capabilities/cap-1?${query.replace('tab=changes', 'tab=versions')}`);
    selectTab('提交与审核');
    expect(screen.getByLabelText('提交导航状态')).toHaveTextContent(JSON.stringify({ initialStatus: 'pending', initialPage: 2, submissionId: 'sub-1' }));
    expect(window.location.search).toBe(`?${query}`);
  });

  it('浏览器导航的useSearchParams变化恢复标签及子面板参数', () => {
    const { rerender } = renderPage();
    selectTab('使用统计');
    expect(screen.getByText('使用面板')).toBeVisible();
    const pushState = vi.spyOn(window.history, 'pushState');
    useSearchParams.mockReturnValue(new URLSearchParams('tab=changes&status=rejected&page=4&submission=sub-restored'));
    rerender(<div className="flex flex-col"><CapabilityIterationDetailPage /></div>);
    expect(screen.getByRole('tab', { name: '提交与审核' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('提交导航状态')).toHaveTextContent(JSON.stringify({ initialStatus: 'rejected', initialPage: 4, submissionId: 'sub-restored' }));
    useSearchParams.mockReturnValue(new URLSearchParams('tab=versions&release=release-restored'));
    rerender(<div className="flex flex-col"><CapabilityIterationDetailPage /></div>);
    expect(screen.getByRole('tab', { name: '发布版本' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('release-restored')).toBeVisible();
    expect(pushState).not.toHaveBeenCalled();
  });

  it('未知标签回退到发布版本', () => {
    useSearchParams.mockReturnValue(new URLSearchParams('tab=unknown'));
    renderPage();
    expect(screen.getByRole('tab', { name: '发布版本' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('版本面板')).toBeVisible();
  });

  it('MIXED不显示单一启用版本，按员工展示真实有效版本而非跳转使用统计', () => {
    useVersionTimeline.mockReturnValue({ data: makeTimeline({ effectiveVersionState: 'MIXED', subscriptions: [{
      subscriptionId: 'subscription-1', employeeId: 'employee-1', employeeName: '研究助手', currentVersionId: null,
      personalVersionId: null, personalSelectionMode: 'FOLLOW_ENTERPRISE', effectiveVersionId: 'missing-version',
      effectiveVersionScope: 'PLATFORM', enterpriseVersionId: null, canSelectPersonal: false, selectedAt: null,
    }] }) });
    renderPage();
    const summary = screen.getByRole('region', { name: '企业当前启用' });
    expect(within(summary).getByText('未设置统一启用版本')).toBeVisible();
    expect(within(summary).queryByText('企业版 1.0.0')).not.toBeInTheDocument();
    fireEvent.click(within(summary).getByText('按员工查看'));
    expect(within(summary).getByText('研究助手')).toBeVisible();
    expect(within(summary).getByText('版本详情不可查看')).toBeVisible();
    expect(screen.getByRole('tab', { name: '发布版本' })).toHaveAttribute('aria-selected', 'true');
    expect(summary).toBeVisible();
  });

  it('AUTOMATIC显示实际默认版本和自动使用，不误报手动启用时间', () => {
    useVersionTimeline.mockReturnValue({ data: makeTimeline({
      effectiveVersionState: 'AUTOMATIC', currentVersionId: null, selectedAt: '2026-10-09T00:00:00Z',
      effectiveVersion: { id: 'platform-1', scope: 'PLATFORM', version: '2.0.0' },
    }) });
    renderPage();
    const summary = screen.getByRole('region', { name: '企业当前启用' });
    expect(within(summary).getByText('平台版 2.0.0')).toBeVisible();
    expect(within(summary).getByText('自动使用')).toBeVisible();
    expect(within(summary).queryByText(/启用于/)).not.toBeInTheDocument();
    selectTab('迭代建议');
    expect(summary).toBeVisible();
  });
});
