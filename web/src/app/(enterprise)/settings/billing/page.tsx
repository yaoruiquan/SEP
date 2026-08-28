'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useRouter } from 'next/navigation';
import {
  useComputeStats,
  useComputeTransactions,
  type ComputeTransaction,
  type TransactionListParams,
} from '@/features/compute/use-compute';
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Wallet,
  PlusCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 人民币金额格式化。
 *
 * 后端返回的就是「元」—— 不要再除以 100。这里曾按「微单位」处理并把余额
 * 缩小 100 倍展示，统一人民币口径后该假设不成立。
 * 单条对话成本常低于 1 分，所以小额保留 4 位小数，否则明细全是 ¥0.00。
 */
function fmtCny(n: number | string) {
  const num = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(num)) return '¥0.00';
  const abs = Math.abs(num);
  return `¥${abs > 0 && abs < 0.01 ? num.toFixed(4) : num.toFixed(2)}`;
}

function txBadge(type: ComputeTransaction['type']) {
  switch (type) {
    case 'RECHARGE':
      return <Badge variant="glass-success">充值</Badge>;
    case 'CONSUME':
      return <Badge variant="glass-danger">消耗</Badge>;
    case 'REFUND':
      return <Badge variant="glass-info">退款</Badge>;
  }
}

function txSign(type: ComputeTransaction['type'], amount: number) {
  const cls =
    type === 'CONSUME'
      ? 'text-red-400'
      : type === 'RECHARGE'
        ? 'text-emerald-400'
        : 'text-blue-400';
  const sign = type === 'CONSUME' ? '-' : '+';
  return (
    <span className={`font-mono font-semibold ${cls}`}>
      {sign}
      {fmtCny(Math.abs(amount))}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  // Filters
  const [typeFilter, setTypeFilter] = useState<TransactionListParams['type'] | ''>('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  const router = useRouter();

  const { data: stats, isLoading: statsLoading } = useComputeStats();
  const {
    data: txData,
    isLoading: txLoading,
    isFetching: txFetching,
  } = useComputeTransactions({
    type: typeFilter || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const totalPages = txData ? Math.ceil(txData.total / PAGE_SIZE) : 1;

  return (
    <div className="space-y-8">
      {/* ── Stats cards ──────────────────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">企业钱包余额</h2>
          </div>
          {/* 充值走真实支付流程；页面内的「模拟充值」对话框已移除 —— 它改的是
              一个不再作为余额读取的旧字段，点了看似成功实则分文未入账 */}
          <Button size="sm" onClick={() => router.push('/payment/recharge')}>
            <PlusCircle className="mr-1.5 h-4 w-4" />
            充值
          </Button>
        </div>

        {statsLoading ? (
          <div className="flex items-center gap-2 py-6 text-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>加载中…</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Balance */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-1">
              <p className="text-xs text-fg-muted uppercase tracking-wide">当前余额</p>
              <p className="text-3xl font-bold tabular-nums text-foreground">
                {stats ? fmtCny(stats.balance) : '—'}
              </p>
              <p className="text-xs text-fg-muted">
                赠送算力余额不含在此，见「算力余额」页
              </p>
            </div>

            {/* Today */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-1">
              <p className="text-xs text-fg-muted uppercase tracking-wide flex items-center gap-1">
                <TrendingDown className="h-3.5 w-3.5" />
                今日消耗
              </p>
              <p className="text-2xl font-semibold tabular-nums text-red-400">
                {stats ? fmtCny(stats.todayConsume) : '—'}
              </p>
            </div>

            {/* Month */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-1">
              <p className="text-xs text-fg-muted uppercase tracking-wide flex items-center gap-1">
                <TrendingUp className="h-3.5 w-3.5" />
                本月消耗
              </p>
              <p className="text-2xl font-semibold tabular-nums text-orange-400">
                {stats ? fmtCny(stats.monthConsume) : '—'}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ── Transaction list ─────────────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold">消费记录</h2>

          {/* Type filter */}
          <div className="flex items-center gap-2">
            <Label htmlFor="type-filter" className="text-xs text-fg-muted whitespace-nowrap">
              类型筛选
            </Label>
            <select
              id="type-filter"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value as any);
                setPage(1);
              }}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">全部</option>
              <option value="RECHARGE">充值</option>
              <option value="CONSUME">消耗</option>
              <option value="REFUND">退款</option>
            </select>
          </div>
        </div>

        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left font-medium text-fg-muted">时间</th>
                <th className="px-4 py-3 text-left font-medium text-fg-muted">类型</th>
                <th className="px-4 py-3 text-left font-medium text-fg-muted">说明</th>
                <th className="px-4 py-3 text-right font-medium text-fg-muted">金额</th>
              </tr>
            </thead>
            <tbody>
              {txLoading || txFetching ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-fg-muted">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : !txData?.transactions.length ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-sm text-fg-muted">
                    暂无记录
                  </td>
                </tr>
              ) : (
                txData.transactions.map((tx, idx) => (
                  <tr
                    key={tx.id}
                    className={`border-b border-border last:border-0 ${
                      idx % 2 === 0 ? '' : 'bg-muted/10'
                    } hover:bg-muted/20`}
                  >
                    <td className="px-4 py-3 text-fg-muted tabular-nums">
                      {format(new Date(tx.createdAt), 'MM-dd HH:mm', { locale: zhCN })}
                    </td>
                    <td className="px-4 py-3">{txBadge(tx.type)}</td>
                    <td className="px-4 py-3 text-foreground max-w-xs truncate">
                      {tx.description ?? (tx.sessionId ? `会话 ${tx.sessionId.slice(0, 8)}…` : '—')}
                    </td>
                    <td className="px-4 py-3 text-right">{txSign(tx.type, tx.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-3">
              <span className="text-xs text-fg-muted">
                共 {txData?.total ?? 0} 条
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs tabular-nums">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
