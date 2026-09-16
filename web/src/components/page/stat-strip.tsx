import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatStripItem = { label: string; value: string | number; icon?: ReactNode; tone?: 'brand' | 'success' | 'warning' | 'info' };
const tones = {
  brand: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300',
  success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/35 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300',
  info: 'bg-blue-50 text-blue-600 dark:bg-blue-950/35 dark:text-blue-300',
};

export function StatStrip({ items, className }: { items: StatStripItem[]; className?: string }) {
  return <div className={cn('flex gap-3 overflow-x-auto pb-1', className)}>{items.map((item) => <div key={item.label} className="flex min-w-[164px] flex-1 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm"><div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tones[item.tone ?? 'brand'])}>{item.icon}</div><div className="min-w-0"><p className="text-xs text-fg-muted">{item.label}</p><p className="mt-0.5 truncate text-xl font-semibold tabular-nums text-foreground">{item.value}</p></div></div>)}</div>;
}
