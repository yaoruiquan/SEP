'use client';

import Image from 'next/image';
import { LayoutDashboard, ShieldCheck, Users, Settings, Cpu, LogOut } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { NavItem, type NavLink } from './nav-item';
import { useAuthStore } from '@/lib/auth-store';
import { useLogout } from '@/features/auth/use-auth';

const LINKS: NavLink[] = [
  { href: '/admin', label: '仪表盘', icon: LayoutDashboard, exact: true },
  { href: '/admin/capabilities', label: '能力审核', icon: ShieldCheck },
  { href: '/admin/employees', label: '员工管理', icon: Users },
  { href: '/admin/models', label: '可用模型', icon: Cpu },
  { href: '/admin/settings', label: '系统设置', icon: Settings },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();

  return (
    <div className="flex h-screen bg-background">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="flex h-14 items-center gap-2 px-5">
          <Image src="/logo.png" alt="硅基人才平台" width={28} height={28} className="rounded" priority />
          <span className="text-sm font-semibold">管理后台</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {LINKS.map((link) => (
            <NavItem key={link.href} {...link} />
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2 px-1 py-2">
            <Avatar name={user?.name || user?.email || '管理员'} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user?.name || '管理员'}</p>
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

      <main className="flex-1 overflow-y-auto scroll-thin">{children}</main>
    </div>
  );
}
