'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  FileText,
  KeyRound,
  Loader2,
  PauseCircle,
  PlayCircle,
  Settings2,
  Sparkles,
  XCircle,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState, CenteredSpinner } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuthStore } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast';
import {
  useSubscription,
  useUpdateSubscription,
  useChangeSubscriptionStatus,
} from '@/features/subscription/use-subscriptions';
import { useSubscriptionGrants } from '@/features/enterprise/use-enterprise';
import { useEmployeeDetail } from '@/features/employee/use-employee-detail';
import { useEmployeeStats } from '@/features/employee/use-employee-stats';
import type { CapabilityType, SubscriptionStatus } from '@/lib/types';

const STATUS_META: Record<SubscriptionStatus, { label: string; tone: string }> = {
  ACTIVE: {
    label: '使用中',
    tone: 'border-gsuccess/30 bg-gsuccess/12 text-gsuccess',
  },
  PAUSED: {
    label: '已暂停',
    tone: 'border-gwarning/30 bg-gwarning/12 text-gwarning',
  },
  EXPIRED: {
    label: '已结束',
    tone: 'border-gdanger/30 bg-gdanger/12 text-gdanger',
  },
};

const CAPABILITY_META: Record<CapabilityType, { label: string; tone: string }> = {
  AGENT: {
    label: 'Agent',
    tone: 'border-violet-400/30 bg-violet-400/10 text-violet-300',
  },
  RPA: {
    label: 'RPA',
    tone: 'border-blue-400/30 bg-blue-400/10 text-blue-300',
  },
  SKILL: {
    label: 'Skill',
    tone: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  },
  AI_APP: {
    label: 'AI App',
    tone: 'border-orange-400/30 bg-orange-400/10 text-orange-300',
  },
};

function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return '未设置';
  return new Date(value).toLocaleString(
    'zh-CN',
    withTime
      ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { year: 'numeric', month: 'long', day: 'numeric' },
  );
}

