'use client';

import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Cpu,
  Gauge,
  MessageSquareText,
  Users,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useDashboard } from '@/features/dashboard/use-dashboard';
import type { ModelDistribution, TokenTrend, TopMember } from '@/features/dashboard/dashboard-api';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { StatCard3D } from '@/components/ui/stat-card-3d';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/feedback';
import { useAuthStore } from '@/lib/auth-store';
import { PageFrame } from '@/components/page/page-frame';
import { PageHero } from '@/components/page/page-hero';
import {
  CHART_GRID,
  CHART_AXIS_TICK,
  CHART_TOOLTIP_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_LEGEND_STYLE,
  useChartPalette,
  useChartSeries,
} from '@/lib/chart-theme';

const numberFormatter = new Intl.NumberFormat('zh-CN');

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
  const palette = useChartPalette();
  const totalRequests = data.reduce((sum, item) => sum + item.requests, 0);
  const totalCost = data.reduce((sum, item) => sum + item.cost, 0);
  const chartData = data.slice(0, 6).map((item, index) => ({
    ...item,
    displayName: formatModelName(item.model),
    color: palette[index % palette.length],
    percentage: totalRequests > 0 ? ((item.requests / totalRequests) * 100).toFixed(1) : '0',
  }));

  if (!chartData.length) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-fg-muted">
        暂无模型调用数据
      </div>
    );
  }

  // 单模型时退化为文本行：单段甜甜圈会画出一个带白色分割缝的整环，看起来像坏图。
  if (chartData.length === 1) {
    const only = chartData[0];
    return (
      <div className="flex h-[300px] flex-col items-center justify-center gap-3 text-center">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl"
          style={{ backgroundColor: `${only.color}1a` }}
        >
          <Cpu className="h-8 w-8" style={{ color: only.color }} />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{only.displayName}</p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {numberFormatter.format(only.requests)} 次
          </p>
          <p className="mt-1 text-xs text-fg-muted">总成本 {formatCost(only.cost)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid items-center gap-6 lg:grid-cols-2">
      {/* 左侧: 渐变圆环图 */}
      <div className="relative flex items-center justify-center">
        <div className="h-[240px] w-[240px]">
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
                stroke="var(--card)"
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
                contentStyle={CHART_TOOLTIP_STYLE}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* 中心文字 */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold text-foreground">
            {formatCompactNumber(totalRequests)}
          </span>
          <span className="mt-1 text-sm text-fg-muted">总请求</span>
          <span className="mt-2 text-xs text-fg-subtle">
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
                <span className="text-sm font-medium text-foreground">
                  {model.displayName}
                </span>
              </div>
              <span className="text-sm font-semibold text-primary">
                {formatCost(model.cost)}
              </span>
            </div>

            {/* 请求次数进度条 - 使用自定义颜色 */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-fg-muted">
                <span>{numberFormatter.format(model.requests)} 次请求</span>
                <span>{model.percentage}%</span>
              </div>
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
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
  const series = useChartSeries();
  const chartData = data.map((item) => ({ ...item, label: formatDate(item.date) }));
  if (!chartData.length)
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-fg-muted">
        暂无 Token 使用数据
      </div>
    );

  return (
    <div className="h-[260px] min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="inputTokens" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={series.blue} stopOpacity={0.3} />
              <stop offset="95%" stopColor={series.blue} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="outputTokens" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={series.teal} stopOpacity={0.25} />
              <stop offset="95%" stopColor={series.teal} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ ...CHART_AXIS_TICK, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={20}
          />
          <YAxis
            tick={{ ...CHART_AXIS_TICK, fontSize: 11 }}
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
            contentStyle={CHART_TOOLTIP_STYLE}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
          />
          <Legend
            iconType="circle"
            wrapperStyle={CHART_LEGEND_STYLE}
            formatter={(value) => (value === 'input' ? 'Input' : 'Output')}
          />
          <Area
            type="monotone"
            dataKey="input"
            stroke={series.blue}
            strokeWidth={2.5}
            fill="url(#inputTokens)"
            dot={{ r: 3, fill: 'var(--card)', strokeWidth: 2 }}
            activeDot={{ r: 5 }}
          />
          <Area
            type="monotone"
            dataKey="output"
            stroke={series.teal}
            strokeWidth={2.5}
            fill="url(#outputTokens)"
            dot={{ r: 3, fill: 'var(--card)', strokeWidth: 2 }}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function MemberUsageList({ data }: { data: TopMember[] }) {
  if (!data.length)
    return (
      <div className="flex min-h-[180px] items-center justify-center text-sm text-fg-muted">
        暂无成员消费数据
      </div>
    );

  return (
    <div className="space-y-3">
      {data.slice(0, 5).map((member) => {
        const avgCallsPerWeek = Math.round(member.calls / 4);

        return (
          <div
            key={member.id}
            className="flex items-center justify-between rounded-lg border border-border p-4 transition-colors hover:bg-muted/40"
          >
            <div className="flex items-center gap-3">
              <Avatar name={member.name} src={member.avatar} className="h-10 w-10" />

              <div>
                <div className="font-medium text-foreground">{member.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-sm text-fg-muted">
                  <span>{member.calls} 次调用</span>
                  <span>·</span>
                  <span>{avgCallsPerWeek} 次/周</span>
                </div>
              </div>
            </div>

            <div className="text-right">
              <div className="text-lg font-semibold text-primary">
                {formatCost(member.cost)}
              </div>
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
      <div className="h-32 animate-pulse rounded-2xl bg-muted" />
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
  const roleInEnterprise = useAuthStore((state) => state.roleInEnterprise);

  if (isLoading) return <DashboardSkeleton />;

  if (isError || !data)
    return (
      <PageFrame>
        <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-border bg-card text-sm text-fg-muted">
          工作台数据加载失败，请稍后重试
        </div>
      </PageFrame>
    );

  const { stats, modelDistribution, tokenTrend, topMembers } = data;
  const isAdmin = data.scope === 'enterprise' || (data.scope == null && roleInEnterprise === 'ENTERPRISE_ADMIN');
  const displayName = user?.name || user?.email?.split('@')[0] || '朋友';

  // 计算趋势百分比。trend 为 null 表示上月基数为 0、无环比基准，显示 "—"。
  const conversationsTrend =
    stats.conversations.trend === null
      ? '—'
      : `${stats.conversations.trend > 0 ? '+' : ''}${stats.conversations.trend}%`;
  const computeTrend =
    stats.computeUsage.trend === null
      ? '—'
      : `${stats.computeUsage.trend > 0 ? '+' : ''}${stats.computeUsage.trend}%`;

  return (
    <PageFrame>
      <PageHero
        title={`${getGreeting()}，${displayName}`}
        description={
          isAdmin
            ? '查看企业整体使用情况，继续推进今天的工作。'
            : '查看我的使用情况，继续推进今天的工作。'
        }
      />

      {/* 统计卡片升级 - 使用 3D Card 组件 */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard3D
          label={isAdmin ? '硅基员工' : '我的可用硅基员工'}
          value={stats.totalEmployees}
          icon={Users}
          description={`${stats.activeEmployees} 个活跃`}
        />
        <StatCard3D
          label="本月对话"
          value={formatCompactNumber(stats.conversations.total)}
          icon={MessageSquareText}
          description="较上月"
          trend={conversationsTrend}
          trendUp={(stats.conversations.trend ?? 0) > 0}
        />
        <StatCard3D
          label={isAdmin ? '碳基员工' : '我的活跃员工'}
          value={isAdmin ? stats.totalMembers : stats.activeEmployees}
          icon={BriefcaseBusiness}
          description={isAdmin ? `${stats.totalDepartments} 个部门` : '近 7 天使用过的员工'}
        />
        <StatCard3D
          label="本月算力"
          value={formatComputeUsage(stats.computeUsage.total)}
          icon={Gauge}
          description="较上月"
          trend={computeTrend}
          trendUp={(stats.computeUsage.trend ?? 0) > 0}
        />
      </div>

      {/* 主要内容区 */}
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.9fr)]">
        {/* 模型使用分析 */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{isAdmin ? '模型使用分析' : '我的模型使用分析'}</CardTitle>
                <CardDescription>
                  {isAdmin ? '最近 30 天各模型的调用次数与成本' : '最近 30 天我的模型调用次数与成本'}
                </CardDescription>
              </div>
              <Link
                href="/usage"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80"
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

        {/* 成员使用情况仅对企业管理员开放，普通成员不能看到企业其他人的消费排行。 */}
        {isAdmin && <Card className="hover:shadow-md transition-shadow">
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
        </Card>}
      </section>

      {/* Token 使用趋势 */}
      {tokenTrend.length > 0 && (
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{isAdmin ? 'Token 使用趋势' : '我的 Token 使用趋势'}</CardTitle>
                <CardDescription>
                  {isAdmin ? '最近 7 天 Input / Output 用量' : '最近 7 天我的 Input / Output 用量'}
                </CardDescription>
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
