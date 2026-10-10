import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  VersionTimelinePanel: () => <div>版本面板</div>,
}));
vi.mock('@/features/capability-iteration/personal-changes-panel', () => ({
  PersonalChangesPanel: () => <div>副本面板</div>,
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
  expect(container.firstElementChild?.firstElementChild).toHaveClass('mx-auto', 'w-full', 'max-w-4xl');
}

describe('技能库详情页宽度', () => {
  beforeEach(() => {
    useSearchParams.mockReturnValue(new URLSearchParams());
    useVersionTimeline.mockReturnValue({
      data: { capability: { id: 'cap-1', name: '用户需求挖掘', description: '简短描述' }, canManage: false },
      isLoading: false,
      isError: false,
    });
  });

  it('加载态也占满可用宽度，避免骨架收缩和加载后的宽度跳变', () => {
    useVersionTimeline.mockReturnValue({ isLoading: true });
    expectFullWidth(renderPage().container);
  });

  it('错误态保留相同宽度和返回入口', () => {
    useVersionTimeline.mockReturnValue({ isError: true, error: new Error('加载失败') });
    expectFullWidth(renderPage().container);
    expect(screen.getByRole('link', { name: '返回技能库' })).toHaveAttribute('href', '/capabilities');
    expect(screen.getByText('加载失败')).toBeVisible();
  });

  it.each([false, true])('各标签页不按内容收缩（管理员：%s）', (canManage) => {
    useVersionTimeline.mockReturnValue({
      data: { capability: { id: 'cap-1', name: '用户需求挖掘', description: '简短描述' }, canManage },
    });
    const { container } = renderPage();
    expectFullWidth(container);
    for (const [label, panel] of [
      ['版本', '版本面板'],
      [canManage ? '大家的改动' : '我的提交', '副本面板'],
      ['使用', '使用面板'],
      ['迭代建议', '建议面板'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(screen.getByText(panel)).toBeVisible();
      expectFullWidth(container);
    }
  });

  it('直接打开副本标签时也保持完整宽度', () => {
    useSearchParams.mockReturnValue(new URLSearchParams('tab=changes'));
    expectFullWidth(renderPage().container);
    expect(screen.getByText('副本面板')).toBeVisible();
  });
});
