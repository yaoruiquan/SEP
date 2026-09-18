'use client';

import { lazy, Suspense } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Cpu,
  Gauge,
  MessageSquareText,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useDashboard } from '@/features/dashboard/use-dashboard';
import type { ModelDistribution, TokenTrend, TopMember } from '@/features/dashboard/dashboard-api';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/lib/auth-store';
import { PageFrame } from '@/components/page/page-frame';
import { PageHero } from '@/components/page/page-hero';

// 懒加载 recharts 组件以减少初始 bundle 大小
const Area = lazy(() => import('recharts').then(m => ({ default: m.Area })));
const AreaChart = lazy(() => import('recharts').then(m => ({ default: m.AreaChart })));
const CartesianGrid = lazy(() => import('recharts').then(m => ({ default: m.CartesianGrid })));
const Cell = lazy(() => import('recharts').then(m => ({ default: m.Cell })));
const Legend = lazy(() => import('recharts').then(m => ({ default: m.Legend })));
const Pie = lazy(() => import('recharts').then(m => ({ default: m.Pie })));
const PieChart = lazy(() => import('recharts').then(m => ({ default: m.PieChart })));
const ResponsiveContainer = lazy(() => import('recharts').then(m => ({ default: m.ResponsiveContainer })));
const Tooltip = lazy(() => import('recharts').then(m => ({ default: m.Tooltip })));
const XAxis = lazy(() => import('recharts').then(m => ({ default: m.XAxis })));
const YAxis = lazy(() => import('recharts').then(m => ({ default: m.YAxis })));
// 移除 GRADIENT_COLORS 导入,使用原来的 MODEL_COLORS

const numberFormatter = new Intl.NumberFormat('zh-CN');

// 使用原来的配色方案 (蓝紫色系,更专业)
const MODEL_COLORS = ['#6366f1', '#2563eb', '#14b8a6', '#f59e0b', '#818cf8', '#94a3b8'];

const MODEL_LABELS: Record<string, string> = {
  'gemini-3.5-flash-high': 'Gemini 3.5 Flash High',
  'gemini-3.5-flash': 'Gemini 3.5 Flash',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-4o': 'GPT-4o',
  'deepseek-chat': 'DeepSeek Chat',
  'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet',
};

