'use client';

import { Users, UserCheck, Shield, Building2 } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import type { EnterpriseMember } from '@/lib/types';

interface MemberStatsProps {
  members: EnterpriseMember[];
}

export function MemberStats({ members }: MemberStatsProps) {
  const totalCount = members.length;
  const adminCount = members.filter((m) => m.role === 'ENTERPRISE_ADMIN').length;
  const deptManagerCount = members.filter((m) => m.role === 'DEPT_MANAGER').length;
  const withDeptCount = members.filter((m) => m.department !== null).length;

  const deptRate = totalCount > 0 ? Math.round((withDeptCount / totalCount) * 100) : 0;

  const stats = [
    {
      icon: Users,
      label: '成员总数',
      value: totalCount,
      description: '企业成员',
    },
    {
      icon: Shield,
      label: '管理员',
      value: adminCount,
      description: `${deptManagerCount} 个部门负责人`,
    },
    {
      icon: Building2,
      label: '已分配部门',
      value: withDeptCount,
      description: `${deptRate}% 分配率`,
      trend: deptRate > 0 ? `${deptRate}%` : undefined,
      trendUp: deptRate > 70,
    },
    {
      icon: UserCheck,
      label: '未分配',
      value: totalCount - withDeptCount,
      description: totalCount - withDeptCount > 0 ? '待分配部门' : '全部已分配',
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
        />
      ))}
    </div>
  );
}
