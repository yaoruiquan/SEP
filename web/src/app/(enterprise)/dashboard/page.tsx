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

function formatCompactNumber(value: number) {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)} 亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万`;
  return numberFormatter.format(value);
}

function formatDate(value: string) {
  const parts = value.split('-');
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : value;
}

function formatModelName(model: string) {
  return model.length > 22 ? `${model.slice(0, 20)}...` : model;
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
    pink: 'bg-pink-50 text-pink-500 ring-pink-100',
    green: 'bg-emerald-50 text-emerald-500 ring-emerald-100',
    orange: 'bg-orange-50 text-orange-500 ring-orange-100',
    blue: 'bg-sky-50 text-sky-500 ring-sky-100',
  };

  return (
    <div className="group rounded-[22px] border border-black/[0.06] bg-white/85 p-5 shadow-[0_12px_32px_rgba(31,38,135,0.06)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_38px_rgba(31,38,135,0.1)]">
      <div className="flex items-start justify-between gap-3">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-2xl ring-1', tones[tone])}>
          <Icon className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <ArrowUpRight className="h-4 w-4 text-black/20 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
      <p className="mt-5 text-[13px] font-medium text-black/50">{label}</p>
      <p className="mt-1 text-[30px] font-semibold tracking-[-0.04em] text-[#20212a]">{value}</p>
      <p className="mt-2 text-xs text-black/40">{detail}</p>
    </div>
  );
}

function ModelDistributionChart({ data }: { data: ModelDistribution[] }) {
  const totalRequests = data.reduce((sum, item) => sum + item.requests, 0);
  const chartData = data.slice(0, 6).map((item) => ({ ...item, displayName: formatModelName(item.model) }));

  if (!chartData.length) {
    return <div className="flex h-[300px] items-center justify-center text-sm text-black/35">暂无模型调用数据</div>;
  }

  return (
    <div className="grid items-center gap-5 lg:grid-cols-[minmax(220px,0.9fr)_1.1fr]">
      <div className="relative h-[270px] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={chartData} dataKey="requests" nameKey="displayName" innerRadius="58%" outerRadius="82%" paddingAngle={2} stroke="none">
              {chartData.map((item, index) => <Cell key={item.model} fill={MODEL_COLORS[index % MODEL_COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(value) => [`${numberFormatter.format(Number(value))} 次`, '请求']} contentStyle={{ borderRadius: 12, border: '1px solid rgba(0,0,0,.08)', boxShadow: '0 8px 24px rgba(0,0,0,.08)' }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-semibold tracking-[-0.04em] text-[#252630]">{formatCompactNumber(totalRequests)}</span><span className="mt-1 text-xs text-black/40">总请求</span></div>
      </div>
      <div className="min-w-0 space-y-1">
        <div className="grid grid-cols-[minmax(0,1fr)_64px_78px] gap-3 border-b border-black/[0.07] px-2 pb-3 text-xs font-semibold text-black/40"><span>模型</span><span className="text-right">请求</span><span className="text-right">成本</span></div>
        {chartData.map((item, index) => <div key={item.model} className="grid grid-cols-[minmax(0,1fr)_64px_78px] items-center gap-3 border-b border-black/[0.05] px-2 py-3 last:border-0"><span className="flex min-w-0 items-center gap-2 text-sm font-medium text-[#30313b]" title={item.model}><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: MODEL_COLORS[index % MODEL_COLORS.length] }} /><span className="truncate">{item.displayName}</span></span><span className="text-right text-xs text-black/55">{numberFormatter.format(item.requests)}</span><span className="text-right text-xs font-semibold text-emerald-600">¥{item.cost.toFixed(2)}</span></div>)}
      </div>
    </div>
  );
}

function TokenTrendChart({ data }: { data: TokenTrend[] }) {
  const chartData = data.map((item) => ({ ...item, label: formatDate(item.date) }));
  if (!chartData.length) return <div className="flex h-[300px] items-center justify-center text-sm text-black/35">暂无 Token 使用数据</div>;

  return (
    <div className="h-[315px] min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
          <defs><linearGradient id="inputTokens" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} /></linearGradient><linearGradient id="outputTokens" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#14b8a6" stopOpacity={0.25} /><stop offset="95%" stopColor="#14b8a6" stopOpacity={0.02} /></linearGradient></defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,.08)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'rgba(0,0,0,.4)' }} tickLine={false} axisLine={false} minTickGap={20} />
          <YAxis tick={{ fontSize: 11, fill: 'rgba(0,0,0,.4)' }} tickLine={false} axisLine={false} tickFormatter={(value) => formatCompactNumber(Number(value))} width={48} />
          <Tooltip formatter={(value, name) => [formatCompactNumber(Number(value)), name === 'input' ? 'Input' : 'Output']} labelFormatter={(label) => `日期 ${label}`} contentStyle={{ borderRadius: 12, border: '1px solid rgba(0,0,0,.08)', boxShadow: '0 8px 24px rgba(0,0,0,.08)' }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: 'rgba(0,0,0,.55)' }} formatter={(value) => value === 'input' ? 'Input' : 'Output'} />
          <Area type="monotone" dataKey="input" stroke="#3b82f6" strokeWidth={2.5} fill="url(#inputTokens)" dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 5 }} />
          <Area type="monotone" dataKey="output" stroke="#14b8a6" strokeWidth={2.5} fill="url(#outputTokens)" dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 5 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function MemberUsageList({ data }: { data: TopMember[] }) {
  if (!data.length) return <div className="flex h-48 items-center justify-center text-sm text-black/35">暂无成员消费数据</div>;
  const maxCost = Math.max(...data.map((item) => item.cost), 1);

  return <div className="space-y-4">{data.slice(0, 5).map((member, index) => <div key={member.id} className="grid grid-cols-[32px_minmax(0,1fr)_86px] items-center gap-3"><span className={cn('flex h-7 w-7 items-center justify-center rounded-lg text-xs font-semibold', index === 0 ? 'bg-blue-100 text-blue-600' : 'bg-black/[0.04] text-black/45')}>{String(index + 1).padStart(2, '0')}</span><div className="min-w-0"><div className="mb-1.5 flex items-center justify-between gap-2"><span className="truncate text-sm font-medium text-[#252630]">{member.name}</span><span className="shrink-0 text-xs text-black/45">{member.calls} 次调用</span></div><div className="h-2 overflow-hidden rounded-full bg-black/[0.05]"><div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" style={{ width: `${Math.max((member.cost / maxCost) * 100, 3)}%` }} /></div></div><span className="text-right text-sm font-semibold text-[#252630]">¥{member.cost.toFixed(2)}</span></div>)}</div>;
}

export default function DashboardPage() {
  const { data, isLoading, isError } = useDashboard();

  if (isLoading) return <div className="space-y-6"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <div key={item} className="h-40 animate-pulse rounded-[22px] bg-white/60" />)}</div><div className="grid gap-6 xl:grid-cols-2"><div className="h-[430px] animate-pulse rounded-[24px] bg-white/60" /><div className="h-[430px] animate-pulse rounded-[24px] bg-white/60" /></div><div className="h-72 animate-pulse rounded-[24px] bg-white/60" /></div>;
  if (isError || !data) return <div className="flex min-h-[420px] items-center justify-center rounded-[28px] border border-black/[0.06] bg-white/75 text-sm text-black/45">工作台数据加载失败，请稍后重试</div>;

  const { stats, modelDistribution, tokenTrend, topMembers } = data;
  const conversationTrend = stats.conversations.trend;
  const computeTrend = stats.computeUsage.trend;

  return <div className="mx-auto max-w-[1480px] space-y-6 pb-8">
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard icon={Users} tone="pink" label="雇佣员工" value={stats.totalEmployees} detail={`${stats.activeEmployees} 位正在活跃`} /><MetricCard icon={MessageSquareText} tone="green" label="本月对话" value={formatCompactNumber(stats.conversations.total)} detail={`${conversationTrend >= 0 ? '+' : ''}${conversationTrend}% 较上月`} /><MetricCard icon={BriefcaseBusiness} tone="orange" label="组织规模" value={stats.totalMembers} detail={`${stats.totalDepartments} 个部门`} /><MetricCard icon={Gauge} tone="blue" label="本月算力" value={formatCompactNumber(stats.computeUsage.total)} detail={`${computeTrend >= 0 ? '+' : ''}${computeTrend}% 较上月`} /></section>

    <section className="grid gap-6 xl:grid-cols-2"><div className="rounded-[24px] border border-black/[0.06] bg-white/85 p-6 shadow-[0_12px_32px_rgba(31,38,135,0.06)] sm:p-7"><div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-500">Model mix</p><h2 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[#252630]">模型分布</h2><p className="mt-1 text-xs text-black/40">按请求次数统计模型使用情况</p></div><Link href="/usage" className="inline-flex items-center gap-1 text-xs font-semibold text-black/45 transition-colors hover:text-blue-600">查看用量 <ArrowUpRight className="h-3.5 w-3.5" /></Link></div><ModelDistributionChart data={modelDistribution} /></div><div className="rounded-[24px] border border-black/[0.06] bg-white/85 p-6 shadow-[0_12px_32px_rgba(31,38,135,0.06)] sm:p-7"><div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-500">Token activity</p><h2 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[#252630]">Token 使用趋势</h2><p className="mt-1 text-xs text-black/40">最近 7 天 Input / Output 用量</p></div><div className="rounded-xl bg-teal-50 p-2 text-teal-500"><Cpu className="h-4 w-4" /></div></div><TokenTrendChart data={tokenTrend} /></div></section>

    <section className="rounded-[24px] border border-black/[0.06] bg-white/85 p-6 shadow-[0_12px_32px_rgba(31,38,135,0.06)] sm:p-7"><div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-500">Member activity</p><h2 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[#252630]">最近使用成员</h2><p className="mt-1 text-xs text-black/40">按最近消费金额排序</p></div><div className="rounded-xl bg-orange-50 p-2 text-orange-500"><Users className="h-4 w-4" /></div></div><MemberUsageList data={topMembers} /><Link href="/usage" className="mt-6 flex items-center justify-end gap-1 border-t border-black/[0.06] pt-4 text-xs font-medium text-blue-600 transition-colors hover:text-blue-700">查看完整用量报告 <ChevronRight className="h-4 w-4" /></Link></section>
  </div>;
}
