import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHero } from './page-hero';

/**
 * 页面 chrome 组件的内容契约。
 *
 * 只测仍在生产使用的 PageHero —— 同批的 FilterBar / SectionCard / StatStrip
 * 三个组件零生产引用（写了没用），已在 P3.4 死代码清理中删除，对应测试一并移除。
 * 若将来重新引入这类布局组件，按"标题/说明/操作入口不被吞"的同一标准补测。
 */
describe('公共页面组件内容契约', () => {
  it('保留标题、说明及可操作入口', () => {
    render(<PageHero title="工作台" description="今日工作" eyebrow="企业空间" actions={<button>新增任务</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();
    expect(screen.getByText('今日工作')).toBeVisible();
    expect(screen.getByRole('button', { name: '新增任务' })).toBeVisible();
  });
});
