'use client';

import Link from 'next/link';
import {
  Building2, Users, Zap, Activity,
  TrendingUp, TrendingDown, ArrowRight,
  AlertTriangle, Inbox, RefreshCw, Plus, UserPlus, Layers,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { CenteredSpinner, EmptyState, Skeleton } from '@/components/ui/feedback';
import { useAdminStats, type AdminStats } from '@/features/admin/use-admin-stats';
import { CHART_GRID, CHART_AXIS_TICK, CHART_TOOLTIP_STYLE, CHART_TOOLTIP_LABEL_STYLE, CHART_SERIES } from '@/lib/chart-theme';

// ─── 工具函数 ───────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  AGENT: 'border-glassline bg-glass-2 text-gneon-purple',
  SKILL: 'border-glassline bg-glass-2 text-gwarning',
  AI_APP: 'border-glassline bg-glass-2 text-gneon-blue',
  RPA: 'border-glassline bg-glass-2 text-gneon-green',
};

function fmtNumber(n: number) {
  return n >= 10000 ? `${(n / 10000).toFixed(1)}w` : n.toLocaleString();
}

function fmtMoney(n: number) {
  return `¥${n.toFixed(2)}`;
}

// ─── KPI 卡片 ───────────────────────────────────────────────────────────────

interface KpiItem {
  label: string;
  value: string | number;
  unit?: string;
  sub: string;
  trend: number;
  trendLabel: string;
  icon: typeof Building2;
  color: string;
  bg: string;
}

function buildKpi(kpi: AdminStats['kpi']): KpiItem[] {
  return [
    {
      label: '企业总数',
      value: kpi.totalEnterprises,
      sub: kpi.suspendedEnterprises > 0 ? `其中冻结 ${kpi.suspendedEnterprises} 家` : '暂无冻结企业',
      trend: kpi.enterpriseTrendPct,
      trendLabel: '较上月',
      icon: Building2,
      color: 'text-gneon-blue',
      bg: 'border border-glassline bg-glass-2',
    },
    {
      label: '已上架员工',
      value: kpi.totalEmployees,
      sub: kpi.pendingEmployees > 0 ? `待审核 ${kpi.pendingEmployees} 位` : '无待审核',
      trend: kpi.employeeTrendPct,
      trendLabel: '较上月',
      icon: Users,
      color: 'text-gneon-purple',
      bg: 'border border-glassline bg-glass-2',
    },
    {
      label: '今日算力消费',
      value: fmtMoney(kpi.todayTokens),
      sub: kpi.pendingCapabilities > 0 ? `待审核能力 ${kpi.pendingCapabilities} 个` : '能力审核已清空',
      trend: kpi.tokenTrendPct,
      trendLabel: '较昨日',
      icon: Zap,
      color: 'text-gwarning',
      bg: 'border border-glassline bg-glass-2',
    },
    {
      label: '今日活跃用户',
      value: kpi.todayActiveUsers,
      sub: '按发起会话的去重用户统计',
      trend: kpi.userTrendPct,
      trendLabel: '较昨日',
      icon: Activity,
      color: 'text-gneon-green',
      bg: 'border border-glassline bg-glass-2',
    },
  ];
}

