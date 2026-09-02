'use client';

import { formatCnyPrecise, type BreakdownRow } from '@/lib/api/use-compute-credit';
import { cn } from '@/lib/utils';

/**
 * 一个维度的花费分布。
 *
 * 用横条排行而不是饼图：花费分布的问题是「谁最多、差多少」，
 * 排序 + 等宽底槽一眼能比出来；饼图在 5 个以上分片时反而读不出顺序。
 */
export function BreakdownList({
  title,
  subtitle,
  icon,
  rows,
  emptyHint,
  limit = 6,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  rows: BreakdownRow[];
  emptyHint: string;
  limit?: number;
}) {
  const visible = rows.slice(0, limit);
  const rest = rows.length - visible.length;

  return (
    <section className="border border-border/70 bg-card p-5">
      <div className="mb-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {icon}
          {title}
        </div>
        <p className="mt-1 text-xs text-fg-muted">{subtitle}</p>
      </div>

      {visible.length === 0 ? (
        <p className="py-6 text-center text-xs text-fg-muted">{emptyHint}</p>
      ) : (
        <div className="space-y-3">
          {visible.map((row, idx) => (
            <div key={row.key}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold tabular-nums',
                      idx === 0
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-muted text-fg-muted',
                    )}
                  >
                    {idx + 1}
                  </span>
                  <span className="truncate font-medium text-foreground">
                    {row.label}
                  </span>
                  {row.hint && (
                    <span className="shrink-0 text-fg-muted">{row.hint}</span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums text-fg-muted">
                  {formatCnyPrecise(row.costCNY)}
                  <span className="ml-1.5 text-foreground">{row.pct}%</span>
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-1.5 rounded-full bg-sky-500 transition-all duration-500"
                  style={{ width: `${Math.max(1, Math.min(100, row.pct))}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-fg-muted">
                {row.callCount.toLocaleString('zh-CN')} 次调用
              </p>
            </div>
          ))}

          {rest > 0 && (
            <p className="pt-1 text-xs text-fg-muted">另有 {rest} 项未列出</p>
          )}
        </div>
      )}
    </section>
  );
}
