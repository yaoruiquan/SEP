'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  collapsed?: boolean;
}

/**
 * 侧栏导航项。
 *
 * 只用语义/玻璃令牌，不写死字面色 —— 两个 shell（企业端 / 运营端）都在
 * `.theme-glass` 作用域内，令牌桥会把颜色解析成深色值。
 *
 * Active 态使用主题令牌：品牌色浅底、左侧标记与强调文字。
 */
export function NavItem({ href, label, icon: Icon, exact, collapsed }: NavLink) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/');

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        'group relative flex items-center overflow-hidden rounded-glass-sm',
        'text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gbrand',
        collapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-2',
        active
          ? 'bg-gbrand/10 text-gbrand-text'
          : 'text-gtext-secondary hover:bg-muted hover:text-gtext-primary',
      )}
    >
      {/* 除颜色外，用边缘标记区分当前入口。 */}
      {active && !collapsed && (
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-gbrand-text"
        />
      )}
      <Icon
        className={cn(
          'h-4 w-4 shrink-0 transition-colors',
          active ? 'text-gbrand-text' : 'text-gtext-muted group-hover:text-gtext-secondary',
        )}
      />
      {!collapsed && label}
    </Link>
  );
}
