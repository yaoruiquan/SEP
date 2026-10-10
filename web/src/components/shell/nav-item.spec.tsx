import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShieldCheck } from 'lucide-react';
import { NavItem } from './nav-item';

const { route } = vi.hoisted(() => ({ route: { pathname: '/admin/skills/version-1' } }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

describe('子页面所属导航', () => {
  it('技能监控详情高亮硅基能力', () => {
    render(<NavItem href="/admin/capabilities" label="硅基能力" icon={ShieldCheck} activePaths={['/admin/skills']} />);
    expect(screen.getByRole('link')).toHaveAttribute('aria-current', 'page');
  });
  it('其他路由不误高亮', () => {
    route.pathname = '/admin/skills-other';
    render(<NavItem href="/admin/capabilities" label="硅基能力" icon={ShieldCheck} activePaths={['/admin/skills']} />);
    expect(screen.getByRole('link')).not.toHaveAttribute('aria-current');
  });
});
