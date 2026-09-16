import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function FilterBar({ search, filters, sort, actions, className }: { search?: ReactNode; filters?: ReactNode; sort?: ReactNode; actions?: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-sm', className)}><div className="min-w-[240px] flex-1">{search}</div>{filters && <div className="flex shrink-0 items-center gap-2 overflow-x-auto">{filters}</div>}{sort && <div className="shrink-0">{sort}</div>}{actions && <div className="ml-auto shrink-0">{actions}</div>}</div>;
}
