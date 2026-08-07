'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BarChart2, Search, FileText, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CenteredSpinner } from '@/components/ui/feedback';
import { useKnowledgeAnalytics } from '@/features/knowledge/use-knowledge-test';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface AnalyticsPageProps {
  params: Promise<{ id: string }>;
}

export default function KnowledgeAnalyticsPage({ params }: AnalyticsPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { data, isLoading } = useKnowledgeAnalytics(id, 30);

  if (isLoading) {
    return <CenteredSpinner label="加载分析数据..." />;
  }

  if (!data) {
    return (
      <div className="container mx-auto max-w-5xl p-6">
        <p className="text-gtext-muted">暂无数据</p>
      </div>
    );
  }

  const hitRate =
    data.totalSearches > 0
      ? Math.round(((data.totalSearches - data.zeroHitCount) / data.totalSearches) * 100)
      : 0;

  // 最近日志聚合成柱状图数据（按天）
  const chartData = buildDailyChart(data.recentLogs ?? []);

  return (
    <div className="container mx-auto max-w-5xl p-6">
      {/* 页头 */}
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => router.back()}
          className="mb-4 -ml-2"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          返回
        </Button>
        <div className="flex items-center gap-3">
          <BarChart2 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-gtext-primary">检索分析</h1>
          <Badge variant="glass-info" className="text-xs">近 30 天</Badge>
        </div>
      </div>

      {/* KPI 卡片 */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="总搜索次数" value={data.totalSearches} />
        <KpiCard label="命中率" value={`${hitRate}%`} color={hitRate >= 70 ? 'success' : 'danger'} />
        <KpiCard label="零结果次数" value={data.zeroHitCount} color={data.zeroHitCount > 0 ? 'danger' : 'success'} />
        <KpiCard
          label="平均最高分"
          value={data.averageTopScore != null ? data.averageTopScore.toFixed(2) : '—'}
        />
      </div>

      {/* 搜索趋势图 */}
      {chartData.length > 0 && (
        <Card className="mb-6 p-4">
          <h2 className="mb-4 text-sm font-semibold text-gtext-primary">搜索趋势</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: 'var(--color-gtext-muted)' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--color-gtext-muted)' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--color-glassbg)',
                  border: '1px solid var(--color-glassline)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="count" name="搜索次数" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* 零结果查询 */}
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Search className="h-4 w-4 text-danger" />
            <h2 className="text-sm font-semibold text-gtext-primary">零结果查询</h2>
            <Badge variant="glass-danger" className="ml-auto text-xs">
              {data.zeroHitQueries.length}
            </Badge>
          </div>
          {data.zeroHitQueries.length === 0 ? (
            <p className="py-6 text-center text-xs text-gtext-muted">暂无零结果查询 🎉</p>
          ) : (
            <ul className="space-y-2">
              {data.zeroHitQueries.slice(0, 10).map((q, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-glassline bg-glassbg px-3 py-2 text-xs"
                >
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-danger" />
                  <span className="flex-1 truncate text-gtext-secondary">{q}</span>
                </li>
              ))}
            </ul>
          )}
          {data.zeroHitQueries.length > 10 && (
            <p className="mt-2 text-center text-xs text-gtext-muted">
              还有 {data.zeroHitQueries.length - 10} 条...
            </p>
          )}
        </Card>

        {/* 从未命中的文档 */}
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <FileText className="h-4 w-4 text-gtext-muted" />
            <h2 className="text-sm font-semibold text-gtext-primary">从未被检索到的文档</h2>
            <Badge variant="glass-info" className="ml-auto text-xs">
              {data.neverHitDocuments.length}
            </Badge>
          </div>
          {data.neverHitDocuments.length === 0 ? (
            <p className="py-6 text-center text-xs text-gtext-muted">
              所有文档都被检索过 🎉
            </p>
          ) : (
            <ul className="space-y-2">
              {data.neverHitDocuments.slice(0, 8).map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center gap-2 rounded-lg border border-glassline bg-glassbg px-3 py-2 text-xs"
                >
                  <FileText className="h-3.5 w-3.5 flex-shrink-0 text-gtext-muted" />
                  <span className="flex-1 truncate text-gtext-secondary">
                    {doc.originalName}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.neverHitDocuments.length > 8 && (
            <p className="mt-2 text-center text-xs text-gtext-muted">
              还有 {data.neverHitDocuments.length - 8} 个文档...
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── 辅助组件 & 工具函数 ──────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: 'success' | 'danger';
}) {
  const textColor =
    color === 'success'
      ? 'text-success'
      : color === 'danger'
      ? 'text-danger'
      : 'text-gtext-primary';

  return (
    <Card className="p-4 text-center">
      <p className={`text-2xl font-bold ${textColor}`}>{value}</p>
      <p className="mt-1 text-xs text-gtext-muted">{label}</p>
    </Card>
  );
}

interface LogEntry {
  createdAt: string;
  hitCount: number;
}

function buildDailyChart(logs: LogEntry[]) {
  const map = new Map<string, number>();
  for (const log of logs) {
    const day = log.createdAt.slice(0, 10); // 'YYYY-MM-DD'
    map.set(day, (map.get(day) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14) // 最近 14 天
    .map(([date, count]) => ({ date: date.slice(5), count })); // 去掉年份
}
