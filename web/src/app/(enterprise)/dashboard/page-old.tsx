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
import { Button } from '@/components/ui/button';
import { CenteredSpinner, EmptyState, Skeleton, SkeletonCard } from '@/components/ui/feedback';
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
  CHART_SERIES,
} from '@/lib/chart-theme';

// 模型分布饼图颜色
const MODEL_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

// 生成模拟的模型分布数据
function generateModelDistribution() {
  return [
    { name: 'claude-opus-5', value: 1074, requests: 1074, tokens: 119.46, cost: 161.38 },
    { name: 'gpt-5.6-sol', value: 835, requests: 835, tokens: 55.37, cost: 79.35 },
    { name: 'gpt-5.6-terra', value: 16, requests: 16, tokens: 640.98, cost: 0.426 },
    { name: 'gpt-5.4-mini', value: 51, requests: 51, tokens: 366.24, cost: 0.29 },
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
      time: time.toISOString(),
      input: Math.random() * 5000 + 2000,
      output: Math.random() * 15000 + 8000,
      cacheCreation: Math.random() * 3000 + 1000,
      cacheRead: Math.random() * 2000,
      cacheHitRate: Math.random() * 30 + 70, // 70-100%
    });
  }
  return data;
}

// 生成模拟的最近使用 Top 12（多用户）
function generateTopUsage() {
  const data = [];
  const now = new Date();
  for (let i = 24; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 60 * 60 * 1000);
    data.push({
      time: time.toISOString(),
      user1: Math.random() * 8000 + 2000,
      user2: Math.random() * 15000 + 5000,
      user3: Math.random() * 3000 + 500,
    });
  }
  return data;
}

export default function DashboardPage() {
  const { data: stats, isLoading, error } = useDashboardStats();
  const { data: enterprise } = useEnterpriseInfo();
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (enterprise && !enterprise.metadata?.onboardingCompleted) {
      setShowOnboarding(true);
    }
  }, [enterprise]);

  if (isLoading) {
    return (
      <div className="min-h-full">
        <div className="mx-auto max-w-7xl space-y-6 p-6">
          {/* Header Skeleton */}
          <div className="mb-8 space-y-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-5 w-48" />
          </div>

          {/* Metric Cards Skeleton */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
          </div>

          {/* Chart Skeleton */}
          <Skeleton className="h-96 rounded-lg" />

          {/* Bottom Cards Skeleton */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-80 rounded-lg" />
            <Skeleton className="h-80 rounded-lg" />
          </div>
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
      {/* Onboarding Modal */}
      {showOnboarding && <OnboardingModal onClose={() => setShowOnboarding(false)} />}

      <div className="mx-auto max-w-7xl space-y-6 p-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gtext-primary">工作台</h1>
          <p className="mt-1 text-sm text-gtext-secondary">
            欢迎回来，{enterprise?.name || '管理员'}
          </p>
        </div>

        {/* 订阅到期提醒 */}
        <SubscriptionExpiryBanner />

        {/* 1. 关键指标卡片 - 使用新的 MetricCard */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            variant="glass"
            title="AI 员工"
            value={stats.employeeCount}
            icon={Bot}
            trend={{ direction: 'up', value: 20, label: '较上月' }}
          />
          <MetricCard
            variant="glass"
            title="团队成员"
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

        {/* 2. 消费趋势图 - 优化样式 */}
        <Card className="glass-card-interactive">
          <CardHeader>
            <CardTitle className="text-base font-semibold">算力消费趋势</CardTitle>
            <CardDescription>最近 30 天</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.spendTrend.length === 0 ? (
              <div className="py-12">
                <EmptyState
                  title="暂无消费数据"
                  description="开始使用 AI 员工后，消费趋势将显示在这里。"
                />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={stats.spendTrend}>
                  <defs>
                    <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ ...CHART_AXIS_TICK, fontSize: 11 }}
                    stroke={CHART_AXIS_LINE}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return `${date.getMonth() + 1}/${date.getDate()}`;
                    }}
                  />
                  <YAxis
                    tick={{ ...CHART_AXIS_TICK, fontSize: 11 }}
                    stroke={CHART_AXIS_LINE}
                    tickFormatter={(value) => `¥${value}`}
                  />
                  <Tooltip
                    contentStyle={{
                      ...CHART_TOOLTIP_STYLE,
                      borderRadius: '8px',
                      border: '1px solid rgba(139, 92, 246, 0.2)',
                    }}
                    labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                    labelFormatter={(value) => {
                      const date = new Date(value as string);
                      return date.toLocaleDateString('zh-CN');
                    }}
                    formatter={(value) => [`¥${(value as number).toFixed(2)}`, '消费']}
                  />
                  <Line
                    type="monotone"
                    dataKey="amount"
                    stroke="#8b5cf6"
                    strokeWidth={3}
                    dot={{ fill: '#8b5cf6', r: 3, strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 5, fill: '#8b5cf6', strokeWidth: 2, stroke: '#fff' }}
                    fill="url(#colorAmount)"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* 3. 热门员工 Top 5 */}
          <Card className="glass-card-interactive">
            <CardHeader>
              <CardTitle className="text-base font-semibold">热门员工 Top 5</CardTitle>
              <CardDescription>按调用次数排序</CardDescription>
            </CardHeader>
            <CardContent>
              {stats.topEmployees.length === 0 ? (
                <div className="py-12">
                  <EmptyState
                    title="暂无数据"
                    description="开始使用 AI 员工后，热门员工将显示在这里。"
                  />
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={stats.topEmployees} layout="vertical" margin={{ left: 10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ ...CHART_AXIS_TICK, fontSize: 11 }}
                      stroke={CHART_AXIS_LINE}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={140}
                      tick={{ ...CHART_AXIS_TICK, fontSize: 12 }}
                      stroke={CHART_AXIS_LINE}
                    />
                    <Tooltip
                      contentStyle={{
                        ...CHART_TOOLTIP_STYLE,
                        borderRadius: '8px',
                        border: '1px solid rgba(139, 92, 246, 0.2)',
                      }}
                      labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                      cursor={{ fill: CHART_CURSOR_FILL }}
                      formatter={(value) => [value as number, '调用次数']}
                    />
                    <Bar
                      dataKey="calls"
                      fill="#8b5cf6"
                      radius={[0, 6, 6, 0]}
                      background={{ fill: 'rgba(139, 92, 246, 0.05)', radius: [0, 6, 6, 0] }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* 4. 最近活动 */}
          <Card className="glass-card-interactive">
            <CardHeader>
              <CardTitle className="text-base font-semibold">最近活动</CardTitle>
              <CardDescription>最近 10 条操作记录</CardDescription>
            </CardHeader>
            <CardContent>
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
                    <div key={i} className="group fake-glass flex items-start gap-3 p-3 text-sm transition-colors hover:border-glassline-hover hover:bg-glass-2">
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

        {/* 5. 快速入口 */}
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
                    <div className="mt-0.5 text-xs text-gtext-muted">添加团队成员</div>
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
