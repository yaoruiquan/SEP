'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Bot, Users, Wallet, Zap, UserPlus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { MetricCard } from '@/components/dashboard/metric-card';
import { useDashboardStats, useEnterpriseInfo } from '@/features/enterprise/use-enterprise';
import { OnboardingModal } from '@/features/onboarding/onboarding-modal';
import { SubscriptionExpiryBanner } from '@/components/subscription-expiry-banner';
import {
  CHART_GRID,
  CHART_AXIS_TICK,
  CHART_AXIS_LINE,
  CHART_TOOLTIP_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_CURSOR_FILL,
} from '@/lib/chart-theme';
import { employee as employeeCopy } from '@/locales/zh-CN';

// 模型分布饼图颜色
const MODEL_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

// 生成模拟的模型分布数据
function generateModelDistribution() {
  return [
    { name: 'claude-opus-5', value: 1074, requests: 1074, tokens: '119.46M', cost: 161.38 },
    { name: 'gpt-5.6-sol', value: 835, requests: 835, tokens: '55.37M', cost: 79.35 },
    { name: 'gpt-5.6-terra', value: 16, requests: 16, tokens: '640.98K', cost: 0.43 },
    { name: 'gpt-5.4-mini', value: 51, requests: 51, tokens: '366.24K', cost: 0.29 },
  ];
}

// 生成模拟的 Token 使用趋势（最近24小时）
function generateTokenTrend() {
  const data = [];
  const now = new Date();
  for (let i = 24; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 60 * 60 * 1000);
    const hour = time.getHours();
    data.push({
      time: `${time.getMonth() + 1}-${String(time.getDate()).padStart(2, '0')} ${String(hour).padStart(2, '0')}:00`,
      input: Math.random() * 5000 + 2000,
      output: Math.random() * 15000 + 8000,
      cacheCreation: Math.random() * 3000 + 1000,
      cacheRead: Math.random() * 2000,
      cacheHitRate: Math.random() * 30 + 70,
    });
  }
  return data;
}

