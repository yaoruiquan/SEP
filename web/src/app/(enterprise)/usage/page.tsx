'use client';

import { useState, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Wallet, Zap, AlertTriangle, ArrowDownLeft, ArrowUpLeft,
  Plus, Download, ChevronLeft, ChevronRight, RotateCcw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import {
  useComputeAccount,
  useComputeStats,
  useComputeTransactions,
  useCreateRechargeOrder,
  type TransactionListParams,
  type ComputeTransaction,
} from '@/features/compute/use-compute';
import { useCreateRechargeAlipayPayment } from '@/features/order/use-order';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

const TYPE_LABELS: Record<string, string> = {
  RECHARGE: '充值',
  CONSUME: '消费',
  REFUND: '退款',
};

// ── CSV export helper ─────────────────────────────────────────────────────────
function exportCsv(transactions: ComputeTransaction[]) {
  const header = '时间,类型,描述,金额(元)';
  const rows = transactions.map((tx) => [
    format(new Date(tx.createdAt), 'yyyy-MM-dd HH:mm:ss'),
    TYPE_LABELS[tx.type] ?? tx.type,
    `"${(tx.description ?? '').replace(/"/g, '""')}"`,
    (tx.type === 'RECHARGE' ? '' : '-') + (Math.abs(tx.amount) / 100).toFixed(2),
  ].join(','));

  const csv = [header, ...rows].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `算力账单_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Balance alert ─────────────────────────────────────────────────────────────
function BalanceAlert({ balance, onRecharge }: { balance: number; onRecharge: () => void }) {
  // balance 是微单位（× 100），阈值也按微单位判断：10000 = ¥100, 2000 = ¥20
  const level = balance >= 10000 ? 'safe' : balance >= 2000 ? 'warning' : 'danger';
  if (level === 'safe') return null;

  const style =
    level === 'danger'
      ? { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700' }
      : { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700' };

  return (
    <div className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 ${style.bg} ${style.border}`}>
      <div className="flex items-center gap-3">
        <AlertTriangle className={`h-5 w-5 shrink-0 ${style.text}`} />
        <div>
          <p className={`text-sm font-medium ${style.text}`}>
            {level === 'danger' ? '余额严重不足，请尽快充值' : '余额偏低，建议及时充值'}
          </p>
          <p className="text-xs text-neutral-600 mt-0.5">
            当前余额 ¥{(balance / 100).toFixed(2)}，不足时员工将无法调用模型。
          </p>
        </div>
      </div>
      <Button size="sm" onClick={onRecharge}>立即充值</Button>
    </div>
  );
}

