'use client';

import { useState } from 'react';
import Image from 'next/image';
import { LayoutDashboard, MessagesSquare, Store, CreditCard, Settings, LogOut, Menu, X, BarChart3 } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { NavItem, type NavLink } from './nav-item';
import { useAuthStore } from '@/lib/auth-store';
import { useLogout } from '@/features/auth/use-auth';

const LINKS: NavLink[] = [
  { href: '/dashboard', label: '工作台', icon: LayoutDashboard, exact: true },
  { href: '/chat', label: '对话中心', icon: MessagesSquare },
  { href: '/marketplace', label: '员工广场', icon: Store },
  { href: '/subscriptions', label: '我的订阅', icon: CreditCard },
  { href: '/usage', label: '用量统计', icon: BarChart3 },
  { href: '/settings', label: '个人设置', icon: Settings },
];

export function UserShell({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-40
        flex w-60 shrink-0 flex-col border-r border-border bg-sidebar
        transition-transform duration-300 lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex h-14 items-center gap-2 px-5">
          <Image src="/logo.png" alt="硅基人才平台" width={28} height={28} className="rounded" priority />
          <span className="text-sm font-semibold">硅基人才平台</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {LINKS.map((link) => (
            <div key={link.href} onClick={() => setSidebarOpen(false)}>
              <NavItem {...link} />
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2 px-1 py-2">
            <Avatar name={user?.name || user?.email || '用户'} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user?.name || '用户'}</p>
              <p className="truncate text-xs text-fg-subtle">{user?.email}</p>
            </div>
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

      <main className="flex-1 overflow-y-auto scroll-thin lg:ml-0">{children}</main>
    </div>
  );
}
