'use client';

import Link from 'next/link';
import {
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
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { useAuthStore } from '@/lib/auth-store';
import { PageFrame } from '@/components/page/page-frame';
import { PageHero } from '@/components/page/page-hero';
import { StatStrip } from '@/components/page/stat-strip';
import { SectionCard } from '@/components/page/section-card';

const numberFormatter = new Intl.NumberFormat('zh-CN');
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

function formatDate(value: string) {
  const parts = value.split('-');
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : value;
}

function formatModelName(model: string) {
  return MODEL_LABELS[model] ?? model;
}

function ModelDistributionChart({ data }: { data: ModelDistribution[] }) {
  const totalRequests = data.reduce((sum, item) => sum + item.requests, 0);
  const chartData = data.slice(0, 6).map((item) => ({ ...item, displayName: formatModelName(item.model) }));

  if (!chartData.length) {
    return <div className="flex h-[300px] items-center justify-center text-sm text-gtext-muted">暂无模型调用数据</div>;
  }

  return (
    <div className="grid items-center gap-5 lg:grid-cols-[minmax(220px,0.9fr)_1.1fr]">
      <div className="relative h-[228px] min-w-0">
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
        <div className="grid grid-cols-[minmax(112px,1fr)_52px_76px] gap-2 border-b border-border px-2 pb-3 text-xs font-semibold text-fg-muted"><span>模型</span><span className="text-right">请求</span><span className="text-right">成本</span></div>
        {chartData.map((item, index) => <div key={item.model} className="grid min-h-12 grid-cols-[minmax(112px,1fr)_52px_76px] items-center gap-2 border-b border-border px-2 py-2.5 last:border-0"><span className="flex min-w-0 items-center gap-2 text-sm font-medium leading-5 text-foreground" title={item.model}><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: MODEL_COLORS[index % MODEL_COLORS.length] }} /><span className="min-w-0 whitespace-normal break-words">{item.displayName}</span></span><span className="text-right text-xs text-fg-muted">{numberFormatter.format(item.requests)}</span><span className="text-right text-xs font-semibold text-emerald-600">{formatCost(item.cost)}</span></div>)}
      </div>
    </div>
  );
}

function TokenTrendChart({ data }: { data: TokenTrend[] }) {
  const chartData = data.map((item) => ({ ...item, label: formatDate(item.date) }));
  if (!chartData.length) return <div className="flex h-[300px] items-center justify-center text-sm text-gtext-muted">暂无 Token 使用数据</div>;

  return (
    <div className="h-[230px] min-w-0">
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
  if (!data.length) return <div className="flex min-h-[180px] items-center justify-center text-sm text-fg-muted">暂无成员消费数据</div>;

  return <div className="divide-y divide-border">{data.slice(0, 3).map((member, index) => <div key={member.id} className="flex items-center gap-3 py-3 first:pt-1 last:pb-1"><span className={cn('w-5 shrink-0 text-xs font-semibold tabular-nums', index === 0 ? 'text-indigo-600' : 'text-fg-muted')}>{String(index + 1).padStart(2, '0')}</span><Avatar name={member.name} src={member.avatar} className="h-9 w-9 shrink-0" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{member.name}</p><p className="mt-0.5 text-xs text-fg-muted">{member.calls} 次调用</p></div><span className="text-sm font-semibold tabular-nums text-foreground">{formatCost(member.cost)}</span></div>)}</div>;
}

export default function DashboardPage() {
  const { data, isLoading, isError } = useDashboard();
  const user = useAuthStore((state) => state.user);

  if (isLoading) return <PageFrame><div className="h-44 animate-pulse rounded-2xl bg-card" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-xl bg-card" />)}</div><div className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.9fr)]"><div className="h-[390px] animate-pulse rounded-2xl bg-card" /><div className="h-[390px] animate-pulse rounded-2xl bg-card" /></div></PageFrame>;
  if (isError || !data) return <PageFrame><div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-border bg-card text-sm text-fg-muted">工作台数据加载失败，请稍后重试</div></PageFrame>;

  const { stats, modelDistribution, tokenTrend, topMembers } = data;
  const displayName = user?.name || user?.email?.split('@')[0] || '朋友';
  return <PageFrame>
    <PageHero title={`早上好，${displayName}`} description="查看团队使用情况，继续推进今天的工作。" />
    <StatStrip items={[{ label: '硅基员工', value: stats.totalEmployees, icon: <Users className="h-4 w-4" />, tone: 'brand' }, { label: '本月对话', value: formatCompactNumber(stats.conversations.total), icon: <MessageSquareText className="h-4 w-4" />, tone: 'success' }, { label: '碳基员工', value: stats.totalMembers, icon: <BriefcaseBusiness className="h-4 w-4" />, tone: 'warning' }, { label: '本月算力', value: formatComputeUsage(stats.computeUsage.total), icon: <Gauge className="h-4 w-4" />, tone: 'info' }]} />

    <section className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.9fr)]"><SectionCard title="模型使用分析" description="最近 30 天各模型的调用次数与成本" action={<Link href="/usage" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover">查看完整报告 <ArrowUpRight className="h-3.5 w-3.5" /></Link>}><ModelDistributionChart data={modelDistribution} /></SectionCard><SectionCard title="成员使用情况" description="按最近消费金额排序" action={<Link href="/usage" className="text-sm font-medium text-primary hover:text-primary-hover">查看全部</Link>}><MemberUsageList data={topMembers} /></SectionCard></section>

    {tokenTrend.length > 0 && <SectionCard title="Token 使用趋势" description="最近 7 天 Input / Output 用量" action={<div className="rounded-lg bg-blue-50 p-2 text-blue-600 dark:bg-blue-950/35 dark:text-blue-300"><Cpu className="h-4 w-4" /></div>}><TokenTrendChart data={tokenTrend} /></SectionCard>}
  </PageFrame>;
}
