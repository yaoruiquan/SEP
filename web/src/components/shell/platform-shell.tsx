'use client';

import { useState } from 'react';
import Image from 'next/image';
import { LayoutDashboard, ShieldCheck, Users, Settings, Cpu, Building2, CheckSquare, LogOut, Wallet, ChevronLeft, ChevronRight, Megaphone } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { AuroraBackground } from '@/components/ui/aurora-background';
import { ThemeLogo } from '@/components/ui/theme-logo';
import { NavItem, type NavLink } from './nav-item';
import { ShellTopbar, type CrumbMap } from './shell-topbar';
import { useAuthStore } from '@/lib/auth-store';
import { useLogout } from '@/features/auth/use-auth';
import { useTheme } from '@/lib/theme-provider';
import { cn } from '@/lib/utils';

const LINKS: NavLink[] = [
  { href: '/admin', label: '仪表盘', icon: LayoutDashboard, exact: true },
  { href: '/admin/audit', label: '审核中心', icon: CheckSquare },
  { href: '/admin/capability-review', label: '能力审核', icon: CheckSquare },
  { href: '/admin/capabilities', label: '能力管理', icon: ShieldCheck },
  { href: '/admin/employees', label: '员工管理', icon: Users },
  { href: '/admin/enterprises', label: '企业管理', icon: Building2 },
  { href: '/admin/compute', label: '账户管理', icon: Wallet },
  { href: '/admin/announcements', label: '公告管理', icon: Megaphone },
  { href: '/admin/settings', label: '系统设置', icon: Settings },
];

/**
 * 顶栏面包屑映射。运营端路由都在 /admin 下，故 'admin' 段自己不出现在面包屑里
 * （由 rootLabel 承担），其余段从 LINKS 推导 + 补上详情页里的动作段。
 */
const CRUMBS: CrumbMap = {
  ...Object.fromEntries(
    LINKS.map((l) => [l.href.replace(/^\/admin\/?/, ''), l.label] as const).filter(
      ([seg]) => seg !== '',
    ),
  ),
  new: '新建',
  edit: '编辑',
  bindings: '能力绑定',
};

export function PlatformShell({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const { theme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);

  return (
    // 主题 C：运营端数据密集场景，背景克制，2 个 blob。
    // 深色用 aurora-midnight，浅色用 aurora-daylight
    <AuroraBackground blobs={2} className={cn('flex h-screen', theme === 'dark' ? 'aurora-midnight' : 'aurora-daylight')}>
      <aside className={cn(
        'glass-nav flex shrink-0 flex-col transition-all duration-300',
        collapsed ? 'w-16' : 'w-60'
      )}>
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-glassline px-5">
          <div className="flex items-center gap-2 overflow-hidden">
            <ThemeLogo priority />
            {!collapsed && <span className="text-sm font-semibold text-gtext-primary">管理后台</span>}
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="shrink-0 rounded hover:bg-glass-2 p-1"
            aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4 text-gtext-secondary" />
            ) : (
              <ChevronLeft className="h-4 w-4 text-gtext-secondary" />
            )}
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto scroll-thin px-3 py-4">
          {LINKS.map((link) => (
            <NavItem key={link.href} {...link} collapsed={collapsed} />
          ))}
        </nav>

        <div className="shrink-0 border-t border-glassline p-3">
          {!collapsed ? (
            <>
              <div className="mb-2 flex items-center gap-2 rounded-glass-sm border border-glassline bg-glass-2 px-2 py-2.5">
                <Avatar name={user?.name || user?.email || '管理员'} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gtext-primary">{user?.name || '管理员'}</p>
                  <p className="truncate text-xs text-gtext-muted">{user?.email}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-gtext-secondary hover:bg-glass-2 hover:text-gtext-primary"
                onClick={() => logout.mutate()}
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </Button>
            </>
          ) : (
            <button
              onClick={() => logout.mutate()}
              className="flex h-10 w-10 items-center justify-center rounded-glass-sm hover:bg-glass-2 mx-auto"
              title="退出登录"
            >
              <LogOut className="h-5 w-5 text-gtext-secondary" />
            </button>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto scroll-thin">
        <ShellTopbar
          crumbs={CRUMBS}
          rootLabel="管理后台"
          rootHref="/admin"
          skipSegments={['admin']}
          roleLabel="平台运营"
        />
        {children}
      </main>
    </AuroraBackground>
  );
}
