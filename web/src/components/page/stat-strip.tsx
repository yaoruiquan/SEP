import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatStripItem = { label: string; value: string | number; icon?: ReactNode; tone?: 'brand' | 'success' | 'warning' | 'info' };
const tones = {
  brand: 'bg-gbrand/10 text-gbrand-text',
  success: 'bg-gsuccess/10 text-gsuccess',
  warning: 'bg-gwarning/10 text-gwarning',
  info: 'bg-ginfo/10 text-ginfo',
};

export function StatStrip({ items, className }: { items: StatStripItem[]; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3', className)}>
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          {item.icon && <div aria-hidden className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tones[item.tone ?? 'brand'])}>{item.icon}</div>}
          <div className="min-w-0">
            <p className="text-xs text-fg-muted">{item.label}</p>
            <p className="mt-1 break-words text-xl font-semibold tracking-tight tabular-nums text-foreground">{item.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