function formatCompactNumber(value: number) {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)} 亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万`;
  return numberFormatter.format(value);
}

function formatComputeUsage(value: number) {
  if (value >= 100000000) return `${(value / 100000000).toFixed(2)} 亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(2)} 万`;
  return value.toFixed(2);
}

function formatCost(value: number) {
  if (value > 0 && value < 0.01) return `¥${value.toFixed(4)}`;
  return `¥${value.toFixed(2)}`;
}

function getGreeting(date: Date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function formatDate(value: string) {
  const parts = value.split('-');
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : value;
}

function formatModelName(model: string) {
  return MODEL_LABELS[model] ?? model;
}

function ModelDistributionChart({ data }: { data: ModelDistribution[] }) {
  const totalRequests = data.reduce((sum, item) => sum + item.requests, 0);
  const totalCost = data.reduce((sum, item) => sum + item.cost, 0);
  const chartData = data.slice(0, 6).map((item, index) => ({
    ...item,
    displayName: formatModelName(item.model),
    color: MODEL_COLORS[index % MODEL_COLORS.length],
    percentage: totalRequests > 0 ? ((item.requests / totalRequests) * 100).toFixed(1) : '0',
  }));

  if (!chartData.length) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-gray-500">
        暂无模型调用数据
      </div>
    );
  }

  return (
    <div className="grid items-center gap-6 lg:grid-cols-2">
      {/* 左侧: 渐变圆环图 */}
      <div className="relative flex items-center justify-center">
        <div className="h-[240px] w-[240px]">
          <Suspense fallback={<div className="h-full w-full animate-pulse rounded-full bg-muted" />}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
              <Pie
                data={chartData}
                dataKey="requests"
                nameKey="displayName"
                cx="50%"
                cy="50%"
                innerRadius={70}
                outerRadius={100}
                paddingAngle={2}
                stroke="white"
                strokeWidth={2}
              >
                {chartData.map((entry) => (
                  <Cell key={entry.model} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => [
                  `${numberFormatter.format(Number(value))} 次`,
                  '请求',
                ]}
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'var(--card)',
                  color: 'var(--foreground)',
                  boxShadow: 'var(--shadow-md)',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          </Suspense>
        </div>

        {/* 中心文字 */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold text-gray-900">
            {formatCompactNumber(totalRequests)}
          </span>
          <span className="mt-1 text-sm text-gray-500">总请求</span>
          <span className="mt-2 text-xs text-gray-400">
            总成本 {formatCost(totalCost)}
          </span>
        </div>
      </div>

      {/* 右侧: 优化后的列表 */}
      <div className="space-y-4">
        {chartData.map((model) => (
          <div key={model.model} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: model.color }}
                />
                <span className="text-sm font-medium text-gray-900">
                  {model.displayName}
                </span>
              </div>
              <span className="text-sm font-semibold text-brand-600">
                {formatCost(model.cost)}
              </span>
            </div>

            {/* 请求次数进度条 - 使用自定义颜色 */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-500">
                <span>{numberFormatter.format(model.requests)} 次请求</span>
                <span>{model.percentage}%</span>
              </div>
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${model.percentage}%`,
                    backgroundColor: model.color,
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TokenTrendChart({ data }: { data: TokenTrend[] }) {
  const chartData = data.map((item) => ({ ...item, label: formatDate(item.date) }));
  if (!chartData.length)
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-gray-500">
        暂无 Token 使用数据
      </div>
    );

  return (
    <div className="h-[260px] min-w-0">
      <Suspense fallback={<div className="h-full w-full animate-pulse rounded-lg bg-muted" />}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="inputTokens" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="outputTokens" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--fg-muted)' }}
            tickLine={false}
            axisLine={false}
            minTickGap={20}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--fg-muted)' }}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(value) => formatCompactNumber(Number(value))}
            width={64}
          />
          <Tooltip
            formatter={(value, name) => [
              formatCompactNumber(Number(value)),
              name === 'input' ? 'Input' : 'Output',
            ]}
            labelFormatter={(label) => `日期 ${label}`}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--foreground)',
              boxShadow: 'var(--shadow-md)',
            }}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 12, color: 'var(--fg-muted)' }}
            formatter={(value) => (value === 'input' ? 'Input' : 'Output')}
          />
          <Area
            type="monotone"
            dataKey="input"
            stroke="#3b82f6"
            strokeWidth={2.5}
            fill="url(#inputTokens)"
            dot={{ r: 3, fill: '#fff', strokeWidth: 2 }}
            activeDot={{ r: 5 }}
          />
          <Area
            type="monotone"
            dataKey="output"
            stroke="#14b8a6"
            strokeWidth={2.5}
            fill="url(#outputTokens)"
            dot={{ r: 3, fill: '#fff', strokeWidth: 2 }}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
      </Suspense>
    </div>
  );
}

