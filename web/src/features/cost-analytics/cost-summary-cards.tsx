'use client';

import { TrendingUp, TrendingDown, Minus, DollarSign, AlertTriangle, BarChart2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CostSummary } from '@/lib/types';

function BudgetBar({ percent }: { percent: number }) {
  const clamped = Math.min(percent, 100);
  const color =
    clamped >= 100 ? 'bg-red-500' : clamped >= 80 ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-neutral-500 mb-1">
        <span>预算使用率</span>
        <span className={cn(clamped >= 100 ? 'text-red-600 font-semibold' : clamped >= 80 ? 'text-amber-600' : 'text-neutral-600')}>
          {percent.toFixed(1)}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

function ChangeBadge({ percent }: { percent: number }) {
  if (Math.abs(percent) < 0.1) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-neutral-500">
        <Minus className="h-3 w-3" />持平
      </span>
    );
  }
  const up = percent > 0;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs', up ? 'text-red-500' : 'text-emerald-600')}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? '+' : ''}{percent.toFixed(1)}% 环比
    </span>
  );
}

interface Props {
  summary: CostSummary;
}

export function CostSummaryCards({ summary }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {/* 总花费 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-neutral-600">当期总花费</CardTitle>
            <DollarSign className="h-4 w-4 text-neutral-400" />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">¥{summary.totalCost.toFixed(2)}</p>
          {summary.changePercent !== undefined && (
            <div className="mt-1">
              <ChangeBadge percent={summary.changePercent} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 预算情况 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-neutral-600">月度预算</CardTitle>
            {summary.budgetUsagePercent !== null &&
              summary.budgetUsagePercent >= 80 && (
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              )}
          </div>
        </CardHeader>
        <CardContent>
          {summary.budgetCNY !== null ? (
            <>
              <p className="text-2xl font-bold">¥{summary.budgetCNY.toFixed(2)}</p>
              <p className="text-xs text-neutral-500 mt-0.5">
                已用 ¥{summary.totalCost.toFixed(2)}
              </p>
              {summary.budgetUsagePercent !== null && (
                <BudgetBar percent={summary.budgetUsagePercent} />
              )}
            </>
          ) : (
            <p className="text-sm text-neutral-400">未设置预算</p>
          )}
        </CardContent>
      </Card>

      {/* 环比花费 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-neutral-600">上期花费</CardTitle>
            <BarChart2 className="h-4 w-4 text-neutral-400" />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">
            ¥{(summary.comparisonPeriodCost ?? 0).toFixed(2)}
          </p>
          <p className="text-xs text-neutral-500 mt-0.5">
            {new Date(summary.periodStart).toLocaleDateString('zh-CN', {
              month: 'short',
              day: 'numeric',
            })}{' '}
            —{' '}
            {new Date(summary.periodEnd).toLocaleDateString('zh-CN', {
              month: 'short',
              day: 'numeric',
            })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
