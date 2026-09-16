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
  Eye,
  GitFork,
  KeyRound,
  Settings2,
  Sparkles,
  Users,
  XCircle,
  Zap,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
} from '@/features/subscription/use-subscriptions';
import { useSubscriptionGrants } from '@/features/enterprise/use-enterprise';
import { useEmployeeDetail } from '@/features/employee/use-employee-detail';
import {
  useSubscriptionEmployeeStats,
  type EmployeeStats,
} from '@/features/employee/use-employee-stats';
import type { CapabilityType, SubscriptionStatus } from '@/lib/types';
import { SkillVersionPreviewDialog } from '@/features/skill-version/SkillVersionPreviewDialog';
import {
  useCreateEnterpriseSkillVersion,
  useEmployeeSkillVersions,
  useSelectSkillVersion,
} from '@/features/skill-version/use-skill-version';

const STATUS_META: Record<SubscriptionStatus, { label: string; tone: string }> =
  {
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
    TERMINATED: {
      label: '已解聘',
      tone: 'border-gdanger/30 bg-gdanger/12 text-gdanger',
    },
  };

const CAPABILITY_META: Record<CapabilityType, { label: string; tone: string }> =
  {
    AGENT: {
      label: 'Agent',
      tone: 'border-violet-400/30 bg-violet-400/10 text-violet-700 dark:text-violet-300',
    },
    RPA: {
      label: 'RPA',
      tone: 'border-blue-400/30 bg-blue-400/10 text-blue-700 dark:text-blue-300',
    },
    SKILL: {
      label: 'Skill',
      tone: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300',
    },
    AI_APP: {
      label: 'AI App',
      tone: 'border-orange-400/30 bg-orange-400/10 text-orange-700 dark:text-orange-300',
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
  const employeeQuery = useEmployeeDetail(subscription ? id : '');
  const statsQuery = useSubscriptionEmployeeStats(subscription ? id : '', days);
  const grantsQuery = useSubscriptionGrants(isAdmin ? id : '');
  const updateSubscription = useUpdateSubscription();
  const [name, setName] = useState('');
  const [config, setConfig] = useState('');
  const [editing, setEditing] = useState(false);
  const [previewVersionId, setPreviewVersionId] = useState('');

  const status = subscription?.status as SubscriptionStatus | undefined;
  const statusMeta = (status && STATUS_META[status]) ?? {
    label: '已结束',
    tone: 'border-gdanger/30 bg-gdanger/12 text-gdanger',
  };
  const employee = employeeQuery.data;
  const skillVersionsQuery = useEmployeeSkillVersions(employeeId);
  const createSkillVersion = useCreateEnterpriseSkillVersion();
  const selectSkillVersion = useSelectSkillVersion(employeeId);
  const stats = statsQuery.data;
  const activeName =
    name || subscription?.name || subscription?.employee?.name || '';
  const configValue = useMemo(() => {
    if (!subscription) return '{}';
    return config || JSON.stringify(subscription.config ?? {}, null, 2);
  }, [config, subscription]);

  if (subscriptionQuery.isLoading)
    return <CenteredSpinner label="加载员工详情..." />;
  if (subscriptionQuery.isError || !subscription)
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <EmptyState
          title="找不到这位硅基员工"
          description="雇佣关系可能已被移除，或你没有访问权限。"
          action={
            <Button
              variant="outline"
              onClick={() => router.push('/my-employees')}
            >
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
      if (
        !parsedConfig ||
        typeof parsedConfig !== 'object' ||
        Array.isArray(parsedConfig)
      )
        throw new Error('配置必须是 JSON 对象');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : '配置 JSON 格式不正确',
      );
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
        onError: (error) =>
          toast.error(error instanceof ApiError ? error.message : '保存失败'),
      },
    );
  };

  const toggleEditing = () => {
    setActiveTab('config');
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
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => router.push('/my-employees')}
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
          </div>
        )}
      </div>

      <section className="border-y border-border bg-blue-50/30 px-4 py-5 dark:bg-white/5 sm:px-6">
        <div className="flex flex-wrap items-center gap-5">
          <Avatar
            name={activeName}
            src={subscription.employee.avatar}
            portrait
            fullBody
            focalPoint="50% 35%"
            className="h-28 w-20 shrink-0 rounded-lg sm:h-36 sm:w-28"
          />
          <div className="min-w-0 flex-1 basis-36 sm:basis-44">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold text-gtext-primary">
                {activeName}
              </h1>
              <Badge className={statusMeta.tone}>{statusMeta.label}</Badge>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gtext-secondary">
              {subscription.employee.description ||
                '这位硅基员工还没有填写简介。'}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-gtext-muted">
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gtext-secondary">
          {isAdmin ? '本企业使用情况' : '我的使用情况'}
          <span className="ml-3 text-gtext-muted">近 {days} 天</span>
        </p>
        <div
          aria-label="统计时间范围"
          className="inline-flex rounded-md border border-border bg-muted p-1"
        >
          {[7, 30].map((value) => (
            <button
              key={value}
              aria-pressed={days === value}
              onClick={() => setDays(value)}
              className={`rounded px-3 py-1.5 text-sm ${days === value ? 'bg-card font-medium text-foreground shadow-sm' : 'text-fg-muted'}`}
            >
              近 {value} 天
            </button>
          ))}
        </div>
      </div>
      {statsQuery.isError && (
        <LoadError
          title="运行数据加载失败"
          onRetry={() => void statsQuery.refetch()}
        />
      )}

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
            运行情况
          </TabsTrigger>
          <TabsTrigger value="config">
            <Settings2 className="h-4 w-4" />
            配置
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-5 space-y-5">
          <div className="grid grid-cols-2 gap-x-5 gap-y-4 border-b border-border pb-5 md:grid-cols-3 xl:grid-cols-6">
            <Metric
              label="模型调用"
              value={
                statsQuery.isError ? '—' : (stats?.summary.callCount ?? '—')
              }
              icon={<Activity className="h-4 w-4" />}
            />
            <Metric
              label="能力执行成功率"
              value={
                !statsQuery.isError && stats && stats.summary.total > 0
                  ? `${Math.round((stats.summary.successCount / stats.summary.total) * 100)}%`
                  : '—'
              }
              icon={<CheckCircle2 className="h-4 w-4" />}
              tone="success"
            />
            <Metric
              label="平均执行耗时"
              value={
                !statsQuery.isError && stats
                  ? formatDuration(stats.summary.avgDuration)
                  : '—'
              }
              icon={<Clock3 className="h-4 w-4" />}
            />
            <Metric
              label="已配置能力"
              value={employee?.capabilities.length ?? '—'}
              icon={<Zap className="h-4 w-4" />}
              tone="brand"
            />
            <Metric
              label="Token 用量"
              value={
                !statsQuery.isError && stats
                  ? stats.summary.totalTokens.toLocaleString()
                  : '—'
              }
              icon={<Zap className="h-4 w-4" />}
            />
            <Metric
              label="算力消费"
              value={
                !statsQuery.isError && stats
                  ? `¥${stats.summary.costCNY.toFixed(4)}`
                  : '—'
              }
              icon={<Wallet className="h-4 w-4" />}
              tone="brand"
            />
          </div>
          <div
            className={`grid gap-6 ${isAdmin ? 'lg:grid-cols-[1.5fr_1fr]' : ''}`}
          >
            <section className="min-w-0">
              <SectionTitle
                icon={<FileText className="h-4 w-4" />}
                title="最近执行"
                action={
                  <button
                    onClick={() => setActiveTab('monitoring')}
                    className="inline-flex items-center gap-1 text-xs text-gbrand-text hover:text-gbrand-text-hover"
                  >
                    查看运行情况
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                }
              />
              {statsQuery.isLoading ? (
                <CenteredSpinner label="加载执行记录..." />
              ) : statsQuery.isError ? null : (
                <ExecutionTable entries={stats?.recentLog ?? []} />
              )}
              <p className="mt-3 text-xs leading-5 text-gtext-muted">
                云端能力执行，仅包含可归属当前雇佣关系的记录。
              </p>
            </section>
            {isAdmin && (
              <section className="min-w-0 lg:border-l lg:border-border lg:pl-6">
                <SectionTitle
                  icon={<KeyRound className="h-4 w-4" />}
                  title="授权范围"
                />
                <div className="space-y-3">
                  {grantsQuery.isLoading ? (
                    <CenteredSpinner label="加载授权..." />
                  ) : grantsQuery.isError ? (
                    <LoadError
                      title="授权范围加载失败"
                      onRetry={() => void grantsQuery.refetch()}
                    />
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
                        <span
                          className={
                            grant.expired ? 'text-gdanger' : 'text-gtext-muted'
                          }
                        >
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
              </section>
            )}
          </div>
        </TabsContent>
        <TabsContent value="capabilities" className="mt-5">
          <section>
            <SectionTitle
              icon={<Zap className="h-4 w-4" />}
              title="已绑定能力"
            />
            <div className="grid gap-3 md:grid-cols-2">
              {employeeQuery.isLoading ? (
                <CenteredSpinner label="加载能力..." />
              ) : employeeQuery.isError ? (
                <LoadError
                  title="能力加载失败"
                  onRetry={() => void employeeQuery.refetch()}
                />
              ) : employee?.capabilities.length ? (
                employee.capabilities.map((capability) => {
                  const skill = skillVersionsQuery.data?.skills.find(
                    (item) => item.capability.id === capability.id,
                  );
                  const meta = CAPABILITY_META[
                    capability.type as CapabilityType
                  ] ?? {
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
                      <p className="mt-3 text-sm leading-6 text-gtext-secondary">
                        {capability.description || '暂无能力说明'}
                      </p>
                      {capability.type === 'SKILL' && (
                        <div className="mt-4 space-y-3 border-t border-glassline pt-3">
                          {skillVersionsQuery.isLoading ? (
                            <p className="text-xs text-gtext-muted">
                              加载技能版本...
                            </p>
                          ) : skillVersionsQuery.isError ? (
                            <LoadError
                              title="技能版本加载失败"
                              onRetry={() => void skillVersionsQuery.refetch()}
                            />
                          ) : skill?.currentVersion ? (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                <span className="text-gtext-muted">
                                  当前 v{skill.currentVersion.version} ·{' '}
                                  {skill.currentVersion.scope === 'PLATFORM'
                                    ? '平台'
                                    : '企业'}
                                </span>
                                {skill.upgradeAvailable && (
                                  <Badge className="border-gwarning/30 bg-gwarning/10 text-gwarning">
                                    有新版本
                                  </Badge>
                                )}
                              </div>
                              {isAdmin && skill.versions.length > 1 && (
                                <select
                                  aria-label={`选择 ${capability.name} 版本`}
                                  value={skill.currentVersion.id}
                                  onChange={(event) =>
                                    selectSkillVersion.mutate(
                                      {
                                        subscriptionId:
                                          skillVersionsQuery.data!
                                            .subscriptionId,
                                        capabilityId: capability.id,
                                        versionId: event.target.value,
                                      },
                                      {
                                        onSuccess: () =>
                                          toast.success('技能版本已切换'),
                                        onError: (error) =>
                                          toast.error(
                                            error instanceof Error
                                              ? error.message
                                              : '版本切换失败',
                                          ),
                                      },
                                    )
                                  }
                                  className="h-9 w-full rounded-md border border-glassline bg-glass-1 px-3 text-xs text-gtext-primary focus:outline-none focus:ring-2 focus:ring-gbrand-ring"
                                >
                                  {skill.versions.map((version) => (
                                    <option key={version.id} value={version.id}>
                                      v{version.version} ·{' '}
                                      {version.scope === 'PLATFORM'
                                        ? '平台'
                                        : '企业'}
                                    </option>
                                  ))}
                                </select>
                              )}
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  variant="glass"
                                  size="sm"
                                  onClick={() =>
                                    setPreviewVersionId(
                                      skill.currentVersion!.id,
                                    )
                                  }
                                >
                                  <Eye className="h-4 w-4" /> 查看内容
                                </Button>
                                {isAdmin && (
                                  <Button
                                    variant="glass"
                                    size="sm"
                                    loading={createSkillVersion.isPending}
                                    onClick={() =>
                                      createSkillVersion.mutate(
                                        {
                                          subscriptionId:
                                            skillVersionsQuery.data!
                                              .subscriptionId,
                                          capabilityId: capability.id,
                                          parentVersionId:
                                            skill.currentVersion!.id,
                                          changeSummary: `基于 v${skill.currentVersion!.version} 创建`,
                                        },
                                        {
                                          onSuccess: (version) =>
                                            router.push(
                                              `/skills/${version.id}/edit`,
                                            ),
                                          onError: (error) =>
                                            toast.error(
                                              error instanceof Error
                                                ? error.message
                                                : '创建版本失败',
                                            ),
                                        },
                                      )
                                    }
                                  >
                                    <GitFork className="h-4 w-4" /> 创建企业版本
                                  </Button>
                                )}
                              </div>
                            </>
                          ) : (
                            <p className="text-xs text-gtext-muted">
                              暂无可预览版本
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="md:col-span-2">
                  <EmptyState
                    icon={<Zap className="h-8 w-8" />}
                    title="暂未绑定能力"
                    description="当前尚未绑定独立能力，仍可使用员工对话。"
                  />
                </div>
              )}
            </div>
          </section>
        </TabsContent>
        <TabsContent value="monitoring" className="mt-5 space-y-5">
          {isAdmin && !statsQuery.isError && (
            <MemberUsage
              rows={stats?.byMember ?? []}
              isLoading={statsQuery.isLoading}
            />
          )}
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionTitle
                icon={<BarChart3 className="h-4 w-4" />}
                title="能力执行与算力消费"
              />
            </div>
            {statsQuery.isLoading ? (
              <CenteredSpinner label="加载运行数据..." />
            ) : statsQuery.isError ? null : (
              <TrendChart points={stats?.trend ?? []} />
            )}
          </section>
          <section className="border-t border-border pt-5">
            <SectionTitle
              icon={<FileText className="h-4 w-4" />}
              title="执行记录"
            />
            {!statsQuery.isError && (
              <ExecutionTable entries={stats?.recentLog ?? []} />
            )}
            <p className="mt-3 text-xs leading-5 text-gtext-muted">
              云端能力执行，仅包含可归属当前雇佣关系的记录。
            </p>
          </section>
        </TabsContent>
        <TabsContent value="config" className="mt-5">
          <section>
            <SectionTitle
              icon={<Settings2 className="h-4 w-4" />}
              title="雇佣关系配置"
            />
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
                  <p className="text-sm font-medium text-gtext-primary">
                    配置由企业管理员维护
                  </p>
                  <p className="mt-1 text-xs leading-5 text-gtext-muted">
                    为保护运行凭据，成员账号不展示员工的连接与运行配置。
                  </p>
                </div>
              )}
              <div className="grid gap-3 border-t border-glassline pt-5 text-sm sm:grid-cols-2">
                <Info
                  label="模板版本"
                  value={`v${subscription.templateVersion}`}
                />
                <Info
                  label="最近更新"
                  value={formatDate(subscription.updatedAt)}
                />
                <Info
                  label="开始日期"
                  value={formatDate(subscription.startDate)}
                />
                <Info
                  label="结束日期"
                  value={formatDate(subscription.endDate)}
                />
              </div>
            </div>
          </section>
        </TabsContent>
      </Tabs>
      <SkillVersionPreviewDialog
        versionId={previewVersionId}
        open={Boolean(previewVersionId)}
        onOpenChange={(open) => !open && setPreviewVersionId('')}
      />
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
    tone === 'success'
      ? 'text-gsuccess'
      : tone === 'brand'
        ? 'text-gbrand-text'
        : 'text-ginfo';
  return (
    <div className="min-w-0 py-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gtext-muted">{label}</span>
        <span className={color}>{icon}</span>
      </div>
      <p className="mt-2 break-words text-xl font-semibold tabular-nums text-gtext-primary">
        {value}
      </p>
    </div>
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
function LoadError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-md border border-gdanger/20 bg-gdanger/5 p-4 text-sm"
    >
      <span className="text-gdanger">{title}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        重新加载
      </Button>
    </div>
  );
}
function MemberUsage({
  rows,
  isLoading,
}: {
  rows: NonNullable<EmployeeStats['byMember']>;
  isLoading: boolean;
}) {
  return (
    <section className="border-b border-border pb-5">
      <SectionTitle icon={<Users className="h-4 w-4" />} title="成员使用情况" />
      {isLoading ? (
        <CenteredSpinner label="加载成员使用情况..." />
      ) : rows.length ? (
        <div className="divide-y divide-border">
          {rows.map((row) => (
            <div
              key={row.userId ?? 'unknown'}
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
            >
              <span className="min-w-0 break-words font-medium text-foreground">
                {row.name}
              </span>
              <span className="flex gap-5 tabular-nums text-fg-muted">
                <span>{row.callCount} 次模型调用</span>
                <span>¥{row.costCNY.toFixed(4)}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-4 text-sm text-fg-muted">
          该时间范围内暂无成员调用记录
        </p>
      )}
    </section>
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
    return (
      <p className="py-8 text-center text-sm text-gtext-muted">暂无执行记录</p>
    );
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
            <tr
              key={entry.id}
              className="border-b border-glassline/60 last:border-0"
            >
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
    tokens: number;
    costCNY: number;
  }>;
}) {
  const max = Math.max(...points.map((point) => point.total), 1);
  return points.length === 0 ? (
    <p className="py-12 text-center text-sm text-gtext-muted">暂无运行数据</p>
  ) : (
    <div className="overflow-x-auto">
      <div className="min-w-[520px] space-y-3">
        <div className="grid grid-cols-[72px_1fr_72px_72px_40px] gap-3 text-xs text-gtext-muted">
          <span>日期</span>
          <span>能力执行</span>
          <span className="text-right">Token</span>
          <span className="text-right">费用</span>
          <span className="text-right">次数</span>
        </div>
        {points.map((point) => (
          <div
            key={point.date}
            className="grid grid-cols-[72px_1fr_72px_72px_40px] items-center gap-3 text-xs"
          >
            <span className="text-gtext-muted">{point.date.slice(5)}</span>
            <div className="h-2 overflow-hidden rounded-full bg-glass-2">
              <div
                className="h-full rounded-full bg-gbrand-text transition-all"
                style={{
                  width: `${Math.max((point.total / max) * 100, point.total ? 3 : 0)}%`,
                }}
              />
            </div>
            <span className="text-right tabular-nums text-gtext-muted">
              {point.tokens.toLocaleString()}
            </span>
            <span className="text-right tabular-nums text-gtext-muted">
              ¥{point.costCNY.toFixed(4)}
            </span>
            <span className="text-right text-gtext-secondary">
              {point.total}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
