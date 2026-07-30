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
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { StatsCard } from '@/components/dashboard/stats-card';
import { useDashboardStats, useEnterpriseInfo } from '@/features/enterprise/use-enterprise';
import { OnboardingModal } from '@/features/onboarding/onboarding-modal';

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
    return <CenteredSpinner />;
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
    <div className="space-y-6 p-6">
      {/* Onboarding Modal */}
      {showOnboarding && <OnboardingModal onClose={() => setShowOnboarding(false)} />}

      {/* 1. 关键指标卡片 */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="AI 员工"
          value={stats.employeeCount}
          icon={<Bot className="h-8 w-8" />}
        />
        <StatsCard
          title="团队成员"
          value={stats.memberCount}
          icon={<Users className="h-8 w-8" />}
        />
        <StatsCard
          title="本月消费"
          value={`¥${stats.monthlySpend.toFixed(2)}`}
          icon={<Wallet className="h-8 w-8" />}
        />
        <StatsCard
          title="本月调用"
          value={stats.callCount}
          icon={<Zap className="h-8 w-8" />}
        />
      </div>

      {/* 2. 消费趋势图 */}
      <Card>
        <CardHeader>
          <CardTitle>算力消费趋势</CardTitle>
          <CardDescription>最近 30 天</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.spendTrend.length === 0 ? (
            <EmptyState title="暂无消费数据" description="开始使用 AI 员工后，消费趋势将显示在这里。" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={stats.spendTrend}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  className="text-xs text-fg-muted"
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                />
                <YAxis className="text-xs text-fg-muted" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--background))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '0.5rem',
                  }}
                  labelFormatter={(value) => {
                    const date = new Date(value as string);
                    return date.toLocaleDateString('zh-CN');
                  }}
                  formatter={(value) => [`¥${(value as number).toFixed(2)}`, '消费']}
                />
                <Line
                  type="monotone"
                  dataKey="amount"
                  stroke="#eb3f00"
                  strokeWidth={2}
                  dot={{ fill: '#eb3f00', r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 3. 热门员工 Top 5 */}
        <Card>
          <CardHeader>
            <CardTitle>热门员工 Top 5</CardTitle>
            <CardDescription>按调用次数排序</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.topEmployees.length === 0 ? (
              <EmptyState title="暂无数据" description="开始使用 AI 员工后，热门员工将显示在这里。" />
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={stats.topEmployees} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" className="text-xs text-fg-muted" />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={150}
                    className="text-xs text-fg-muted"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--background))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '0.5rem',
                    }}
                    formatter={(value) => [value as number, '调用次数']}
                  />
                  <Bar dataKey="calls" fill="#eb3f00" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* 4. 最近活动 */}
        <Card>
          <CardHeader>
            <CardTitle>最近活动</CardTitle>
            <CardDescription>最近 10 条操作记录</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.recentActivities.length === 0 ? (
              <EmptyState title="暂无活动" description="企业活动记录将显示在这里。" />
            ) : (
              <div className="space-y-3">
                {stats.recentActivities.map((activity, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm">
                    <Zap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground">
                        <strong>{activity.actor}</strong> 使用{' '}
                        <strong>{activity.target}</strong>
                      </p>
                      <p className="text-xs text-fg-muted">
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
      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/marketplace" className="block">
          <Button variant="secondary" className="h-20 w-full justify-start gap-3">
            <Bot className="h-5 w-5" />
            <span>招聘新员工</span>
          </Button>
        </Link>
        <Link href="/members" className="block">
          <Button variant="secondary" className="h-20 w-full justify-start gap-3">
            <UserPlus className="h-5 w-5" />
            <span>邀请成员</span>
          </Button>
        </Link>
        <Link href="/usage" className="block">
          <Button variant="secondary" className="h-20 w-full justify-start gap-3">
            <Wallet className="h-5 w-5" />
            <span>查看消费</span>
          </Button>
        </Link>
      </div>
    </div>
  );
}
