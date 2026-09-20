import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function SectionCard({ title, description, action, padded = true, children, className }: { title: string; description?: string; action?: ReactNode; padded?: boolean; children: ReactNode; className?: string }) {
  return (
    <section className={cn('overflow-hidden rounded-2xl border border-border bg-card', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <div className="min-w-0 flex-1 basis-48">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-1 text-sm leading-6 text-fg-muted">{description}</p>}
        </div>
        {action && <div className="flex max-w-full flex-wrap items-center gap-2">{action}</div>}
      </div>
      <div className={cn(padded && 'p-5 sm:p-6')}>{children}</div>
    </section>
  );
}