// ── Recharge dialog ───────────────────────────────────────────────────────────
function RechargeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const createOrder = useCreateRechargeOrder();
  const createPayment = useCreateRechargeAlipayPayment();

  const handleConfirm = async () => {
    const n = parseFloat(amount);
    if (!n || n <= 0) { toast.error('请输入有效的充值金额'); return; }

    setIsSubmitting(true);
    try {
      // 1. 创建充值订单
      const order = await createOrder.mutateAsync({ amount: n });

      // 2. 创建支付宝支付
      const payment = await createPayment.mutateAsync(order.orderNo);

      // 3. 跳转到支付宝支付页面
      window.location.href = payment.paymentForm;

      // 关闭弹窗（用户会跳转到支付宝页面）
      onClose();
      setAmount('');
    } catch (error) {
      toast.error('创建充值订单失败，请重试');
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>充值算力</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">充值金额（元）</label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="请输入充值金额"
              min="1"
              step="0.01"
            />
          </div>
          <div className="flex gap-2">
            {['100', '500', '1000', '5000'].map((v) => (
              <Button key={v} variant="outline" size="sm" onClick={() => setAmount(v)}>
                ¥{v}
              </Button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting ? '处理中...' : '确认充值'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Transaction type badge ────────────────────────────────────────────────────
function TxTypeBadge({ type }: { type: string }) {
  const cls =
    type === 'RECHARGE'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : type === 'CONSUME'
      ? 'bg-orange-50 text-orange-700 border-orange-200'
      : 'bg-blue-50 text-blue-700 border-blue-200';

  return (
    <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium', cls)}>
      {TYPE_LABELS[type] ?? type}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function UsagePage() {
  const { data: stats, isLoading: statsLoading } = useComputeStats();

  // filter state
  const [filterType, setFilterType] = useState<TransactionListParams['type']>(undefined);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [rechargeOpen, setRechargeOpen] = useState(false);

  const txParams: TransactionListParams = {
    type: filterType,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const { data: txData, isLoading: txLoading } = useComputeTransactions(txParams);

  const totalPages = txData ? Math.ceil(txData.total / PAGE_SIZE) : 1;
  const transactions = txData?.transactions ?? [];

  const resetFilters = useCallback(() => {
    setFilterType(undefined);
    setStartDate('');
    setEndDate('');
    setPage(1);
  }, []);

  const handleExport = () => {
    if (!transactions.length) { toast.error('当前筛选无数据可导出'); return; }
    exportCsv(transactions);
  };

  if (statsLoading) {
    return (
      <div className="p-6 flex items-center justify-center py-12">
        <div className="text-neutral-600">加载中...</div>
      </div>
    );
  }

  const balance = stats?.balance ?? 0;
  // 后端存储的是微单位（× 100），显示时需除以 100
  const fmtAmount = (n: number) => (n / 100).toFixed(2);

  return (
    <div className="p-6 space-y-6">
      {/* 页头 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">算力账户</h1>
          <p className="mt-1 text-sm text-neutral-600">企业算力余额与消费明细</p>
        </div>
        <Button onClick={() => setRechargeOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          充值
        </Button>
      </div>

      {/* 余额预警 */}
      <BalanceAlert balance={balance} onRecharge={() => setRechargeOpen(true)} />

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-600">账户余额</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <Wallet className="w-5 h-5 text-primary" />
              <span className="text-2xl font-bold">¥{fmtAmount(balance)}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-600">今日消费</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <ArrowDownLeft className="w-5 h-5 text-gwarning" />
              <span className="text-2xl font-bold">¥{fmtAmount(stats?.todayConsume ?? 0)}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-600">本月消费</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <Zap className="w-5 h-5 text-gneon-purple" />
              <span className="text-2xl font-bold">¥{fmtAmount(stats?.monthConsume ?? 0)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 消费趋势图 */}
      {(stats?.trendData?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>消费趋势（最近30天）</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={stats!.trendData}>
                <defs>
                  <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }}
                  tickFormatter={(v) => format(new Date(v), 'MM/dd')} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(v) => [`¥${Number(v ?? 0).toFixed(2)}`, '消费金额']}
                  labelFormatter={(l) => format(new Date(String(l)), 'yyyy-MM-dd', { locale: zhCN })}
                />
                <Area type="monotone" dataKey="amount" stroke="#3b82f6" strokeWidth={2}
                  fillOpacity={1} fill="url(#colorAmount)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* 交易记录 */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>交易记录</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {/* 类型筛选 */}
              <div className="flex rounded-md border border-neutral-200 divide-x divide-neutral-200 text-sm overflow-hidden">
                {([undefined, 'RECHARGE', 'CONSUME', 'REFUND'] as const).map((t) => (
                  <button
                    key={t ?? 'all'}
                    onClick={() => { setFilterType(t); setPage(1); }}
                    className={cn(
                      'px-3 py-1.5 transition-colors',
                      filterType === t
                        ? 'bg-primary text-white'
                        : 'bg-white text-neutral-600 hover:bg-neutral-50',
                    )}
                  >
                    {t ? TYPE_LABELS[t] : '全部'}
                  </button>
                ))}
              </div>
              {/* 日期区间 */}
              <Input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                className="h-8 w-36 text-sm"
              />
              <span className="text-neutral-400 text-sm">—</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                className="h-8 w-36 text-sm"
              />
              {/* 重置 */}
              <button
                onClick={resetFilters}
                title="重置筛选"
                className="flex h-8 w-8 items-center justify-center rounded border border-neutral-200 text-neutral-500 hover:bg-neutral-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              {/* 导出 CSV */}
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-3.5 w-3.5 mr-1" />
                导出
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {txLoading ? (
            <div className="text-center py-8 text-neutral-600">加载中...</div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-8 text-neutral-500">暂无交易记录</div>
          ) : (
            <>
              <div className="space-y-2">
                {transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-neutral-50 hover:bg-neutral-100 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn(
                        'w-9 h-9 shrink-0 rounded-full flex items-center justify-center',
                        tx.type === 'RECHARGE'
                          ? 'bg-emerald-50 border border-emerald-200'
                          : tx.type === 'CONSUME'
                          ? 'bg-orange-50 border border-orange-200'
                          : 'bg-blue-50 border border-blue-200',
                      )}>
                        {tx.type === 'RECHARGE' ? (
                          <ArrowUpLeft className="w-4 h-4 text-emerald-600" />
                        ) : tx.type === 'CONSUME' ? (
                          <ArrowDownLeft className="w-4 h-4 text-orange-500" />
                        ) : (
                          <Zap className="w-4 h-4 text-blue-500" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-neutral-900 truncate">
                            {tx.description || '未命名交易'}
                          </p>
                          <TxTypeBadge type={tx.type} />
                        </div>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          {format(new Date(tx.createdAt), 'yyyy-MM-dd HH:mm:ss', { locale: zhCN })}
                        </p>
                      </div>
                    </div>
                    <p className={cn(
                      'text-sm font-semibold shrink-0 ml-4',
                      tx.type === 'RECHARGE' ? 'text-emerald-600' : 'text-orange-500',
                    )}>
                      {tx.type === 'RECHARGE' ? '+' : '-'}¥{fmtAmount(Math.abs(tx.amount))}
                    </p>
                  </div>
                ))}
              </div>

              {/* 分页 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-neutral-100">
                  <p className="text-sm text-neutral-500">
                    共 {txData?.total ?? 0} 条，第 {page}/{totalPages} 页
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline" size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 充值弹窗 */}
      <RechargeDialog open={rechargeOpen} onClose={() => setRechargeOpen(false)} />
    </div>
  );
}
