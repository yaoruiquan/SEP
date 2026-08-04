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
 * Active 态按 PRD §Active 导航项：indigo 浅底 + 左侧 3px 亮条 + 图标文字转
 * `--gbrand-text`（#818cf8，压在画布上 6.25:1 ✅ AA）。
 */
export function NavItem({ href, label, icon: Icon, exact, collapsed }: NavLink) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/');

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        'group relative flex items-center overflow-hidden rounded-glass-sm',
        'text-sm font-medium transition-all duration-200',
        collapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-2',
        active
          ? 'bg-[rgba(129,140,248,0.15)] text-gbrand-text'
          : 'text-gtext-secondary hover:bg-glass-2 hover:text-gtext-primary',
      )}
    >
      {/* 左侧亮条 —— PRD 要求 3px indigo，配 glow 让它在深底上"发光" */}
      {active && !collapsed && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-gbrand-text shadow-[0_0_10px_rgba(129,140,248,0.75)]"
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
