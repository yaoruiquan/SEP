'use client';

import { Loader2, ShieldCheck, TrendingDown } from 'lucide-react';
import { formatCny, useComputeOverview } from '@/lib/api/use-compute-credit';
import { cn } from '@/lib/utils';
import { ComputeReserveDialog } from './compute-reserve-dialog';

function Stat({
  icon,
  label,
  value,
  detail,
  tone,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: React.ReactNode;
  tone: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-l border-border/70 px-6 first:border-l-0 first:pl-0 max-md:border-l-0 max-md:border-t max-md:px-0 max-md:pt-4 max-md:first:border-t-0 max-md:first:pt-0">
      <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-md', tone)}>
          {icon}
        </span>
        {label}
      </div>
      <p className="mt-3 text-3xl font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-5 text-fg-muted">{detail}</p>
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

/**
 * 算力横条 —— 本页唯一的余额区，两个数字都是算力口径。
 *
 * 头号数字是**算力余额**，不是企业钱包余额 —— 它是从钱包充值进来的、
 * 只能用于与硅基员工对话的那部分钱，订阅费和员工采购动不了它。
 * 这既是「一笔钱专用于算力」的落点，也让这一页的数字与 `/wallet` 天然不同 ——
 * 会上「两个页面金额不一致」的困惑，根因是过去这里显示的**就是**钱包余额本身。
 *
 * 硅基员工自带的赠送额度不在这里：那是每位员工的属性，在「硅基员工」页看。
 */
export function ComputeBalanceStrip() {
  const { data: overview, isLoading } = useComputeOverview();

  if (isLoading) {
    return (
      <section className="flex justify-center border border-border/70 bg-card py-14">
        <Loader2 className="h-6 w-6 animate-spin text-fg-muted" />
      </section>
    );
  }

  if (!overview) return null;

  const hasReserve = Number(overview.computeReservedCNY) > 0;

  return (
    <section className="border border-border/70 bg-card p-5 md:p-6">
      <div className="grid gap-5 md:grid-cols-2">
        <Stat
          icon={<ShieldCheck className="h-4 w-4 text-emerald-600" />}
          label="算力余额"
          value={formatCny(overview.computeReservedCNY)}
          tone="bg-emerald-100"
          detail={
            hasReserve
              ? '只能用于与硅基员工对话，订阅与员工采购不可挪用'
              : '还没有充值算力 —— 对话当前直接扣企业钱包，可能被订阅费占用'
          }
        >
          <ComputeReserveDialog direction="RESERVE" max={overview.walletSpendableCNY} />
          {hasReserve && (
            <ComputeReserveDialog
              direction="RELEASE"
              max={overview.computeReservedCNY}
            />
          )}
        </Stat>

        <Stat
          icon={<TrendingDown className="h-4 w-4 text-sky-600" />}
          label="本月算力消费"
          value={formatCny(overview.monthConsumeCNY)}
          detail={`今日 ${formatCny(overview.todayConsumeCNY)}`}
          tone="bg-sky-100"
        />
      </div>
    </section>
  );
}