function KpiCard({ item }: { item: KpiItem }) {
  const Icon = item.icon;
  const up = item.trend > 0;
  const flat = item.trend === 0;
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-fg-muted">{item.label}</p>
            <p className="mt-1 text-3xl font-bold">
              {item.value}
              {item.unit && (
                <span className="ml-1 text-sm font-normal text-fg-muted">{item.unit}</span>
              )}
            </p>
            <p className="mt-1 text-xs text-fg-subtle">{item.sub}</p>
          </div>
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${item.bg}`}>
            <Icon className={`h-5 w-5 ${item.color}`} />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-1 text-xs">
          {flat ? (
            <span className="text-fg-subtle">— 持平</span>
          ) : (
            <>
              {up ? (
                <TrendingUp className="h-3.5 w-3.5 text-gneon-green" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-gdanger" />
              )}
              <span className={up ? 'text-gneon-green' : 'text-gdanger'}>
                {up ? '+' : ''}{item.trend}%
              </span>
            </>
          )}
          <span className="text-fg-subtle">{item.trendLabel}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="flex h-[200px] items-center justify-center text-sm text-fg-subtle">
      {label}
    </div>
  );
}

// ─── 主页面 ─────────────────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const { data, isLoading, isFetching, error, refetch } = useAdminStats();

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[140px]" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-[260px]" />
          <Skeleton className="h-[260px]" />
        </div>
        <CenteredSpinner label="正在加载平台数据…" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8 text-danger" />}
          title="数据加载失败"
          description={error instanceof Error ? error.message : '无法获取平台统计数据'}
          action={
            <Button variant="glass" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              重试
            </Button>
          }
        />
      </div>
    );
  }

  const kpiItems = buildKpi(data.kpi);
  const hasComputeData = data.computeTrend.some((d) => d.tokens > 0);
  const hasEnterpriseData = data.enterpriseTrend.some((d) => d.count > 0);

  return (
    <div className="space-y-6 p-6">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">运营仪表盘</h1>
          <p className="mt-0.5 text-sm text-fg-muted">平台全局数据概览 · 每 60 秒自动刷新</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="border border-glassline bg-glass-accent-2 px-3 py-1 text-gneon-green">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-gneon-green" />
            数据正常
          </Badge>
          <Button
            variant="glass"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* 快速操作 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Link href="/admin/employees/new">
          <Card className="cursor-pointer border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10 transition-all hover:border-primary/40 hover:shadow-lg">
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <UserPlus className="h-7 w-7" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold">创建数字员工</h3>
                <p className="text-sm text-fg-muted">上架新员工，组合能力开始服务</p>
              </div>
              <ArrowRight className="h-5 w-5 text-primary" />
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/capabilities/new">
          <Card className="cursor-pointer border-2 border-purple-500/20 bg-gradient-to-br from-purple-500/5 to-purple-500/10 transition-all hover:border-purple-500/40 hover:shadow-lg">
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-500 text-white">
                <Layers className="h-7 w-7" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold">上架新能力</h3>
                <p className="text-sm text-fg-muted">集成 Coze、Skill、RPA 等能力</p>
              </div>
              <ArrowRight className="h-5 w-5 text-purple-500" />
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* KPI 卡片 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpiItems.map((item) => (
          <KpiCard key={item.label} item={item} />
        ))}
      </div>

      {/* 趋势图 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 算力消费趋势 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">近 30 天算力消费趋势</CardTitle>
          </CardHeader>
          <CardContent>
            {hasComputeData ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={data.computeTrend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradTokens" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_SERIES.purple} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={CHART_SERIES.purple} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="date" tick={{ ...CHART_AXIS_TICK, fontSize: 11 }} tickLine={false} interval={4} />
                  <YAxis tick={{ ...CHART_AXIS_TICK, fontSize: 11 }} tickLine={false} />
                  <Tooltip
                    formatter={(v) => [fmtMoney(Number(v)), '消费']}
                    contentStyle={CHART_TOOLTIP_STYLE}
                    labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                  />
                  <Area
                    type="monotone"
                    dataKey="tokens"
                    stroke={CHART_SERIES.purple}
                    strokeWidth={2}
                    fill="url(#gradTokens)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmpty label="近 30 天暂无算力消费记录" />
            )}
          </CardContent>
        </Card>

        {/* 新增企业趋势 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">近 30 天新增企业</CardTitle>
          </CardHeader>
          <CardContent>
            {hasEnterpriseData ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.enterpriseTrend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="date" tick={{ ...CHART_AXIS_TICK, fontSize: 11 }} tickLine={false} interval={4} />
                  <YAxis tick={{ ...CHART_AXIS_TICK, fontSize: 11 }} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    formatter={(v) => [`${Number(v).toLocaleString()} 家`, '新增企业']}
                    contentStyle={CHART_TOOLTIP_STYLE}
                    labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                  />
                  <Bar dataKey="count" fill={CHART_SERIES.primary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmpty label="近 30 天暂无新增企业" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* 排行榜 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Top 10 企业 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Top 10 企业（算力消费）</CardTitle>
            <Link href="/admin/enterprises" className="flex items-center gap-1 text-xs text-primary hover:underline">
              全部 <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className={data.topEnterprises.length ? 'p-0' : undefined}>
            {data.topEnterprises.length === 0 ? (
              <EmptyState
                icon={<Inbox className="h-6 w-6" />}
                title="暂无消费数据"
                description="企业产生算力消费后将在此排名"
              />
            ) : (
              <div className="divide-y divide-border">
                {data.topEnterprises.map((ent, i) => (
                  <Link
                    key={ent.id}
                    href={`/admin/enterprises/${ent.id}`}
                    className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <span className={`w-5 text-center text-sm font-bold ${
                      i < 3 ? 'text-gwarning' : 'text-fg-subtle'
                    }`}>
                      {i + 1}
                    </span>
                    <Avatar name={ent.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{ent.name}</p>
                    </div>
                    <p className="text-right text-sm font-semibold">{fmtMoney(ent.tokens)}</p>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top 10 员工 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Top 10 热门员工（会话数）</CardTitle>
            <Link href="/admin/employees" className="flex items-center gap-1 text-xs text-primary hover:underline">
              全部 <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className={data.topEmployees.length ? 'p-0' : undefined}>
            {data.topEmployees.length === 0 ? (
              <EmptyState
                icon={<Inbox className="h-6 w-6" />}
                title="暂无会话数据"
                description="用户与员工对话后将在此排名"
              />
            ) : (
              <div className="divide-y divide-border">
                {data.topEmployees.map((emp, i) => (
                  <Link
                    key={emp.id}
                    href={`/admin/employees/${emp.id}`}
                    className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <span className={`w-5 text-center text-sm font-bold ${
                      i < 3 ? 'text-gwarning' : 'text-fg-subtle'
                    }`}>
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{emp.name}</p>
                    </div>
                    <Badge className={`${TYPE_COLORS[emp.type] ?? 'bg-muted text-fg-muted'} border-0 text-xs`}>
                      {emp.type}
                    </Badge>
                    <p className="w-14 text-right text-sm font-semibold">
                      {fmtNumber(emp.calls)}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 待处理事项 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">待处理事项</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.kpi.pendingEmployees === 0 &&
           data.kpi.pendingCapabilities === 0 &&
           data.kpi.suspendedEnterprises === 0 ? (
            <p className="py-4 text-center text-sm text-fg-subtle">暂无待处理事项</p>
          ) : (
            <>
              {data.kpi.pendingEmployees > 0 && (
                <Link
                  href="/admin/audit"
                  className="fake-glass flex items-start gap-3 rounded-glass-md border border-gwarning/25 px-4 py-3 transition-colors hover:border-gwarning/40 hover:bg-gwarning/8"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-gwarning" />
                  <p className="flex-1 text-sm">
                    有 <strong>{data.kpi.pendingEmployees}</strong> 位员工待审核
                  </p>
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />
                </Link>
              )}
              {data.kpi.pendingCapabilities > 0 && (
                <Link
                  href="/admin/audit"
                  className="fake-glass flex items-start gap-3 rounded-glass-md border border-gwarning/25 px-4 py-3 transition-colors hover:border-gwarning/40 hover:bg-gwarning/8"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-gwarning" />
                  <p className="flex-1 text-sm">
                    有 <strong>{data.kpi.pendingCapabilities}</strong> 个能力待审核
                  </p>
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />
                </Link>
              )}
              {data.kpi.suspendedEnterprises > 0 && (
                <Link
                  href="/admin/enterprises"
                  className="fake-glass flex items-start gap-3 rounded-glass-md border border-gdanger/25 px-4 py-3 transition-colors hover:border-gdanger/40 hover:bg-gdanger/8"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-gdanger" />
                  <p className="flex-1 text-sm">
                    有 <strong>{data.kpi.suspendedEnterprises}</strong> 家企业处于冻结状态
                  </p>
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />
                </Link>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
