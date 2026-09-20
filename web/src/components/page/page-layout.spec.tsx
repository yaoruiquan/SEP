import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FilterBar } from './filter-bar';
import { PageHero } from './page-hero';
import { SectionCard } from './section-card';
import { StatStrip } from './stat-strip';

describe('公共页面组件内容契约', () => {
  it('保留标题、说明及可操作入口', () => {
    render(<PageHero title="工作台" description="今日工作" eyebrow="企业空间" actions={<button>新增任务</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();
    expect(screen.getByText('今日工作')).toBeVisible();
    expect(screen.getByRole('button', { name: '新增任务' })).toBeVisible();
  });

  it('筛选、排序、操作均保留独立可访问入口', () => {
    render(<FilterBar search={<input aria-label="搜索" />} filters={<button>状态</button>} sort={<select aria-label="排序" />} actions={<button>导出</button>} />);
    expect(screen.getByRole('textbox', { name: '搜索' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: '排序' })).toBeVisible();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('统计中的零和长数值不会丢失', () => {
    render(<StatStrip items={[{ label: '待处理', value: 0 }, { label: '累计', value: '123,456,789' }]} />);
    expect(screen.getByText('0')).toBeVisible();
    expect(screen.getByText('123,456,789')).toBeVisible();
  });

  it('区域标题与操作不会改变正文内容', () => {
    render(<SectionCard title="任务" action={<button>查看全部</button>} padded={false}>任务列表</SectionCard>);
    expect(screen.getByRole('heading', { level: 2, name: '任务' })).toBeVisible();
    expect(screen.getByRole('button', { name: '查看全部' })).toBeVisible();
    expect(screen.getByText('任务列表')).toBeVisible();
  });
});
