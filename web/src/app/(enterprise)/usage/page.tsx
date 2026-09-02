'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { ArrowRight, Receipt, TrendingUp, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { useComputeStats, useTopConsumers } from '@/features/compute/use-compute';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { cn } from '@/lib/utils';

/**
 * 用量分析。
 *
 * 只回答一个问题：**花出去的钱在员工 / 时间上怎么分布**。
 * 「还剩多少算力」去 `/compute-quota`，「钱包里还有多少钱」去 `/wallet`。
 *
 * 逐笔账单曾在这里有第二张表（与算力余额页的那张同源、列也一样），
 * 已收敛到算力余额页，这里只留一个跳转入口。
 */
export default function UsagePage() {
  const router = useRouter();
  const { data: stats, isLoading } = useComputeStats();
  const { data: topConsumers } = useTopConsumers(5);

  const trendData = stats?.trendData ?? [];

  /** 图表自己的总量，作为「这张图的尺度」，不是第二个权威的「本月消费」。 */
  const trendTotal = useMemo(
    () => trendData.reduce((sum, d) => sum + Number(d.amount ?? 0), 0),
    [trendData],
  );

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center py-12">
        <div className="text-neutral-600">加载中...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* 页头 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">用量分析</h1>
          <p className="mt-1 text-sm text-neutral-600">按部门 / 员工 / 模型看花费分布</p>
        </div>
        <Button variant="outline" onClick={() => router.push('/wallet')}>
          <Wallet className="w-4 h-4 mr-2" />
          前往钱包
        </Button>
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
            <div className="flex items-center justify-between">
              <CardTitle>算力消费趋势（最近30天）</CardTitle>
              <span className="text-sm text-neutral-500 tabular-nums">
                合计 ¥{trendTotal.toFixed(2)}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="colorCompute" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }}
                  tickFormatter={(v) => format(new Date(v), 'MM/dd')} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(v) => [`¥${Number(v ?? 0).toFixed(2)}`, '算力消费']}
                  labelFormatter={(l) => format(new Date(String(l)), 'yyyy-MM-dd', { locale: zhCN })}
                />
                <Area type="monotone" dataKey="amount" stroke="#f97316" strokeWidth={2}
                  fillOpacity={1} fill="url(#colorCompute)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* 逐笔账单只有一处 —— 在算力余额页 */}
      <Link
        href="/compute-quota#usage-records"
        className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-3 transition-colors hover:bg-neutral-50"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-neutral-900">
          <Receipt className="h-4 w-4 text-neutral-500" />
          查看逐笔算力消费明细
        </span>
        <span className="flex items-center gap-1 text-xs text-neutral-500">
          在「算力余额」页，可按员工 / 成员 / 日期筛选并导出 CSV
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </Link>
    </div>
  );
}
