import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TaskHistoryDrawer } from './task-history-drawer';

afterEach(cleanup);

describe('TaskHistoryDrawer', () => {
  it('keeps drawer controls available to assistive technology', () => {
    render(
      <TaskHistoryDrawer
        open
        runs={[]}
        loading={false}
        running={false}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onNew={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '关闭工作记录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建' })).toBeInTheDocument();
  });
});
