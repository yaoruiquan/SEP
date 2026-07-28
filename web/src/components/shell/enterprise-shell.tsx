'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  LayoutDashboard,
  Users,
  GitBranch,
  MonitorPlay,
  Store,
  CreditCard,
  Settings,
  LogOut,
  Menu,
  X,
  BarChart3,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { NavItem, type NavLink } from './nav-item';
import { useAuthStore } from '@/lib/auth-store';
import { useLogout } from '@/features/auth/use-auth';

interface NavGroup {
  title?: string;
  links: NavLink[];
  /** 仅企业管理员可见；不设则所有角色可见 */
  adminOnly?: boolean;
}

/**
 * 侧边栏分组。
 *
 * 过滤原则：**能看到的页面 = 在那儿至少能做一件事**。
 * 普通成员看不到「组织」组，不是怕他看，而是部门/成员的增删改都要
 * 企业管理员权限，进去除了看树什么都做不了，不如不给入口。
 *
 * ⚠️ 这是体验优化，**不是安全措施** —— roleInEnterprise 存在浏览器里，
 * 用户改得动。真正拦人的是后端的 assertEnterpriseAdmin。
 *
 * 「对话中心」已从导航移除：会话于 2026-07-27 暂停，代码与后端接口保留，
 * 但挂着一个"产品上不做、技术上能用"的入口会让人误判当前范围。
 */
const NAV_GROUPS: NavGroup[] = [
  {
    links: [
      { href: '/dashboard', label: '工作台', icon: LayoutDashboard, exact: true },
    ],
  },
  {
    title: '组织',
    adminOnly: true,
    links: [
      { href: '/departments', label: '部门管理', icon: GitBranch },
      { href: '/members', label: '成员管理', icon: Users },
    ],
  },
  {
    title: '员工',
    links: [
      // 使用者视角：我被授权的实例。普通成员的核心页面
      { href: '/my-employees', label: '我的员工', icon: MonitorPlay },
      { href: '/marketplace', label: '员工市场', icon: Store },
      // 订阅所有人可见（能看到公司订了什么），但改只有管理员能改
      { href: '/subscriptions', label: '我的订阅', icon: CreditCard },
    ],
  },
  {
    title: '账务',
    links: [{ href: '/usage', label: '用量统计', icon: BarChart3 }],
  },
];

export function EnterpriseShell({ children }: { children: React.ReactNode }) {
  const { user, enterprise, roleInEnterprise } = useAuthStore();
  const logout = useLogout();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isAdmin = roleInEnterprise === 'ENTERPRISE_ADMIN';
  const groups = NAV_GROUPS.filter((g) => !g.adminOnly || isAdmin);

  return (
    <div className="flex h-screen bg-background">
      {/* Mobile menu button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-sidebar text-foreground lg:hidden"
        aria-label="Toggle menu"
      >
        {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Backdrop overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed lg:static inset-y-0 left-0 z-40',
          'flex w-60 shrink-0 flex-col border-r border-border bg-sidebar',
          'transition-transform duration-300 lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center gap-2 px-5">
          <Image
            src="/logo.png"
            alt="硅基人才平台"
            width={28}
            height={28}
            className="rounded"
            priority
          />
          {/* 显示企业名而非平台名 —— 多租户下让人一眼确认在哪家企业 */}
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">
            {enterprise?.name ?? '硅基人才平台'}
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto scroll-thin px-3 py-2">
          {groups.map((group, i) => (
            <div key={group.title ?? `g${i}`} className="mb-4">
              {group.title && (
                <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wider text-fg-subtle">
                  {group.title}
                </p>
              )}
              <div className="space-y-0.5">
                {group.links.map((link) => (
                  <div key={link.href} onClick={() => setSidebarOpen(false)}>
                    <NavItem {...link} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2 px-1 py-2">
            <Avatar name={user?.name || user?.email || '用户'} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {user?.name || '用户'}
              </p>
              <p className="truncate text-xs text-fg-subtle">{user?.email}</p>
            </div>
          </div>
          <div onClick={() => setSidebarOpen(false)}>
            <NavItem href="/settings" label="个人设置" icon={Settings} />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-fg-muted"
            onClick={() => logout.mutate()}
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto scroll-thin lg:ml-0">
        {children}
      </main>
    </div>
  );
}
