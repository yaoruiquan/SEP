'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Wallet, Zap, ArrowDownLeft, Download, ChevronLeft, ChevronRight, RotateCcw,
  Users, TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { toast } from '@/components/ui/toast';
import {
  useComputeStats,
  useConsumptionLogs,
  useTopConsumers,
  type ConsumptionLogQuery,
  type ConsumptionLog,
} from '@/features/compute/use-compute';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

const TYPE_LABELS: Record<string, string> = {
  COMPUTE: '算力消费',
  SUBSCRIPTION: '订阅消费',
};

const TYPE_COLORS: Record<string, string> = {
  COMPUTE: 'text-orange-600',
  SUBSCRIPTION: 'text-blue-600',
};

// ── CSV export helper ─────────────────────────────────────────────────────────
function exportCsv(logs: ConsumptionLog[]) {
  const header =
    '时间,类型,硅基员工,碳基员工,详情,输入tokens,输出tokens,赠送扣减(元),钱包扣减(元),欠费(元),合计金额(元)';
  const rows = logs.map((log) => [
    format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss'),
    TYPE_LABELS[log.type] ?? log.type,
    `"${log.employeeName.replace(/"/g, '""')}"`,
    log.memberName ? `"${log.memberName.replace(/"/g, '""')}"` : '-',
    `"${getLogDetailText(log).replace(/"/g, '""')}"`,
    log.detail.inputTokens ?? '-',
    log.detail.outputTokens ?? '-',
    Number(log.detail.creditPaidCNY ?? 0).toFixed(4),
    Number(log.detail.walletPaidCNY ?? 0).toFixed(4),
    Number(log.detail.unpaidCNY ?? 0).toFixed(4),
    '-' + Math.abs(Number(log.amount)).toFixed(4),
  ].join(','));

  const csv = [header, ...rows].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `消费日志_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function getLogDetailText(log: ConsumptionLog): string {
  if (log.type !== 'COMPUTE') {
    return log.detail.planName || '订阅费用';
  }
  // Token 是用量明细，不是余额单位 —— 与金额并列而非替代金额
  const parts = [log.detail.modelName || '对话消费'];
  if (log.detail.inputTokens !== undefined) {
    parts.push(
      `${log.detail.inputTokens.toLocaleString('zh-CN')}+${(log.detail.outputTokens ?? 0).toLocaleString('zh-CN')} tokens`,
    );
  }
  return parts.join(' · ');
}

/** 小额金额保留 4 位小数：单条对话成本常低于 1 分，两位小数会全显示成 ¥0.00。 */
function fmtCny(value: string | number | undefined): string {
  const n = Math.abs(Number(value ?? 0));
  if (!Number.isFinite(n)) return '¥0.00';
  return `¥${n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;
}

/** 这笔钱从哪扣的 —— 用户最常问的问题，直接写在明细行里。 */
function getFundingSourceText(log: ConsumptionLog): string | null {
  if (log.type !== 'COMPUTE') return null;
  const credit = Number(log.detail.creditPaidCNY ?? 0);
  const wallet = Number(log.detail.walletPaidCNY ?? 0);
  const unpaid = Number(log.detail.unpaidCNY ?? 0);

  const parts: string[] = [];
  if (credit > 0) parts.push(`赠送 ${fmtCny(credit)}`);
  if (wallet > 0) parts.push(`钱包 ${fmtCny(wallet)}`);
  if (unpaid > 0) parts.push(`欠费 ${fmtCny(unpaid)}`);
  return parts.length > 0 ? parts.join(' + ') : null;
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function UsagePage() {
  const router = useRouter();
  const { data: stats, isLoading: statsLoading } = useComputeStats();
  const { data: topConsumers } = useTopConsumers(5);

  // filter state
  const [filterType, setFilterType] = useState<ConsumptionLogQuery['type']>(undefined);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);

  const query: ConsumptionLogQuery = {
    type: filterType,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const { data: logsData, isLoading: logsLoading } = useConsumptionLogs(query);

  const totalPages = logsData ? logsData.totalPages : 1;
  const logs = logsData?.logs ?? [];

  const resetFilters = useCallback(() => {
    setFilterType(undefined);
    setStartDate('');
    setEndDate('');
    setPage(1);
  }, []);

  const handleExport = () => {
    if (!logs.length) { toast.error('当前筛选无数据可导出'); return; }
    exportCsv(logs);
  };

  // Prepare dual-line trend data (compute + subscription)
  const trendData = useMemo(() => {
    if (!stats?.trendData) return [];

    // For now, we only have compute data in trendData
    // In production, you'd aggregate both compute and subscription by date
    return stats.trendData.map((d) => ({
      date: d.date,
      compute: d.amount,
      subscription: 0, // TODO: aggregate subscription data
    }));
  }, [stats?.trendData]);

  if (statsLoading) {
    return (
      <div className="p-6 flex items-center justify-center py-12">
        <div className="text-neutral-600">加载中...</div>
      </div>
    );
  }

  const balance = Number(stats?.balance ?? 0);
  const todayConsume = stats?.todayConsume ?? 0;
  const monthConsume = stats?.monthConsume ?? 0;

  return (
    <div className="p-6 space-y-6">
      {/* 页头 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">用量统计</h1>
          <p className="mt-1 text-sm text-neutral-600">企业算力消费与订阅趋势</p>
        </div>
        <Button onClick={() => router.push('/wallet')}>
          <Wallet className="w-4 h-4 mr-2" />
          前往钱包
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-600">今日消费</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <ArrowDownLeft className="w-5 h-5 text-gwarning" />
              <span className="text-2xl font-bold">¥{todayConsume.toFixed(2)}</span>
            </div>
            <p className="text-xs text-neutral-500 mt-1">算力 + 订阅总消费</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-600">本月消费</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <Zap className="w-5 h-5 text-gneon-purple" />
              <span className="text-2xl font-bold">¥{monthConsume.toFixed(2)}</span>
            </div>
            <p className="text-xs text-neutral-500 mt-1">本月累计消费</p>
          </CardContent>
        </Card>
      </div>

      {/* Top 消费者 */}
      {topConsumers && topConsumers.consumers.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                Top 消费硅基员工（最近30天）
              </CardTitle>
              <span className="text-sm text-neutral-500">
                总计 ¥{Number(topConsumers.totalAmount).toFixed(2)}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topConsumers.consumers.map((consumer, idx) => (
                <div key={consumer.employeeId} className="flex items-center gap-3">
                  <span className={cn(
                    'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
                    idx === 0 ? 'bg-yellow-100 text-yellow-700' :
                    idx === 1 ? 'bg-gray-100 text-gray-700' :
                    idx === 2 ? 'bg-orange-100 text-orange-700' :
                    'bg-neutral-50 text-neutral-600',
                  )}>
                    {idx + 1}
                  </span>
                  <Avatar
                    name={consumer.employeeName}
                    src={consumer.employeeAvatar || undefined}
                    className="w-8 h-8"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-900 truncate">
                      {consumer.employeeName}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {consumer.callCount} 次调用
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-neutral-900">
                      ¥{Number(consumer.totalAmount).toFixed(2)}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {consumer.percentage.toFixed(1)}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 消费趋势图 */}
      {trendData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>消费趋势（最近30天）</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="colorCompute" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorSubscription" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }}
                  tickFormatter={(v) => format(new Date(v), 'MM/dd')} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(v, name) => [
                    `¥${Number(v ?? 0).toFixed(2)}`,
                    name === 'compute' ? '算力消费' : '订阅消费'
                  ]}
                  labelFormatter={(l) => format(new Date(String(l)), 'yyyy-MM-dd', { locale: zhCN })}
                />
                <Legend
                  formatter={(value) => value === 'compute' ? '算力消费' : '订阅消费'}
                />
                <Area type="monotone" dataKey="compute" stroke="#f97316" strokeWidth={2}
                  fillOpacity={1} fill="url(#colorCompute)" />
                <Area type="monotone" dataKey="subscription" stroke="#3b82f6" strokeWidth={2}
                  fillOpacity={1} fill="url(#colorSubscription)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* 消费日志 */}
      <Card>
        <CardHeader>
          <CardTitle>消费日志</CardTitle>
        </CardHeader>
        <CardContent>
          {/* 紧凑的筛选栏 */}
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-neutral-200">
            {/* 类型选择器 - pill 风格 */}
            <div className="flex items-center gap-1.5">
              {([undefined, 'COMPUTE', 'SUBSCRIPTION'] as const).map((t) => (
                <button
                  key={t ?? 'all'}
                  onClick={() => { setFilterType(t); setPage(1); }}
                  className={cn(
                    'px-3 py-1 text-xs font-medium rounded-full transition-all',
                    filterType === t
                      ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-sm'
                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200',
                  )}
                >
                  {t ? TYPE_LABELS[t] : '全部'}
                </button>
              ))}
            </div>

            <div className="h-5 w-px bg-neutral-200" />

            {/* 日期区间 - 内联样式 */}
            <div className="flex items-center gap-2 text-sm">
              <Input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                className="h-7 w-32 text-xs border-neutral-300 focus:border-primary"
              />
              <span className="text-neutral-400">—</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                className="h-7 w-32 text-xs border-neutral-300 focus:border-primary"
              />
            </div>

            <div className="flex-1" />

            {/* 操作按钮 */}
            <div className="flex items-center gap-2">
              <button
                onClick={resetFilters}
                className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 transition-colors"
                title="重置筛选"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <Button variant="outline" size="sm" onClick={handleExport} className="h-7 text-xs">
                <Download className="h-3 w-3 mr-1.5" />
                导出
              </Button>
            </div>
          </div>

          {logsLoading ? (
            <div className="text-center py-8 text-neutral-600">加载中...</div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-neutral-500">暂无消费记录</div>
          ) : (
            <>
              <div className="space-y-2">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-neutral-50 hover:bg-neutral-100 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={cn(
                        'w-9 h-9 shrink-0 rounded-full flex items-center justify-center',
                        log.type === 'COMPUTE'
                          ? 'bg-orange-50 border border-orange-200'
                          : 'bg-blue-50 border border-blue-200',
                      )}>
                        {log.type === 'COMPUTE' ? (
                          <Zap className="w-4 h-4 text-orange-500" />
                        ) : (
                          <Users className="w-4 h-4 text-blue-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded', TYPE_COLORS[log.type])}>
                            {TYPE_LABELS[log.type]}
                          </span>
                          <p className="text-sm font-medium text-neutral-900 truncate">
                            {log.employeeName}
                          </p>
                          {log.memberName && (
                            <>
                              <span className="text-neutral-400">→</span>
                              <p className="text-sm text-neutral-600 truncate">{log.memberName}</p>
                            </>
                          )}
                        </div>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          {getLogDetailText(log)} · {format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss', { locale: zhCN })}
                        </p>
                        {getFundingSourceText(log) && (
                          <p className="text-xs text-neutral-400 mt-0.5">
                            扣费来源：{getFundingSourceText(log)}
                          </p>
                        )}
                      </div>
                    </div>
                    <p className={cn(
                      'text-sm font-semibold shrink-0 ml-4',
                      log.type === 'COMPUTE' ? 'text-orange-500' : 'text-blue-500',
                    )}>
                      -{fmtCny(log.amount)}
                    </p>
                  </div>
                ))}
              </div>

              {/* 分页 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-neutral-100">
                  <p className="text-sm text-neutral-500">
                    共 {logsData?.total ?? 0} 条，第 {page}/{totalPages} 页
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
    </div>
  );
}
