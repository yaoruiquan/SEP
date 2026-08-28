'use client';

import { Bot, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Card, CardContent } from '@/components/ui/card';
import {
  formatCny,
  useSubscriptionCredits,
  type SubscriptionCreditItem,
} from '@/lib/api/use-compute-credit';

/** 剩余占比。赠送为 0 时按「已用尽」处理，避免 0/0 得出 NaN。 */
function remainingPct(item: SubscriptionCreditItem): number {
  const granted = Number(item.grantedCNY);
  const remaining = Number(item.remainingCNY);
  if (!Number.isFinite(granted) || granted <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((remaining / granted) * 100)));
}

function barColor(pct: number) {
  if (pct <= 20) return 'bg-red-500';
  if (pct <= 40) return 'bg-yellow-400';
  return 'bg-emerald-500';
}

function pctTextColor(pct: number) {
  if (pct <= 20) return 'text-red-500';
  if (pct <= 40) return 'text-yellow-500';
  return 'text-emerald-600';
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: '可用', className: 'bg-emerald-100 text-emerald-700' },
  EXHAUSTED: { label: '已用尽', className: 'bg-red-100 text-red-600' },
  EXPIRED: { label: '已停用', className: 'bg-gray-100 text-gray-500' },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_LABEL[status] ?? {
    label: status,
    className: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}

/**
 * 每个硅基员工的剩余赠送算力余额（元）。
 *
 * 刻意不显示 token 数：赠送额度是一笔人民币，token 消耗量随模型变化，
 * 把两者并列会让用户以为额度是按 token 计的。
 */
export function SubscriptionCreditList() {
  const { data: credits, isLoading } = useSubscriptionCredits();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!credits || credits.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Bot className="mx-auto mb-4 h-12 w-12 opacity-40" />
          <p className="font-medium">暂无赠送算力余额</p>
          <p className="mt-1 text-sm">订阅硅基员工后会自动获得一笔人民币赠送余额</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-5">
        {credits.map((credit) => {
          const pct = remainingPct(credit);
          const isUsable = credit.status === 'ACTIVE';

          return (
            <div
              key={credit.id}
              className="flex items-center gap-4 rounded-xl border bg-white p-4 shadow-sm"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-emerald-100">
                {credit.employeeAvatar ? (
                  <img
                    src={credit.employeeAvatar}
                    alt={credit.employeeName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Bot className="h-5 w-5 text-emerald-600" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{credit.employeeName}</span>
                  <StatusBadge status={credit.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  赠送于{' '}
                  {format(new Date(credit.grantedAt), 'yyyy/MM/dd', {
                    locale: zhCN,
                  })}
                </p>
                <div className="mt-2">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      已用 {formatCny(credit.usedCNY)} / 赠送{' '}
                      {formatCny(credit.grantedCNY)}
                    </span>
                    {isUsable && (
                      <span className={`font-semibold ${pctTextColor(pct)}`}>
                        {pct}% 剩余
                      </span>
                    )}
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-1.5 rounded-full transition-all duration-500 ${
                        isUsable ? barColor(pct) : 'bg-gray-300'
                      }`}
                      style={{ width: `${isUsable ? pct : 0}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <span className="text-lg font-bold tabular-nums">
                  {formatCny(isUsable ? credit.remainingCNY : 0)}
                </span>
                <p className="text-xs text-muted-foreground">剩余赠送</p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
