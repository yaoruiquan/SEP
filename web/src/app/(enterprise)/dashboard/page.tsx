'use client';

import { Users, Briefcase, TrendingUp, Zap } from 'lucide-react';
import { useDashboard } from '@/features/dashboard/use-dashboard';
import { cn } from '@/lib/utils';

// ─── Stat Card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  trend?: number;
  className?: string;
}

function StatCard({ icon, label, value, trend, className }: StatCardProps) {
  return (
    <div className={cn('glass-card p-5', className)}>
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-glassline bg-glass-2">
          {icon}
        </div>
        {trend !== undefined && (
          <div
            className={cn(
              'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
              trend >= 0
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-rose-500/10 text-rose-400',
            )}
          >
            <TrendingUp
              className={cn('h-3 w-3', trend < 0 && 'rotate-180')}
            />
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div className="mt-4">
        <p className="text-xs text-gtext-secondary">{label}</p>
        <p className="mt-1 text-2xl font-bold text-gtext-primary">{value}</p>
      </div>
    </div>
  );
}

// ─── Chart Placeholder ────────────────────────────────────────────────────────

function UsageTrendChart({ data }: { data: Array<{ date: string; conversations: number; compute: number }> }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gtext-muted">
        暂无数据
      </div>
    );
  }

  // Simple bar chart visualization
  const maxConv = Math.max(...data.map(d => d.conversations), 1);
  const maxComp = Math.max(...data.map(d => d.compute), 1);

  return (
    <div className="space-y-3">
      {data.slice(-7).map((item, idx) => (
        <div key={idx} className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gtext-secondary">{item.date}</span>
            <div className="flex gap-3">
              <span className="text-gbrand-text">{item.conversations} 对话</span>
              <span className="text-gtext-muted">{item.compute} 算力</span>
            </div>
          </div>
          <div className="flex gap-1.5">
            <div
              className="h-2 rounded-full bg-gbrand/60"
              style={{ width: `${(item.conversations / maxConv) * 100}%` }}
            />
            <div
              className="h-2 rounded-full bg-glass-2"
              style={{ width: `${(item.compute / maxComp) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Top Employees ────────────────────────────────────────────────────────────

function TopEmployeesTable({ data }: { data: Array<{ id: string; name: string; conversations: number; compute: number }> }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-gtext-muted">
        暂无数据
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.map((emp, idx) => (
        <div
          key={emp.id}
          className="flex items-center justify-between rounded-glass-lg border border-glassline bg-glass-2 p-3"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gbrand/20 text-xs font-semibold text-gbrand-text">
              {idx + 1}
            </span>
            <span className="text-sm font-medium text-gtext-primary">{emp.name}</span>
          </div>
          <div className="flex gap-4 text-xs text-gtext-secondary">
            <span>{emp.conversations} 对话</span>
            <span>{emp.compute} 算力</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data, isLoading, isError } = useDashboard();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="glass-card h-32 animate-pulse" />
          ))}
        </div>
        <div className="glass-card h-80 animate-pulse" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="glass-card flex h-80 items-center justify-center">
        <p className="text-sm text-gtext-muted">加载失败</p>
      </div>
    );
  }

  const { stats, usageTrend, topEmployees } = data;

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Users className="h-5 w-5 text-gbrand-text" />}
          label="雇佣员工"
          value={stats.totalEmployees}
        />
        <StatCard
          icon={<Zap className="h-5 w-5 text-emerald-400" />}
          label="活跃员工"
          value={stats.activeEmployees}
        />
        <StatCard
          icon={<Briefcase className="h-5 w-5 text-gtext-secondary" />}
          label="部门数"
          value={stats.totalDepartments}
        />
        <StatCard
          icon={<Users className="h-5 w-5 text-gtext-secondary" />}
          label="成员数"
          value={stats.totalMembers}
        />
      </div>

      {/* Conversations & Compute */}
      <div className="grid gap-4 lg:grid-cols-2">
        <StatCard
          icon={<TrendingUp className="h-5 w-5 text-gbrand-text" />}
          label="本月对话"
          value={stats.conversations.total}
          trend={stats.conversations.trend}
        />
        <StatCard
          icon={<Zap className="h-5 w-5 text-amber-400" />}
          label="本月算力消耗"
          value={stats.computeUsage.total}
          trend={stats.computeUsage.trend}
        />
      </div>

      {/* Usage Trend Chart */}
      <div className="glass-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-gtext-primary">使用趋势</h2>
        <UsageTrendChart data={usageTrend} />
      </div>

      {/* Top Employees */}
      <div className="glass-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-gtext-primary">最活跃员工</h2>
        <TopEmployeesTable data={topEmployees} />
      </div>

      {/* Balance Card */}
      <div className="glass-card bg-gradient-to-br from-gbrand/20 to-transparent p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gtext-secondary">企业余额</p>
            <p className="mt-1 text-3xl font-bold text-gtext-primary">
              ¥{stats.balance.toLocaleString()}
            </p>
          </div>
          <button className="rounded-full border border-glassline-brand bg-gbrand/10 px-4 py-2 text-sm font-medium text-gbrand-text transition-colors hover:bg-gbrand/20">
            充值
          </button>
        </div>
      </div>
    </div>
  );
}
