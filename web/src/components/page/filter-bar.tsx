import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function FilterBar({ search, filters, sort, actions, className }: { search?: ReactNode; filters?: ReactNode; sort?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3', className)}>
      {search && <div className="min-w-0 basis-full sm:flex-1 sm:basis-60">{search}</div>}
      {filters && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{filters}</div>}
      {sort && <div className="max-w-full">{sort}</div>}
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2 sm:ml-auto">{actions}</div>}
    </div>
  );
}