function MemberUsageList({ data }: { data: TopMember[] }) {
  if (!data.length)
    return (
      <div className="flex min-h-[180px] items-center justify-center text-sm text-gray-500">
        暂无成员消费数据
      </div>
    );

  return (
    <div className="space-y-3">
      {data.slice(0, 5).map((member, index) => {
        // 模拟周同比数据 (实际应从后端获取)
        const mockTrend = index === 0 ? -12 : index === 1 ? 8 : index === 2 ? -5 : 0;
        const avgCallsPerWeek = Math.round(member.calls / 4);

        return (
          <div
            key={member.id}
            className="flex items-center justify-between rounded-lg border border-gray-200 p-4 transition-colors hover:bg-gray-50"
          >
            <div className="flex items-center gap-3">
              <Avatar name={member.name} src={member.avatar} className="h-10 w-10" />

              <div>
                <div className="font-medium text-gray-900">{member.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-sm text-gray-500">
                  <span>{member.calls} 次调用</span>
                  <span>·</span>
                  <span>{avgCallsPerWeek} 次/周</span>
                </div>
              </div>
            </div>

            <div className="text-right">
              <div className="text-lg font-semibold text-brand-600">
                {formatCost(member.cost)}
              </div>
              {mockTrend !== 0 && (
                <div className="mt-0.5 flex items-center justify-end gap-1 text-xs">
                  <span className="text-gray-500">较上周</span>
                  <span
                    className={cn(
                      'flex items-center font-medium',
                      mockTrend > 0 ? 'text-error' : 'text-success'
                    )}
                  >
                    {mockTrend > 0 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {Math.abs(mockTrend)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <PageFrame>
      <div className="h-32 animate-pulse rounded-2xl bg-gray-200" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <Skeleton key={item} className="h-32" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.9fr)]">
        <Skeleton className="h-[400px]" />
        <Skeleton className="h-[400px]" />
      </div>
      <Skeleton className="h-[360px]" />
    </PageFrame>
  );
}

export default function DashboardPage() {
  const { data, isLoading, isError } = useDashboard();
  const user = useAuthStore((state) => state.user);

  if (isLoading) return <DashboardSkeleton />;

  if (isError || !data)
    return (
      <PageFrame>
        <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">
          工作台数据加载失败，请稍后重试
        </div>
      </PageFrame>
    );

  const { stats, modelDistribution, tokenTrend, topMembers } = data;
  const displayName = user?.name || user?.email?.split('@')[0] || '朋友';

  // 计算趋势百分比
  const conversationsTrend = stats.conversations.trend
    ? `${stats.conversations.trend > 0 ? '+' : ''}${stats.conversations.trend}%`
    : undefined;
  const computeTrend = stats.computeUsage.trend
    ? `${stats.computeUsage.trend > 0 ? '+' : ''}${stats.computeUsage.trend}%`
    : undefined;

  return (
    <PageFrame>
      <PageHero
        title={`${getGreeting()}，${displayName}`}
        description="查看团队使用情况，继续推进今天的工作。"
      />

      {/* 统计卡片升级 - 使用新的 StatCard 组件 */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="硅基员工"
          value={stats.totalEmployees}
          icon={Users}
          description={`${stats.activeEmployees} 个活跃`}
          trend="+3 本周"
          trendUp={true}
        />
        <StatCard
          label="本月对话"
          value={formatCompactNumber(stats.conversations.total)}
          icon={MessageSquareText}
          description="较上月"
          trend={conversationsTrend}
          trendUp={stats.conversations.trend > 0}
        />
        <StatCard
          label="碳基员工"
          value={stats.totalMembers}
          icon={BriefcaseBusiness}
          description={`${stats.totalDepartments} 个部门`}
        />
        <StatCard
          label="本月算力"
          value={formatComputeUsage(stats.computeUsage.total)}
          icon={Gauge}
          description="较上月"
          trend={computeTrend}
          trendUp={stats.computeUsage.trend > 0}
        />
      </div>

      {/* 主要内容区 */}
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.9fr)]">
        {/* 模型使用分析 */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>模型使用分析</CardTitle>
                <CardDescription>最近 30 天各模型的调用次数与成本</CardDescription>
              </div>
              <Link
                href="/usage"
                className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                查看完整报告
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <ModelDistributionChart data={modelDistribution} />
          </CardContent>
        </Card>

        {/* 成员使用情况 */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>成员使用情况</CardTitle>
                <CardDescription>按最近消费金额排序</CardDescription>
              </div>
              <Button variant="ghost" size="sm">
                <Link href="/usage" className="flex items-center gap-1">
                  查看全部
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <MemberUsageList data={topMembers} />
          </CardContent>
        </Card>
      </section>

      {/* Token 使用趋势 */}
      {tokenTrend.length > 0 && (
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Token 使用趋势</CardTitle>
                <CardDescription>最近 7 天 Input / Output 用量</CardDescription>
              </div>
              <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
                <Cpu className="h-4 w-4" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <TokenTrendChart data={tokenTrend} />
          </CardContent>
        </Card>
      )}
    </PageFrame>
  );
}
