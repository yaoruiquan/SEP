'use client';

import { Users, TrendingUp, Pause, AlertCircle } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import type { Subscription } from '@/lib/types';

interface SubscriptionStatsProps {
  subscriptions: Subscription[];
}

export function SubscriptionStats({ subscriptions }: SubscriptionStatsProps) {
  const totalCount = subscriptions.length;
  const activeCount = subscriptions.filter((s) => s.status === 'ACTIVE').length;
  const pausedCount = subscriptions.filter((s) => s.status === 'PAUSED').length;

  // 计算近30天使用率：有人在用的占比
  const usedCount = subscriptions.filter((s) => {
    const usage = s.usage;
    return usage && usage.activeUserCount30d > 0;
  }).length;

  const usageRate = totalCount > 0 ? Math.round((usedCount / totalCount) * 100) : 0;

  const stats = [
    {
      icon: Users,
      label: '雇佣总数',
      value: totalCount,
      description: `${activeCount} 个活跃`,
    },
    {
      icon: TrendingUp,
      label: '近30天使用',
      value: usedCount,
      description: `${usageRate}% 使用率`,
      trend: usageRate > 0 ? `${usageRate}%` : undefined,
      trendUp: usageRate > 60,
    },
    {
      icon: AlertCircle,
      label: '未使用',
      value: totalCount - usedCount,
      description: totalCount - usedCount > 0 ? '建议检查授权' : '全部在用',
      highlight: totalCount - usedCount > 0,
    },
    {
      icon: Pause,
      label: '已暂停',
      value: pausedCount,
      description: pausedCount > 0 ? '暂停计费' : '无暂停项',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <StatCard
          key={stat.label}
          icon={stat.icon}
          label={stat.label}
          value={stat.value}
          description={stat.description}
          trend={stat.trend}
          trendUp={stat.trendUp}
          className={stat.highlight ? 'border-warning/30 bg-warning/5' : ''}
        />
      ))}
    </div>
  );
}
