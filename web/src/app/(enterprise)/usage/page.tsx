'use client';

import { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Wallet, Zap, AlertTriangle, ArrowDownLeft, ArrowUpLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { useComputeUsage } from '@/features/user/use-compute-usage';
import { formatDistanceToNow, format, subDays } from 'date-fns';
import { zhCN } from 'date-fns/locale';

// 根据30天总消费生成每日消费趋势（mock）
function buildTrendData(totalCost: number) {
  const days = 30;
  const dailyAvg = totalCost > 0 ? totalCost / days : 8;
  return Array.from({ length: days }, (_, i) => {
    const d = subDays(new Date(), days - 1 - i);
    const noise = 0.4 + Math.random() * 1.2;
    return {
      date: format(d, 'MM/dd'),
      cost: parseFloat((dailyAvg * noise).toFixed(4)),
    };
  });
}

type BalanceLevel = 'safe' | 'warning' | 'danger';

function getBalanceLevel(balance: number): BalanceLevel {
  if (balance > 100) return 'safe';
  if (balance > 20) return 'warning';
  return 'danger';
}

const LEVEL_STYLE: Record<BalanceLevel, { bar: string; text: string; bg: string; border: string }> = {
  safe:    { bar: 'bg-success',  text: 'text-success',  bg: 'bg-success/10',  border: 'border-success/30' },
  warning: { bar: 'bg-warning',  text: 'text-warning',  bg: 'bg-warning/10',  border: 'border-warning/30' },
  danger:  { bar: 'bg-danger',   text: 'text-danger',   bg: 'bg-danger/10',   border: 'border-danger/30' },
};

export default function UsagePage() {
  const { data, isLoading, error } = useComputeUsage();

  // mock trend：每次数据加载生成一次，totalCost 不变则图形稳定
  const trendData = useMemo(
    () => buildTrendData(data?.totalCost ?? 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.totalCost],
  );

  if (isLoading) return <CenteredSpinner />;

  if (error) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<Wallet className="h-8 w-8" />}
          title="加载失败"
          description={error instanceof Error ? error.message : '无法加载用量数据，请稍后重试。'}
        />
      </div>
    );
  }

  if (!data) return null;

  const level = getBalanceLevel(data.balance);
  const style = LEVEL_STYLE[level];
  const totalTokens = data.totalInputTokens + data.totalOutputTokens;
  // 余额条：以 ¥500 为满档，超过则直接满
  const barPct = Math.min(100, (data.balance / 500) * 100);

  const noUsageYet =
    data.totalInputTokens === 0 &&
    data.totalOutputTokens === 0 &&
    data.transactions.length === 0;

  return (
    <div className="p-6 space-y-6">
      {/* 页头 */}
      <div>
        <h1 className="text-xl font-semibold">用量统计</h1>
        <p className="mt-1 text-sm text-fg-muted">本企业的算力余额与消费明细</p>
      </div>

      {/* 余额预警横幅 */}
      {level !== 'safe' && (
        <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${style.bg} ${style.border}`}>
          <AlertTriangle className={`h-5 w-5 shrink-0 ${style.text}`} />
          <div>
            <p className={`text-sm font-medium ${style.text}`}>
              {level === 'danger' ? '余额严重不足，请尽快充值' : '余额偏低，建议及时充值'}
            </p>
            <p className="text-xs text-fg-muted mt-0.5">
              当前余额 ¥{data.balance.toFixed(2)}，不足时员工将无法调用模型。
            </p>
          </div>
        </div>
      )}

      {/* 顶部指标区：余额大卡 + 统计小卡 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 余额大卡 */}
        <Card className="lg:col-span-1">
          <CardContent className="pt-6 pb-5">
            <div className="flex items-center gap-2 text-sm text-fg-muted mb-2">
              <Wallet className="h-4 w-4" />
              账户余额
            </div>
            <div className={`text-4xl font-bold mb-3 ${style.text}`}>
              ¥{data.balance.toFixed(2)}
            </div>
            {/* 余额进度条 */}
            <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${style.bar}`}
                style={{ width: `${barPct}%` }}
              />
            </div>
            <p className="text-xs text-fg-subtle mt-1.5">
              {barPct >= 100 ? '余额充足' : `约为满额（¥500）的 ${barPct.toFixed(0)}%`}
            </p>
          </CardContent>
        </Card>

        {/* 累计消费 */}
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-fg-muted mb-2">累计消费</div>
            <div className="text-3xl font-bold text-danger">
              ¥{data.totalCost.toFixed(4)}
            </div>
            <p className="text-xs text-fg-subtle mt-2">所有历史消费总和</p>
          </CardContent>
        </Card>

        {/* Token 消耗 */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-1.5 text-sm text-fg-muted mb-2">
              <Zap className="h-4 w-4" />
              Token 消耗
            </div>
            <div className="text-3xl font-bold">
              {totalTokens.toLocaleString()}
            </div>
            <div className="flex gap-3 text-xs text-fg-subtle mt-2">
              <span>输入 {data.totalInputTokens.toLocaleString()}</span>
              <span>输出 {data.totalOutputTokens.toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 无数据提示 */}
      {noUsageYet && (
        <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3">
          <p className="text-sm font-medium">尚无用量数据</p>
          <p className="mt-1 text-sm text-fg-muted">
            当前员工在本地运行，模型调用不经过平台，故平台暂不计量算力——
            下面的数字表示「还没有可计量的消费」，不是统计异常。
          </p>
        </div>
      )}

      {/* 近30天消费趋势 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">近 30 天消费趋势</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                interval={4}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `¥${v}`}
              />
              <Tooltip
                formatter={(v) => [`¥${Number(v).toFixed(4)}`, '消费']}
                labelStyle={{ fontSize: 12 }}
                contentStyle={{ fontSize: 12 }}
              />
              <Area
                type="monotone"
                dataKey="cost"
                stroke="#6366f1"
                strokeWidth={2}
                fill="url(#costGrad)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
          <p className="text-xs text-fg-subtle mt-2 text-center">
            * 趋势图为示意数据，实际接入后将显示真实每日消费
          </p>
        </CardContent>
      </Card>

      {/* 交易明细 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">交易明细</CardTitle>
        </CardHeader>
        <CardContent>
          {data.transactions.length === 0 ? (
            <p className="py-8 text-center text-sm text-fg-muted">
              暂无交易记录——产生算力消费后会在此逐条列出
            </p>
          ) : (
            <div className="divide-y divide-border">
              {data.transactions.map((tx) => {
                const isExpense = tx.amount < 0;
                return (
                  <div key={tx.id} className="flex items-center gap-3 py-3">
                    {/* 图标 */}
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      isExpense ? 'bg-danger/10' : 'bg-success/10'
                    }`}>
                      {isExpense
                        ? <ArrowDownLeft className="h-4 w-4 text-danger" />
                        : <ArrowUpLeft className="h-4 w-4 text-success" />}
                    </div>

                    {/* 描述 */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {tx.description || (isExpense ? '算力消费' : '账户充值')}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-fg-subtle">
                          {formatDistanceToNow(new Date(tx.createdAt), {
                            addSuffix: true,
                            locale: zhCN,
                          })}
                        </span>
                        {tx.metadata?.inputTokens && (
                          <Badge className="text-xs bg-muted text-fg-muted px-1.5 py-0">
                            {(tx.metadata.inputTokens + (tx.metadata.outputTokens ?? 0)).toLocaleString()} tokens
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* 金额 */}
                    <div className={`text-sm font-semibold tabular-nums ${
                      isExpense ? 'text-danger' : 'text-success'
                    }`}>
                      {isExpense ? '' : '+'}¥{tx.amount.toFixed(4)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
