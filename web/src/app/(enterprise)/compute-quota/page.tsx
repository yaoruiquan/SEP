'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  Gift,
  Loader2,
  ShieldCheck,
  TrendingDown,
  Wallet,
  Zap,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { formatCny, useComputeOverview } from '@/lib/api/use-compute-credit';
import { cn } from '@/lib/utils';
import { LegacyQuotaNotice } from './legacy-quota-notice';
import { SubscriptionCreditList } from './subscription-credit-list';
import { UsageRecordTable } from './usage-record-table';

function BalanceStat({
  icon,
  label,
  value,
  detail,
  tone,
  emphasis,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: string;
  emphasis?: boolean;
}) {
  return (
    <div className="border-l border-border/70 px-5 first:border-l-0 first:pl-0 max-md:border-l-0 max-md:border-t max-md:px-0 max-md:pt-4 max-md:first:border-t-0 max-md:first:pt-0">
      <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-md', tone)}>
          {icon}
        </span>
        {label}
      </div>
      <p
        className={cn(
          'mt-3 font-semibold tabular-nums text-foreground',
          emphasis ? 'text-3xl' : 'text-2xl',
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-fg-muted">{detail}</p>
    </div>
  );
}

/**
 * 企业算力中心。
 *
 * 首要口径是人民币余额：先展示企业钱包余额，再展示每个硅基员工的赠送余额。
 * Token 只出现在下方的用量账单里，作为「这笔钱花在哪」的明细。
 *
 * 这里没有「购买算力包」入口 —— 企业充值只进钱包，不再有 Token 商品。
 */
export default function ComputeCenterPage() {
  const { data: overview, isLoading } = useComputeOverview();

  return (
    <div className="space-y-8 pb-10">
      <section className="border-b border-border/70 pb-7">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-medium text-primary">
              <Zap className="h-3.5 w-3.5" />
              企业算力中心
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-foreground">算力余额</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-fg-muted">
              与硅基员工对话时，先消耗该员工的赠送算力余额；赠送余额用完后，从企业钱包余额扣除。
              扣费金额按所用模型的实际人民币成本计算。
            </p>
          </div>
          <Link
            href="/payment/recharge"
            className={cn(buttonVariants({ variant: 'glass-primary', size: 'md' }))}
          >
            <Wallet className="h-4 w-4" />
            充值钱包
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {isLoading ? (
        <div className="flex justify-center py-14">
          <Loader2 className="h-6 w-6 animate-spin text-fg-muted" />
        </div>
      ) : overview ? (
        <section className="border border-border/70 bg-card p-5 md:p-6">
          <div className="flex flex-col gap-2 border-b border-border/70 pb-5 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">可用余额</h2>
              <p className="mt-1 text-sm text-fg-muted">
                赠送余额只能用于对应的硅基员工；企业钱包余额所有员工共用。
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-fg-muted">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              余额不足时对话会被拦下，余额不会为负
            </div>
          </div>
          <div className="mt-5 grid gap-5 md:grid-cols-4">
            <BalanceStat
              emphasis
              icon={<Wallet className="h-4 w-4 text-violet-600" />}
              label="企业钱包余额"
              value={formatCny(overview.walletBalanceCNY)}
              detail="所有员工共用，可随时充值"
              tone="bg-violet-100"
            />
            <BalanceStat
              icon={<Gift className="h-4 w-4 text-emerald-600" />}
              label="赠送算力余额"
              value={formatCny(overview.creditRemainingCNY)}
              detail={`累计赠送 ${formatCny(overview.creditGrantedTotalCNY)}`}
              tone="bg-emerald-100"
            />
            <BalanceStat
              icon={<TrendingDown className="h-4 w-4 text-sky-600" />}
              label="本月消费"
              value={formatCny(overview.monthConsumeCNY)}
              detail={`今日 ${formatCny(overview.todayConsumeCNY)} · ${(
                overview.monthInputTokens + overview.monthOutputTokens
              ).toLocaleString('zh-CN')} tokens`}
              tone="bg-sky-100"
            />
            <BalanceStat
              icon={<ShieldCheck className="h-4 w-4 text-amber-600" />}
              label="合计可用"
              value={formatCny(overview.totalAvailableCNY)}
              detail="钱包 + 全部在用赠送余额"
              tone="bg-amber-100"
            />
          </div>
        </section>
      ) : null}

      <LegacyQuotaNotice />

      <section id="subscription-credits" className="scroll-mt-8">
        <div className="mb-4">
          <div className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Bot className="h-4 w-4 text-emerald-600" />
            硅基员工赠送算力余额
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            每笔赠送只属于对应的硅基员工，赠送余额用完后扣企业钱包。
          </p>
        </div>
        <SubscriptionCreditList />
      </section>

      <section id="usage-records" className="scroll-mt-8">
        <div className="mb-4">
          <div className="flex items-center gap-2 text-base font-semibold text-foreground">
            <TrendingDown className="h-4 w-4 text-sky-600" />
            算力消费明细
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            每次模型调用的人民币成本与扣费来源。Token 是用量明细，不是可购买的余额。
          </p>
        </div>
        <UsageRecordTable />
      </section>
    </div>
  );
}
