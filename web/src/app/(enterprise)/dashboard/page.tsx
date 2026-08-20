'use client';

import Link from 'next/link';
import {
  ArrowUpRight,
  BriefcaseBusiness,
  ChevronRight,
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
import { cn } from '@/lib/utils';

const numberFormatter = new Intl.NumberFormat('zh-CN');
const MODEL_COLORS = ['#3b82f6', '#14b8a6', '#f59e0b', '#a855f7', '#ec4899', '#64748b'];
const MODEL_LABELS: Record<string, string> = {
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

function formatDate(value: string) {
  const parts = value.split('-');
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : value;
}

function formatModelName(model: string) {
  return MODEL_LABELS[model] ?? model;
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof Users;
  tone: 'pink' | 'green' | 'orange' | 'blue';
}) {
  const tones = {
    pink: 'bg-gbrand-text/15 text-gbrand-text ring-gbrand-text/25',
    green: 'bg-gsuccess/15 text-gsuccess ring-gsuccess/25',
    orange: 'bg-gwarning/15 text-gwarning ring-gwarning/25',
    blue: 'bg-ginfo/15 text-ginfo ring-ginfo/25',
  };

  return (
    <div className="glass-card group rounded-[22px] p-5 transition-all duration-300 hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-3">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-2xl ring-1', tones[tone])}>
          <Icon className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <ArrowUpRight className="h-4 w-4 text-gtext-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
      <p className="mt-5 text-[13px] font-medium text-gtext-secondary">{label}</p>
      <p className="mt-1 text-[30px] font-semibold text-gtext-primary">{value}</p>
      <p className="mt-2 text-xs text-gtext-muted">{detail}</p>
    </div>
  );
}

function ModelDistributionChart({ data }: { data: ModelDistribution[] }) {
  const totalRequests = data.reduce((sum, item) => sum + item.requests, 0);
  const chartData = data.slice(0, 6).map((item) => ({ ...item, displayName: formatModelName(item.model) }));

  if (!chartData.length) {
    return <div className="flex h-[300px] items-center justify-center text-sm text-gtext-muted">暂无模型调用数据</div>;
  }

  return (
    <div className="grid items-center gap-5 lg:grid-cols-[minmax(220px,0.9fr)_1.1fr]">
      <div className="relative h-[270px] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={chartData} dataKey="requests" nameKey="displayName" innerRadius="58%" outerRadius="82%" paddingAngle={2} stroke="none">
              {chartData.map((item, index) => <Cell key={item.model} fill={MODEL_COLORS[index % MODEL_COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(value) => [`${numberFormatter.format(Number(value))} 次`, '请求']} contentStyle={{ borderRadius: 12, border: '1px solid var(--glass-border)', background: 'var(--surface-solid-raised)', color: 'var(--gtext-primary)', boxShadow: 'var(--glass-shadow-md)' }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-semibold text-gtext-primary">{formatCompactNumber(totalRequests)}</span><span className="mt-1 text-xs text-gtext-muted">总请求</span></div>
      </div>
      <div className="min-w-0 space-y-1">
        <div className="grid grid-cols-[minmax(112px,1fr)_52px_76px] gap-2 border-b border-glassline px-2 pb-3 text-xs font-semibold text-gtext-muted"><span>模型</span><span className="text-right">请求</span><span className="text-right">成本</span></div>
        {chartData.map((item, index) => <div key={item.model} className="grid min-h-14 grid-cols-[minmax(112px,1fr)_52px_76px] items-center gap-2 border-b border-glassline px-2 py-3 last:border-0"><span className="flex min-w-0 items-center gap-2 text-sm font-medium leading-5 text-gtext-primary" title={item.model}><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: MODEL_COLORS[index % MODEL_COLORS.length] }} /><span className="min-w-0 whitespace-normal break-words">{item.displayName}</span></span><span className="text-right text-xs text-gtext-secondary">{numberFormatter.format(item.requests)}</span><span className="text-right text-xs font-semibold text-gsuccess">{formatCost(item.cost)}</span></div>)}
      </div>
    </div>
  );
}

function TokenTrendChart({ data }: { data: TokenTrend[] }) {
  const chartData = data.map((item) => ({ ...item, label: formatDate(item.date) }));
  if (!chartData.length) return <div className="flex h-[300px] items-center justify-center text-sm text-gtext-muted">暂无 Token 使用数据</div>;

  return (
    <div className="h-[315px] min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
          <defs><linearGradient id="inputTokens" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} /></linearGradient><linearGradient id="outputTokens" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#14b8a6" stopOpacity={0.25} /><stop offset="95%" stopColor="#14b8a6" stopOpacity={0.02} /></linearGradient></defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--gtext-muted)' }} tickLine={false} axisLine={false} minTickGap={20} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--gtext-muted)' }} tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(value) => formatCompactNumber(Number(value))} width={64} />
          <Tooltip formatter={(value, name) => [formatCompactNumber(Number(value)), name === 'input' ? 'Input' : 'Output']} labelFormatter={(label) => `日期 ${label}`} contentStyle={{ borderRadius: 12, border: '1px solid var(--glass-border)', background: 'var(--surface-solid-raised)', color: 'var(--gtext-primary)', boxShadow: 'var(--glass-shadow-md)' }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: 'var(--gtext-secondary)' }} formatter={(value) => value === 'input' ? 'Input' : 'Output'} />
          <Area type="monotone" dataKey="input" stroke="#3b82f6" strokeWidth={2.5} fill="url(#inputTokens)" dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 5 }} />
          <Area type="monotone" dataKey="output" stroke="#14b8a6" strokeWidth={2.5} fill="url(#outputTokens)" dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 5 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function MemberUsageList({ data }: { data: TopMember[] }) {
  if (!data.length) return <div className="flex h-48 items-center justify-center text-sm text-gtext-muted">暂无成员消费数据</div>;
  const maxCost = Math.max(...data.map((item) => item.cost), 1);

  return <div className="space-y-4">{data.slice(0, 5).map((member, index) => <div key={member.id} className="grid grid-cols-[32px_minmax(0,1fr)_96px] items-center gap-3"><span className={cn('flex h-7 w-7 items-center justify-center rounded-lg text-xs font-semibold', index === 0 ? 'bg-gbrand-text/15 text-gbrand-text' : 'bg-glass-2 text-gtext-muted')}>{String(index + 1).padStart(2, '0')}</span><div className="min-w-0"><div className="mb-1.5 flex items-center justify-between gap-2"><span className="truncate text-sm font-medium text-gtext-primary">{member.name}</span><span className="shrink-0 text-xs text-gtext-muted">{member.calls} 次调用</span></div><div className="h-2 overflow-hidden rounded-full bg-glass-2"><div className="h-full rounded-full bg-gradient-to-r from-ginfo to-gsuccess" style={{ width: `${Math.max((member.cost / maxCost) * 100, 3)}%` }} /></div></div><span className="text-right text-sm font-semibold text-gtext-primary">{formatCost(member.cost)}</span></div>)}</div>;
}

export default function DashboardPage() {
  const { data, isLoading, isError } = useDashboard();

  if (isLoading) return <div className="space-y-6"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <div key={item} className="glass-card h-40 animate-pulse rounded-[22px]" />)}</div><div className="grid gap-6 xl:grid-cols-2"><div className="glass-card h-[430px] animate-pulse rounded-[24px]" /><div className="glass-card h-[430px] animate-pulse rounded-[24px]" /></div><div className="glass-card h-72 animate-pulse rounded-[24px]" /></div>;
  if (isError || !data) return <div className="glass-card flex min-h-[420px] items-center justify-center rounded-[28px] text-sm text-gtext-muted">工作台数据加载失败，请稍后重试</div>;

  const { stats, modelDistribution, tokenTrend, topMembers } = data;
  const conversationTrend = stats.conversations.trend;
  const computeTrend = stats.computeUsage.trend;

  return <div className="mx-auto max-w-[1480px] space-y-6 pb-8">
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard icon={Users} tone="pink" label="雇佣员工" value={stats.totalEmployees} detail={`${stats.activeEmployees} 位正在活跃`} /><MetricCard icon={MessageSquareText} tone="green" label="本月对话" value={formatCompactNumber(stats.conversations.total)} detail={`${conversationTrend >= 0 ? '+' : ''}${conversationTrend}% 较上月`} /><MetricCard icon={BriefcaseBusiness} tone="orange" label="组织成员" value={stats.totalMembers} detail={`${stats.totalDepartments} 个部门`} /><MetricCard icon={Gauge} tone="blue" label="本月算力" value={formatComputeUsage(stats.computeUsage.total)} detail={`${computeTrend >= 0 ? '+' : ''}${computeTrend}% 较上月`} /></section>

    <section className="grid gap-6 xl:grid-cols-2"><div className="glass-card rounded-[24px] p-6 sm:p-7"><div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase text-ginfo">Model mix</p><h2 className="mt-2 text-lg font-semibold text-gtext-primary">模型分布</h2><p className="mt-1 text-xs text-gtext-muted">按请求次数统计模型使用情况</p></div><Link href="/usage" className="inline-flex items-center gap-1 text-xs font-semibold text-gtext-secondary transition-colors hover:text-gbrand-text">查看用量 <ArrowUpRight className="h-3.5 w-3.5" /></Link></div><ModelDistributionChart data={modelDistribution} /></div><div className="glass-card rounded-[24px] p-6 sm:p-7"><div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase text-gsuccess">Token activity</p><h2 className="mt-2 text-lg font-semibold text-gtext-primary">Token 使用趋势</h2><p className="mt-1 text-xs text-gtext-muted">最近 7 天 Input / Output 用量</p></div><div className="rounded-xl bg-gsuccess/15 p-2 text-gsuccess"><Cpu className="h-4 w-4" /></div></div><TokenTrendChart data={tokenTrend} /></div></section>

    <section className="glass-card rounded-[24px] p-6 sm:p-7"><div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase text-gwarning">Member activity</p><h2 className="mt-2 text-lg font-semibold text-gtext-primary">最近使用成员</h2><p className="mt-1 text-xs text-gtext-muted">按最近消费金额排序</p></div><div className="rounded-xl bg-gwarning/15 p-2 text-gwarning"><Users className="h-4 w-4" /></div></div><MemberUsageList data={topMembers} /><Link href="/usage" className="mt-6 flex items-center justify-end gap-1 border-t border-glassline pt-4 text-xs font-medium text-gbrand-text transition-colors hover:text-gbrand-text-hover">查看完整用量报告 <ChevronRight className="h-4 w-4" /></Link></section>
  </div>;
}
