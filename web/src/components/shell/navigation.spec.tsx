import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Home } from 'lucide-react';
import { NavItem } from './nav-item';
import { ShellTopbar } from './shell-topbar';

const route = vi.hoisted(() => ({ pathname: '/tasks/detail' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('@/components/ui/theme-toggle', () => ({ ThemeToggle: () => <button>主题</button> }));

describe('公共导航', () => {
  it('子路由高亮但相似前缀不误高亮', () => {
    render(<><NavItem href="/tasks" label="任务" icon={Home} /><NavItem href="/task" label="其他" icon={Home} /></>);
    expect(screen.getByRole('link', { name: '任务' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '其他' })).not.toHaveAttribute('aria-current');
  });
  it('折叠入口保留可访问名称', () => {
    render(<NavItem href="/tasks" label="任务" icon={Home} collapsed />);
    expect(screen.getByRole('link', { name: '任务' })).toHaveAttribute('href', '/tasks');
  });
  it('面包屑保留父级链接和当前页标识', () => {
    render(<ShellTopbar rootLabel="工作台" rootHref="/dashboard" crumbs={{ tasks: '任务', detail: '任务详情' }} />);
    expect(screen.getByRole('link', { name: '任务' })).toHaveAttribute('href', '/tasks');
    expect(screen.getByText('任务详情')).toHaveAttribute('aria-current', 'page');
  });
});
