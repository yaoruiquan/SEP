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
}

export function NavItem({ href, label, icon: Icon, exact }: NavLink) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/');

  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary-subtle text-primary'
          : 'text-fg-muted hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  );
}
