'use client';

import { useState } from 'react';
import Image from 'next/image';
import { LayoutDashboard, ShieldCheck, Users, Settings, Building2, LogOut, Wallet, ChevronLeft, ChevronRight, Megaphone } from 'lucide-react';
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

interface NavGroup {
  title?: string;
  links: NavLink[];
}

/**
 * 运营端导航。分组对齐企业端（企业端是 6 组，这边 4 组），不再是一列平铺。
 *
 * 这一版删掉了三个入口：
 *   · 「审核中心」—— 员工审核在员工管理已有完整闭环（待审核 tab + 详情页通过/驳回），
 *     能力审核并入能力管理；它调的还是只改 status 的错端点，审投稿会把数据改坏
 *   · 「能力审核」—— 本身不做决定，只是个跳转列表，两个队列的计数移到能力管理页头
 *   · 「模型管理」—— 与「系统设置 → 模型管理」是同一套 hook 的两份实现
 *
 * 「投稿审核」`/admin/contributions` 和「版本审核」`/admin/skills` 刻意不进导航：
 * 它们是能力管理的下钻队列，从能力管理页头的待办徽章进，避免侧栏再堆两个审核入口。
 */
const NAV_GROUPS: NavGroup[] = [
  {
    links: [
      { href: '/admin', label: '仪表盘', icon: LayoutDashboard, exact: true },
    ],
  },
  {
    title: '内容',
    links: [
      { href: '/admin/employees', label: '硅基员工', icon: Users },
      { href: '/admin/capabilities', label: '硅基能力', icon: ShieldCheck },
    ],
  },
  {
    title: '运营对象',
    links: [
      { href: '/admin/enterprises', label: '企业', icon: Building2 },
      // 与「企业」并列而不是合并：企业页是租户名册（一行一家），
      // 这页是全平台资金账本（跨企业筛选 + 导出 + 平台合计），两个altitude
      { href: '/admin/compute', label: '资金流水', icon: Wallet },
    ],
  },
  {
    title: '平台',
    links: [
      { href: '/admin/announcements', label: '公告', icon: Megaphone },
      { href: '/admin/settings', label: '系统设置', icon: Settings },
    ],
  },
];

/**
 * 顶栏面包屑映射。运营端路由都在 /admin 下，故 'admin' 段自己不出现在面包屑里
 * （由 rootLabel 承担），其余段从 NAV_GROUPS 推导 + 补上不在导航里的下钻路由。
 */
const CRUMBS: CrumbMap = {
  ...Object.fromEntries(
    NAV_GROUPS.flatMap((g) =>
      g.links.map((l) => [l.href.replace(/^\/admin\/?/, ''), l.label] as const),
    ).filter(([seg]) => seg !== ''),
  ),
  // 能力管理的两个下钻队列
  contributions: '投稿审核',
  skills: '版本审核',
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

        <nav className="flex-1 overflow-y-auto scroll-thin px-3 py-4">
          {NAV_GROUPS.map((group, i) => (
            <div key={group.title ?? `g${i}`} className="mb-1">
              {group.title && !collapsed && (
                <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-gtext-muted">
                  {group.title}
                </p>
              )}
              <div className="space-y-0.5">
                {group.links.map((link) => (
                  <NavItem key={link.href} {...link} collapsed={collapsed} />
                ))}
              </div>
              {i < NAV_GROUPS.length - 1 && (
                <div className="my-3 border-t border-glassline" />
              )}
            </div>
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
