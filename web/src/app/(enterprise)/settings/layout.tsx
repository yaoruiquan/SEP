'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  User,
  Building2,
  Shield,
  Users,
  KeyRound,
  Plug,
  CreditCard,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/settings/profile', label: '个人资料', icon: User },
  { href: '/settings/organization', label: '企业信息', icon: Building2 },
  { href: '/settings/security', label: '安全策略', icon: Shield },
  { href: '/settings/roles', label: '角色权限', icon: Users },
  { href: '/settings/api-keys', label: 'API 密钥', icon: KeyRound },
  { href: '/settings/integrations', label: '集成与 Webhook', icon: Plug },
  { href: '/settings/billing', label: '账单与套餐', icon: CreditCard },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-border bg-sidebar px-3 py-6">
        <p className="mb-4 px-3 text-xs font-semibold uppercase tracking-wider text-fg-muted">
          设置
        </p>
        <nav className="space-y-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-fg-muted hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
