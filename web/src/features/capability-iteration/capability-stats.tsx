'use client';

import { Library, Package, Users, TrendingUp } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';

interface CapabilityStatsProps {
  summary: {
    capabilityCount: number;
    customizedCount: number;
    pendingAdoptionTotal: number;
    totalRounds: number;
  };
}

export function CapabilityStats({ summary }: CapabilityStatsProps) {
  const customizationRate = summary.capabilityCount > 0
    ? Math.round((summary.customizedCount / summary.capabilityCount) * 100)
    : 0;

  const stats = [
    {
      icon: Library,
      label: '技能总数',
      value: summary.capabilityCount,
      description: '可用技能',
    },
    {
      icon: Package,
      label: '已调整',
      value: summary.customizedCount,
      description: `${customizationRate}% 调整率`,
      trend: customizationRate > 0 ? `${customizationRate}%` : undefined,
      trendUp: customizationRate > 0,
    },
    {
      icon: Users,
      label: '待采纳',
      value: summary.pendingAdoptionTotal,
      description: summary.pendingAdoptionTotal > 0 ? '需要处理' : '暂无待办',
      highlight: summary.pendingAdoptionTotal > 0,
    },
    {
      icon: TrendingUp,
      label: '总调用',
      value: summary.totalRounds,
      description: '累计使用次数',
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
          className={stat.highlight ? 'border-gbrand-text/30 bg-gbrand/5' : ''}
        />
      ))}
    </div>
  );
}