// 生成最近使用数据 - 基于真实的成员活动
function generateTopMembersUsageFromStats(
  recentActivities: Array<{ actor: string; time: string }>,
  spendTrend: Array<{ date: string; amount: number }>
) {
  if (recentActivities.length === 0 || spendTrend.length === 0) {
    return [];
  }

  // 统计每个成员的活动次数
  const memberCounts = new Map<string, number>();
  recentActivities.forEach(activity => {
    const actor = activity.actor || '未知成员';
    memberCounts.set(actor, (memberCounts.get(actor) || 0) + 1);
  });

  // 取前3名活跃成员
  const top3Members = Array.from(memberCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  if (top3Members.length === 0) {
    return [];
  }

  // 为每个日期生成每个成员的使用量
  return spendTrend.map(({ date, amount }) => {
    const data: any = { date };

    top3Members.forEach((memberName, index) => {
      // 根据成员的活动次数占比，分配消费金额，并添加一些随机波动
      const memberCount = memberCounts.get(memberName) || 0;
      const totalCounts = Array.from(memberCounts.values()).reduce((sum, c) => sum + c, 0);
      const baseAmount = (memberCount / totalCounts) * amount;
      const randomFactor = 0.8 + Math.random() * 0.4; // 0.8-1.2 的随机系数
      data[memberName] = Math.max(0, baseAmount * randomFactor);
    });

    return data;
  });
}

export default function DashboardPage() {
  const { data: stats, isLoading, error } = useDashboardStats();
  const { data: enterprise } = useEnterpriseInfo();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [modelTab, setModelTab] = useState('chart');

  const modelData = generateModelDistribution();
  const tokenTrend = generateTokenTrend();
  const topUsage = stats ? generateTopMembersUsageFromStats(stats.recentActivities, stats.spendTrend) : [];

  useEffect(() => {
    if (enterprise && !enterprise.metadata?.onboardingCompleted) {
      setShowOnboarding(true);
    }
  }, [enterprise]);

  if (isLoading) {
    return (
      <div className="min-h-full">
        <div className="mx-auto max-w-7xl space-y-6 p-6">
          <div className="mb-8 space-y-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-5 w-48" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
          </div>
          <Skeleton className="h-96 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <EmptyState title="加载失败" description="无法加载 Dashboard 数据，请稍后重试。" />
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="min-h-full">
      {showOnboarding && <OnboardingModal onClose={() => setShowOnboarding(false)} />}

      <div className="mx-auto max-w-7xl space-y-6 p-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gtext-primary">工作台</h1>
          <p className="mt-1 text-sm text-gtext-secondary">
            欢迎回来，{enterprise?.name || '管理员'}
          </p>
        </div>

        <SubscriptionExpiryBanner />

        {/* 关键指标卡片 */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            variant="glass"
            title={employeeCopy.entity}
            value={stats.employeeCount}
            icon={Bot}
            trend={{ direction: 'up', value: 20, label: '较上月' }}
          />
          <MetricCard
            variant="glass"
            title="碳基员工"
            value={stats.memberCount}
            icon={Users}
            trend={{ direction: 'up', value: 15, label: '较上月' }}
          />
          <MetricCard
            variant="glass"
            title="本月消费"
            value={`¥${stats.monthlySpend.toFixed(2)}`}
            icon={Wallet}
            trend={{ direction: 'down', value: 8, label: '较上月' }}
          />
          <MetricCard
            variant="glass"
            title="本月调用"
            value={stats.callCount}
            icon={Zap}
            trend={{ direction: 'up', value: 35, label: '较上月' }}
          />
        </div>

        {/* 第一行：模型分布 + Token使用趋势 */}
        <div className="grid gap-4 lg:grid-cols-2 items-stretch">
          {/* 模型分布 */}
          <Card className="glass-card-interactive h-full flex flex-col">
            <CardHeader>
              <CardTitle className="text-base font-semibold">模型分布</CardTitle>
            </CardHeader>
            <CardContent className="flex-1">
              <Tabs value={modelTab} onValueChange={setModelTab} className="w-full h-full flex flex-col">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="chart">模型分布</TabsTrigger>
                  <TabsTrigger value="table">用户消费榜</TabsTrigger>
                </TabsList>
                <TabsContent value="chart" className="space-y-4">
                  <div className="flex items-center justify-center">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={modelData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={90}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {modelData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={MODEL_COLORS[index % MODEL_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2">
                    <div className="grid grid-cols-4 gap-2 text-xs font-medium text-gtext-muted">
                      <div>模型</div>
                      <div className="text-right">请求</div>
                      <div className="text-right">Token</div>
                      <div className="text-right">成本</div>
                    </div>
                    {modelData.map((model, i) => (
                      <div key={model.name} className="grid grid-cols-4 gap-2 text-sm">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-3 w-3 rounded-sm"
                            style={{ backgroundColor: MODEL_COLORS[i] }}
                          />
                          <span className="text-gtext-primary">{model.name}</span>
                        </div>
                        <div className="text-right text-gtext-secondary">{model.requests}</div>
                        <div className="text-right text-gtext-secondary">{model.tokens}</div>
                        <div className="text-right font-medium text-gtext-primary">
                          ${model.cost.toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                </TabsContent>
                <TabsContent value="table">
                  <div className="py-8 text-center text-sm text-gtext-muted">
                    用户消费榜功能开发中...
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Token 使用趋势 */}
          <Card className="glass-card-interactive h-full flex flex-col">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Token 使用趋势</CardTitle>
            </CardHeader>
            <CardContent className="flex-1">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={tokenTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis
                    dataKey="time"
                    tick={{ ...CHART_AXIS_TICK, fontSize: 10 }}
                    stroke={CHART_AXIS_LINE}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ ...CHART_AXIS_TICK, fontSize: 11 }}
                    stroke={CHART_AXIS_LINE}
                    tickFormatter={(value) => `${(value / 1000).toFixed(0)}K`}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ ...CHART_AXIS_TICK, fontSize: 11 }}
                    stroke={CHART_AXIS_LINE}
                    tickFormatter={(value) => `${value.toFixed(0)}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      ...CHART_TOOLTIP_STYLE,
                      borderRadius: '8px',
                      border: '1px solid rgba(139, 92, 246, 0.2)',
                    }}
                    formatter={(value, name) => {
                      const n = String(name ?? '');
                      const v = Number(value ?? 0);
                      if (n === 'cacheHitRate') return [`${v.toFixed(1)}%`, 'Cache命中率'];
                      return [`${(v / 1000).toFixed(1)}K`, n];
                    }}
                  />
                  <Legend />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="input"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                    name="Input"
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="output"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                    name="Output"
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="cacheCreation"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={false}
                    name="Cache Creation"
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="cacheRead"
                    stroke="#06b6d4"
                    strokeWidth={2}
                    dot={false}
                    name="Cache Read"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="cacheHitRate"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    name="Cache Hit Rate"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* 第二行：最近使用 Top 3 */}
        <Card className="glass-card-interactive">
          <CardHeader>
            <CardTitle className="text-base font-semibold">最近使用 (Top 3)</CardTitle>
            <CardDescription>按成员分组的消费趋势</CardDescription>
          </CardHeader>
          <CardContent>
            {topUsage.length === 0 ? (
              <div className="py-12">
                <EmptyState
                  title="暂无数据"
                  description={`${employeeCopy.entity}上岗后，使用趋势将显示在这里。`}
                />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={topUsage}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ ...CHART_AXIS_TICK, fontSize: 10 }}
                    stroke={CHART_AXIS_LINE}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return `${date.getMonth() + 1}/${date.getDate()}`;
                    }}
                  />
                  <YAxis
                    tick={{ ...CHART_AXIS_TICK, fontSize: 11 }}
                    stroke={CHART_AXIS_LINE}
                    tickFormatter={(value) => `¥${value.toFixed(0)}`}
                  />
                  <Tooltip
                    contentStyle={{
                      ...CHART_TOOLTIP_STYLE,
                      borderRadius: '8px',
                      border: '1px solid rgba(139, 92, 246, 0.2)',
                    }}
                    formatter={(value, name) => [`¥${Number(value ?? 0).toFixed(2)}`, String(name ?? '')]}
                    labelFormatter={(value) => {
                      const date = new Date(value as string);
                      return date.toLocaleDateString('zh-CN');
                    }}
                  />
                  <Legend />
                  {topUsage.length > 0 && Object.keys(topUsage[0])
                    .filter(key => key !== 'date')
                    .slice(0, 3)
                    .map((memberName, index) => (
                      <Line
                        key={memberName}
                        type="monotone"
                        dataKey={memberName}
                        stroke={['#3b82f6', '#10b981', '#f59e0b'][index]}
                        strokeWidth={2.5}
                        dot={false}
                      />
                    ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* 第三行：热门员工 + 最近活动 */}
        <div className="grid gap-4 lg:grid-cols-2 items-stretch">
          <Card className="glass-card-interactive h-full flex flex-col">
            <CardHeader>
              <CardTitle className="text-base font-semibold">热门员工 Top 5</CardTitle>
              <CardDescription>按调用次数排序</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              {stats.topEmployees.length === 0 ? (
                <div className="py-12">
                  <EmptyState
                    title="暂无数据"
                    description={`${employeeCopy.entity}上岗后，热门员工将显示在这里。`}
                  />
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={stats.topEmployees}
                    layout="vertical"
                    margin={{ left: 0, right: 20, top: 5, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ ...CHART_AXIS_TICK, fontSize: 11 }}
                      stroke={CHART_AXIS_LINE}
                      label={{ value: '调用次数', position: 'insideBottom', offset: -5, style: { fontSize: 11, fill: 'rgba(255,255,255,0.5)' } }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={120}
                      tick={{ fill: '#666', fontSize: 12 }}
                      stroke={CHART_AXIS_LINE}
                    />
                    <Tooltip
                      contentStyle={{
                        ...CHART_TOOLTIP_STYLE,
                        borderRadius: '8px',
                        border: '1px solid rgba(139, 92, 246, 0.2)',
                      }}
                      cursor={{ fill: CHART_CURSOR_FILL }}
                      formatter={(value) => [value as number, '调用次数']}
                    />
                    <Bar
                      dataKey="calls"
                      fill="#8b5cf6"
                      radius={[0, 6, 6, 0] as [number, number, number, number]}
                      background={{ fill: 'rgba(139, 92, 246, 0.05)', radius: [0, 6, 6, 0] as unknown as number }}
                      label={{ position: 'right', fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="glass-card-interactive h-full flex flex-col">
            <CardHeader>
              <CardTitle className="text-base font-semibold">最近活动</CardTitle>
              <CardDescription>最近 10 条操作记录</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              {stats.recentActivities.length === 0 ? (
                <div className="py-12">
                  <EmptyState
                    title="暂无活动"
                    description="企业活动记录将显示在这里。"
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  {stats.recentActivities.map((activity, i) => (
                    <div
                      key={i}
                      className="group fake-glass flex items-start gap-3 p-3 text-sm transition-colors hover:border-glassline-hover hover:bg-glass-2"
                    >
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-glassline bg-glass-2 transition-colors group-hover:bg-glass-3">
                        <Zap className="h-4 w-4 text-gbrand-text" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-gtext-primary">
                          <span className="font-medium">{activity.actor || '未知员工'}</span> 使用{' '}
                          <span className="font-medium">{activity.target || '未知员工'}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-gtext-muted">
                          {formatDistanceToNow(new Date(activity.time), {
                            addSuffix: true,
                            locale: zhCN,
                          })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 快速入口 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">快速操作</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              <Link href="/marketplace" className="group block">
                <div className="flex h-24 items-center gap-4 rounded-glass-md border border-glassline bg-glass-1 px-4 transition-all hover:border-glassline-brand hover:bg-glass-2 hover:shadow-glass-md">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-glassline bg-glass-2 transition-all group-hover:scale-110 group-hover:bg-glass-3">
                    <Bot className="h-5 w-5 text-gbrand-text" />
                  </div>
                  <div>
                    <div className="font-semibold text-gtext-primary">招聘新员工</div>
                    <div className="mt-0.5 text-xs text-gtext-muted">从人才市场招聘</div>
                  </div>
                </div>
              </Link>
              <Link href="/members" className="group block">
                <div className="flex h-24 items-center gap-4 rounded-glass-md border border-glassline bg-glass-1 px-4 transition-all hover:border-glassline-brand hover:bg-glass-2 hover:shadow-glass-md">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-glassline bg-glass-2 transition-all group-hover:scale-110 group-hover:bg-glass-3">
                    <UserPlus className="h-5 w-5 text-gbrand-text" />
                  </div>
                  <div>
                    <div className="font-semibold text-gtext-primary">邀请成员</div>
                    <div className="mt-0.5 text-xs text-gtext-muted">添加碳基员工</div>
                  </div>
                </div>
              </Link>
              <Link href="/usage" className="group block">
                <div className="flex h-24 items-center gap-4 rounded-glass-md border border-glassline bg-glass-1 px-4 transition-all hover:border-glassline-brand hover:bg-glass-2 hover:shadow-glass-md">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-glassline bg-glass-2 transition-all group-hover:scale-110 group-hover:bg-glass-3">
                    <Wallet className="h-5 w-5 text-gbrand-text" />
                  </div>
                  <div>
                    <div className="font-semibold text-gtext-primary">查看消费</div>
                    <div className="mt-0.5 text-xs text-gtext-muted">用量统计与账单</div>
                  </div>
                </div>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
