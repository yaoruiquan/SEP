'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSubscriptionQuotas } from '@/lib/api/use-quota';
import { Loader2, Bot } from 'lucide-react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function pct(used: number, total: number) {
  if (total === 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

function barColor(usedPct: number) {
  const rem = 100 - usedPct;
  if (rem <= 20) return 'bg-red-500';
  if (rem <= 40) return 'bg-yellow-400';
  return 'bg-emerald-500';
}

function pctLabel(usedPct: number) {
  const rem = 100 - usedPct;
  if (rem <= 20) return 'text-red-500';
  if (rem <= 40) return 'text-yellow-500';
  return 'text-emerald-600';
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    ACTIVE:    { label: '活跃',   className: 'bg-emerald-100 text-emerald-700' },
    EXHAUSTED: { label: '已用尽', className: 'bg-red-100 text-red-600' },
    EXPIRED:   { label: '已过期', className: 'bg-gray-100 text-gray-500' },
  };
  const c = map[status] || { label: status, className: 'bg-gray-100 text-gray-500' };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}

export function SubscriptionQuotaTab() {
  const { data: quotas, isLoading } = useSubscriptionQuotas();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>硅基员工订阅配额</CardTitle>
        <CardDescription>
          订阅硅基员工时自动分配，优先级次之（Priority 1）
        </CardDescription>
      </CardHeader>
      <CardContent>
        {quotas && quotas.length > 0 ? (
          <div className="space-y-3">
            {quotas.map((quota) => {
              const p = pct(quota.usedTokens, quota.totalTokens);
              return (
                <div
                  key={quota.id}
                  className="flex items-center gap-4 rounded-xl border bg-white p-4 shadow-sm"
                >
                  {/* Icon */}
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                    <Bot className="h-5 w-5 text-emerald-600" />
                  </div>

                  {/* Name + meta + progress */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{quota.employeeName || '硅基员工'}</span>
                      {statusBadge(quota.status)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      订阅 {quota.subscriptionId.slice(0, 12)}… ·{' '}
                      {format(new Date(quota.createdAt), 'yyyy/MM/dd', { locale: zhCN })}
                    </p>
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-muted-foreground">
                          {fmt(quota.usedTokens)} / {fmt(quota.totalTokens)}
                        </span>
                        <span className={`font-semibold ${pctLabel(p)}`}>{100 - p}% 剩余</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-1.5 rounded-full transition-all duration-500 ${barColor(p)}`}
                          style={{ width: `${100 - p}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Remaining */}
                  <div className="shrink-0 text-right">
                    <span className="text-lg font-bold tabular-nums">
                      {fmt(quota.totalTokens - quota.usedTokens)}
                    </span>
                    <p className="text-xs text-muted-foreground">剩余</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-12 text-center text-muted-foreground">
            <Bot className="mx-auto mb-4 h-12 w-12 opacity-40" />
            <p className="font-medium">暂无订阅配额</p>
            <p className="mt-1 text-sm">订阅硅基员工后会自动分配配额</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
