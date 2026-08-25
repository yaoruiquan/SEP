'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Sparkles,
  Store,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { AuroraBackground } from '@/components/ui/aurora-background';
import { ThemeLogo } from '@/components/ui/theme-logo';
import { useAuthStore } from '@/lib/auth-store';
import { useLogout } from '@/features/auth/use-auth';
import { cn } from '@/lib/utils';
import { NavItem } from './nav-item';
import { ShellTopbar, type CrumbMap } from './shell-topbar';

const CRUMBS: CrumbMap = {
  contributions: '能力贡献中心',
};

/**
 * 无企业归属用户的贡献工作台。
 *
 * 贡献接口本身允许所有注册用户创建个人能力，不能因为其他企业页面需要
 * 企业归属，就把这个入口一起放进企业布局。企业用户不会使用这个壳，
 * 由 ContributionRouteShell 继续复用完整的 EnterpriseShell。
 */
export function ContributorShell({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const logout = useLogout();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <AuroraBackground blobs={2} className="flex h-screen">
      <aside
        className={cn(
          'glass-nav flex shrink-0 flex-col transition-all duration-300',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-glassline px-5">
          <div className="flex items-center gap-2 overflow-hidden">
            <ThemeLogo priority />
            {!collapsed && (
              <span className="truncate text-sm font-semibold text-gtext-primary">
                个人工作台
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="shrink-0 rounded p-1 hover:bg-glass-2"
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
          <NavItem
            href="/contributions"
            label="能力贡献中心"
            icon={Sparkles}
            exact
            collapsed={collapsed}
          />
          <div className="my-3 border-t border-glassline" />
          <NavItem
            href="/marketplace"
            label="硅基人才市场"
            icon={Store}
            collapsed={collapsed}
          />
          <NavItem
            href="/no-enterprise"
            label="企业归属"
            icon={LayoutDashboard}
            collapsed={collapsed}
          />
        </nav>

        <div className="shrink-0 border-t border-glassline p-3">
          {!collapsed ? (
            <>
              <div className="mb-2 flex items-center gap-2 rounded-glass-sm border border-glassline bg-glass-2 px-2 py-2.5">
                <Avatar name={user?.name || user?.email || '贡献者'} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gtext-primary">
                    {user?.name || '贡献者'}
                  </p>
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
              type="button"
              onClick={() => logout.mutate()}
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-glass-sm hover:bg-glass-2"
              title="退出登录"
            >
              <LogOut className="h-5 w-5 text-gtext-secondary" />
            </button>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <ShellTopbar
          crumbs={CRUMBS}
          rootLabel="个人工作台"
          rootHref="/contributions"
          roleLabel="能力贡献者"
        >
          <Link
            href="/marketplace"
            className="hidden shrink-0 items-center gap-1.5 rounded-glass-sm border border-glassline bg-glass-2 px-3 py-1.5 text-xs font-medium text-gtext-secondary transition-colors hover:text-gtext-primary sm:inline-flex"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            浏览市场
          </Link>
        </ShellTopbar>
        <div className="min-h-0 flex-1">{children}</div>
      </main>
    </AuroraBackground>
  );
}