function formatDuration(value: number | null) {
  if (value == null || value <= 0) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`;
}

export default function EmployeeDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const router = useRouter();
  const { roleInEnterprise } = useAuthStore();
  const isAdmin = roleInEnterprise === 'ENTERPRISE_ADMIN';
  const [activeTab, setActiveTab] = useState('overview');
  const [days, setDays] = useState(7);

  const subscriptionQuery = useSubscription(id);
  const subscription = subscriptionQuery.data;
  const employeeId = subscription?.employee?.id ?? '';
  const employeeQuery = useEmployeeDetail(employeeId);
  const statsQuery = useEmployeeStats(employeeId, days);
  const grantsQuery = useSubscriptionGrants(id);
  const updateSubscription = useUpdateSubscription();
  const changeStatus = useChangeSubscriptionStatus();
  const [name, setName] = useState('');
  const [config, setConfig] = useState('');
  const [editing, setEditing] = useState(false);

  const status = subscription?.status as SubscriptionStatus | undefined;
  const statusMeta = (status && STATUS_META[status]) ?? {
    label: '已结束',
    tone: 'border-gdanger/30 bg-gdanger/12 text-gdanger',
  };
  const employee = employeeQuery.data;
  const stats = statsQuery.data;
  const activeName = name || subscription?.name || subscription?.employee?.name || '';
  const configValue = useMemo(() => {
    if (!subscription) return '{}';
    return config || JSON.stringify(subscription.config ?? {}, null, 2);
  }, [config, subscription]);

  if (subscriptionQuery.isLoading) return <CenteredSpinner label="加载员工详情..." />;
  if (subscriptionQuery.isError || !subscription)
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <EmptyState
          title="找不到这位硅基员工"
          description="雇佣关系可能已被移除，或你没有访问权限。"
          action={
            <Button variant="outline" onClick={() => router.push('/my-employees')}>
              返回我的员工
            </Button>
          }
        />
      </div>
    );

  const saveDetails = () => {
    let parsedConfig: Record<string, unknown>;
    try {
      parsedConfig = JSON.parse(configValue || '{}');
      if (!parsedConfig || Array.isArray(parsedConfig)) throw new Error('配置必须是 JSON 对象');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '配置 JSON 格式不正确');
      return;
    }
    updateSubscription.mutate(
      { id, name: activeName.trim() || null, config: parsedConfig },
      {
        onSuccess: () => {
          toast.success('员工配置已保存');
          setEditing(false);
          setConfig(JSON.stringify(parsedConfig, null, 2));
        },
        onError: (error) => toast.error(error instanceof ApiError ? error.message : '保存失败'),
      },
    );
  };

  const toggleStatus = () => {
    const next: SubscriptionStatus = status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    changeStatus.mutate(
      { id, status: next },
      {
        onSuccess: () => toast.success(next === 'ACTIVE' ? '已恢复使用' : '已暂停使用'),
        onError: (error) => toast.error(error instanceof ApiError ? error.message : '状态更新失败'),
      },
    );
  };

  const toggleEditing = () => {
    if (editing) {
      setName('');
      setConfig('');
      setEditing(false);
      return;
    }
    setName(subscription.name);
    setConfig(JSON.stringify(subscription.config ?? {}, null, 2));
    setEditing(true);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-sm text-gtext-secondary transition-colors hover:text-gtext-primary"
        >
          <ArrowLeft className="h-4 w-4" /> 返回我的硅基员工
        </button>
        {isAdmin && (status === 'ACTIVE' || status === 'PAUSED') && (
          <div className="flex items-center gap-2">
            <Button variant="glass" size="sm" onClick={toggleEditing}>
              <Settings2 className="h-4 w-4" />
              {editing ? '取消编辑' : '编辑配置'}
            </Button>
            <Button
              variant="glass"
              size="sm"
              onClick={toggleStatus}
              disabled={changeStatus.isPending}
            >
              {changeStatus.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : status === 'ACTIVE' ? (
                <PauseCircle className="h-4 w-4" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              {status === 'ACTIVE' ? '暂停使用' : '恢复使用'}
            </Button>
          </div>
        )}
      </div>

      <section className="glass-hero relative overflow-hidden p-6 sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-gbrand/20 blur-3xl"
        />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar
            name={activeName}
            src={subscription.employee.avatar}
            className="h-24 w-24 shrink-0 text-3xl ring-4 ring-gbrand/20"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold text-gtext-primary">{activeName}</h1>
              <Badge className={statusMeta.tone}>{statusMeta.label}</Badge>
              <span className="text-xs text-gtext-muted">v{subscription.templateVersion}</span>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gtext-secondary">
              {subscription.employee.description || '这位硅基员工还没有填写简介。'}
            </p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-gtext-muted">
              <span>{subscription.employee.position || '通用岗位'}</span>
              <span>{subscription.employee.industry || '通用行业'}</span>
              <span>雇佣于 {formatDate(subscription.startDate)}</span>
            </div>
          </div>
          <Button
            variant="glass-primary"
            onClick={() => router.push(`/chat?employeeId=${employeeId}`)}
            disabled={status !== 'ACTIVE'}
          >
            <Sparkles className="h-4 w-4" />
            开始对话
          </Button>
        </div>
      </section>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start overflow-x-auto bg-glass-1">
          <TabsTrigger value="overview">
            <Activity className="h-4 w-4" />
            概览
          </TabsTrigger>
          <TabsTrigger value="capabilities">
            <Zap className="h-4 w-4" />
            能力
          </TabsTrigger>
          <TabsTrigger value="monitoring">
            <BarChart3 className="h-4 w-4" />
            运行监控
          </TabsTrigger>
          <TabsTrigger value="config">
            <Settings2 className="h-4 w-4" />
            配置
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-5 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="近 7 天调用"
              value={stats?.summary.total ?? '—'}
              icon={<Activity className="h-4 w-4" />}
            />
            <Metric
              label="成功率"
              value={
                stats && stats.summary.total > 0
                  ? `${Math.round((stats.summary.successCount / stats.summary.total) * 100)}%`
                  : '—'
              }
              icon={<CheckCircle2 className="h-4 w-4" />}
              tone="success"
            />
            <Metric
              label="平均响应"
              value={stats ? formatDuration(stats.summary.avgDuration) : '—'}
              icon={<Clock3 className="h-4 w-4" />}
            />
            <Metric
              label="已配置能力"
              value={employee?.capabilities.length ?? '—'}
              icon={<Zap className="h-4 w-4" />}
              tone="brand"
            />
          </div>
          <div className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
            <Card className="p-5">
              <SectionTitle
                icon={<FileText className="h-4 w-4" />}
                title="最近执行"
                action={
                  <button
                    onClick={() => setActiveTab('monitoring')}
                    className="inline-flex items-center gap-1 text-xs text-gbrand-text hover:text-gbrand-text-hover"
                  >
                    查看监控
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                }
              />
              {statsQuery.isLoading ? (
                <CenteredSpinner label="加载执行记录..." />
              ) : (
                <ExecutionTable entries={stats?.recentLog ?? []} />
              )}
            </Card>
            <Card className="p-5">
              <SectionTitle icon={<KeyRound className="h-4 w-4" />} title="授权范围" />
              <div className="space-y-3">
                {grantsQuery.isLoading ? (
                  <CenteredSpinner label="加载授权..." />
                ) : grantsQuery.data?.length ? (
                  grantsQuery.data.map((grant) => (
                    <div
                      key={grant.id}
                      className="flex items-center justify-between border-b border-glassline pb-3 text-sm last:border-0 last:pb-0"
                    >
                      <span className="text-gtext-secondary">
                        {grant.department
                          ? `部门 · ${grant.department.name}`
                          : `成员 · ${grant.member?.name || grant.member?.email || '未命名'}`}
                      </span>
                      <span className={grant.expired ? 'text-gdanger' : 'text-gtext-muted'}>
                        {grant.expired
                          ? '已过期'
                          : grant.expiresAt
                            ? `至 ${formatDate(grant.expiresAt)}`
                            : '长期有效'}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gtext-muted">暂无授权记录</p>
                )}
              </div>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="capabilities" className="mt-5">
          <Card className="p-5">
            <SectionTitle icon={<Zap className="h-4 w-4" />} title="已绑定能力" />
            <div className="grid gap-3 md:grid-cols-2">
              {employeeQuery.isLoading ? (
                <CenteredSpinner label="加载能力..." />
              ) : employee?.capabilities.length ? (
                employee.capabilities.map((capability) => {
                  const meta = CAPABILITY_META[capability.type as CapabilityType] ?? {
                    label: capability.type,
                    tone: 'border-glassline bg-glass-2 text-gtext-secondary',
                  };
                  return (
                    <div
                      key={capability.id}
                      className="rounded-lg border border-glassline bg-glass-1 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gbrand/15 text-gbrand-text">
                            <Zap className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-gtext-primary">
                              {capability.name}
                            </p>
                            <p className="mt-0.5 text-xs text-gtext-muted">
                              执行顺序 {capability.order + 1}
                            </p>
                          </div>
                        </div>
                        <Badge className={meta.tone}>{meta.label}</Badge>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-gtext-secondary">
                        {capability.description || '暂无能力说明'}
                      </p>
                    </div>
                  );
                })
              ) : (
                <div className="md:col-span-2">
                  <EmptyState
                    icon={<Zap className="h-8 w-8" />}
                    title="暂未绑定能力"
                    description="该员工当前没有可调用的能力。"
                  />
                </div>
              )}
            </div>
          </Card>
        </TabsContent>
        <TabsContent value="monitoring" className="mt-5 space-y-5">
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionTitle icon={<BarChart3 className="h-4 w-4" />} title="调用趋势" />
              <div className="flex gap-1 rounded-md border border-glassline bg-glass-1 p-1">
                {[7, 30].map((value) => (
                  <button
                    key={value}
                    onClick={() => setDays(value)}
                    className={`rounded px-3 py-1 text-xs ${days === value ? 'bg-glass-3 text-gtext-primary' : 'text-gtext-muted hover:text-gtext-primary'}`}
                  >
                    近 {value} 天
                  </button>
                ))}
              </div>
            </div>
            {statsQuery.isLoading ? (
              <CenteredSpinner label="加载监控数据..." />
            ) : (
              <TrendChart points={stats?.trend ?? []} />
            )}
          </Card>
          <Card className="p-5">
            <SectionTitle icon={<FileText className="h-4 w-4" />} title="执行记录" />
            <ExecutionTable entries={stats?.recentLog ?? []} />
          </Card>
        </TabsContent>
        <TabsContent value="config" className="mt-5">
          <Card className="p-5">
            <SectionTitle icon={<Settings2 className="h-4 w-4" />} title="雇佣关系配置" />
            <div className="max-w-2xl space-y-5">
              {isAdmin ? (
                <>
                  <div>
                    <label className="mb-2 block text-xs font-medium text-gtext-secondary">
                      企业内称呼
                    </label>
                    {editing ? (
                      <Input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                      />
                    ) : (
                      <p className="rounded-md border border-glassline bg-glass-1 px-3 py-2 text-sm text-gtext-primary">
                        {activeName}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="mb-2 flex items-center gap-2 text-xs font-medium text-gtext-secondary">
                      <Code2 className="h-3.5 w-3.5" />
                      运行配置（JSON）
                    </label>
                    {editing ? (
                      <Textarea
                        value={configValue}
                        onChange={(event) => setConfig(event.target.value)}
                        rows={10}
                        className="font-mono text-xs"
                      />
                    ) : (
                      <pre className="max-h-64 overflow-auto rounded-md border border-glassline bg-glass-1 p-3 text-xs leading-5 text-gtext-secondary">
                        {configValue}
                      </pre>
                    )}
                  </div>
                  {editing && (
                    <div className="flex justify-end">
                      <Button
                        variant="glass-primary"
                        onClick={saveDetails}
                        loading={updateSubscription.isPending}
                      >
                        保存配置
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-md border border-glassline bg-glass-1 p-4">
                  <p className="text-sm font-medium text-gtext-primary">配置由企业管理员维护</p>
                  <p className="mt-1 text-xs leading-5 text-gtext-muted">
                    为保护运行凭据，成员账号不展示员工的连接与运行配置。
                  </p>
                </div>
              )}
              <div className="grid gap-3 border-t border-glassline pt-5 text-sm sm:grid-cols-2">
                <Info label="模板版本" value={`v${subscription.templateVersion}`} />
                <Info label="最近更新" value={formatDate(subscription.updatedAt)} />
                <Info label="开始日期" value={formatDate(subscription.startDate)} />
                <Info label="结束日期" value={formatDate(subscription.endDate)} />
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gtext-primary">
        <span className="text-gbrand-text">{icon}</span>
        {title}
      </h2>
      {action}
    </div>
  );
}
function Metric({
  label,
  value,
  icon,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone?: 'default' | 'success' | 'brand';
}) {
  const color =
    tone === 'success' ? 'text-gsuccess' : tone === 'brand' ? 'text-gbrand-text' : 'text-ginfo';
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gtext-muted">{label}</span>
        <span className={color}>{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-gtext-primary">{value}</p>
    </Card>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gtext-muted">{label}</p>
      <p className="mt-1 text-sm text-gtext-primary">{value}</p>
    </div>
  );
}
function ExecutionTable({
  entries,
}: {
  entries: Array<{
    id: string;
    toolName: string;
    status: string;
    duration: number | null;
    createdAt: string;
  }>;
}) {
  if (entries.length === 0)
    return <p className="py-8 text-center text-sm text-gtext-muted">暂无执行记录</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead>
          <tr className="border-b border-glassline text-xs text-gtext-muted">
            <th className="pb-2 font-medium">能力</th>
            <th className="pb-2 font-medium">状态</th>
            <th className="pb-2 font-medium">耗时</th>
            <th className="pb-2 text-right font-medium">时间</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-glassline/60 last:border-0">
              <td className="py-3 text-gtext-primary">{entry.toolName}</td>
              <td className="py-3">
                {entry.status === 'SUCCESS' ? (
                  <span className="inline-flex items-center gap-1 text-xs text-gsuccess">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    成功
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-gdanger">
                    <XCircle className="h-3.5 w-3.5" />
                    失败
                  </span>
                )}
              </td>
              <td className="py-3 text-xs text-gtext-secondary">
                {formatDuration(entry.duration)}
              </td>
              <td className="py-3 text-right text-xs text-gtext-muted">
                {formatDate(entry.createdAt, true)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function TrendChart({
  points,
}: {
  points: Array<{
    date: string;
    total: number;
    success: number;
    failed: number;
  }>;
}) {
  const max = Math.max(...points.map((point) => point.total), 1);
  return points.length === 0 ? (
    <p className="py-12 text-center text-sm text-gtext-muted">暂无监控数据</p>
  ) : (
    <div className="space-y-3">
      {points.map((point) => (
        <div key={point.date} className="grid grid-cols-[72px_1fr_40px] items-center gap-3 text-xs">
          <span className="text-gtext-muted">{point.date.slice(5)}</span>
          <div className="h-2 overflow-hidden rounded-full bg-glass-2">
            <div
              className="h-full rounded-full bg-gbrand-text transition-all"
              style={{
                width: `${Math.max((point.total / max) * 100, point.total ? 3 : 0)}%`,
              }}
            />
          </div>
          <span className="text-right text-gtext-secondary">{point.total}</span>
        </div>
      ))}
    </div>
  );
}
