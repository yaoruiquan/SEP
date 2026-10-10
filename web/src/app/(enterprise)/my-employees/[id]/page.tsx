"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  FileText,
  Eye,
  KeyRound,
  Pencil,
  Check,
  X,
  Sparkles,
  XCircle,
  Zap,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, CenteredSpinner } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/lib/auth-store";
import { ApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import {
  useSubscription,
  useUpdateSubscription,
} from "@/features/subscription/use-subscriptions";
import { useSubscriptionGrants } from "@/features/enterprise/use-enterprise";
import { useEmployeeDetail } from "@/features/employee/use-employee-detail";
import {
  businessDateRange,
  useEmployeeUsage,
  type UsageSource,
} from "@/features/employee/use-employee-usage";
import { EmployeeUsageRecords } from "@/features/employee/employee-usage-records";
import type { CapabilityType, SubscriptionStatus } from "@/lib/types";
import { SkillVersionPreviewDialog } from "@/features/skill-version/SkillVersionPreviewDialog";
import {
  useEmployeeSkillVersions,
} from "@/features/skill-version/use-skill-version";

const STATUS_META: Record<SubscriptionStatus, { label: string; tone: string }> =
  {
    ACTIVE: {
      label: "使用中",
      tone: "border-gsuccess/30 bg-gsuccess/12 text-gsuccess",
    },
    PAUSED: {
      label: "已暂停",
      tone: "border-gwarning/30 bg-gwarning/12 text-gwarning",
    },
    EXPIRED: {
      label: "已结束",
      tone: "border-gdanger/30 bg-gdanger/12 text-gdanger",
    },
    TERMINATED: {
      label: "已解聘",
      tone: "border-gdanger/30 bg-gdanger/12 text-gdanger",
    },
  };

const CAPABILITY_META: Record<CapabilityType, { label: string; tone: string }> =
  {
    AGENT: {
      label: "Agent",
      tone: "border-violet-400/30 bg-violet-400/10 text-violet-700 dark:text-violet-300",
    },
    RPA: {
      label: "RPA",
      tone: "border-blue-400/30 bg-blue-400/10 text-blue-700 dark:text-blue-300",
    },
    SKILL: {
      label: "Skill",
      tone: "border-emerald-400/30 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300",
    },
    AI_APP: {
      label: "AI App",
      tone: "border-orange-400/30 bg-orange-400/10 text-orange-700 dark:text-orange-300",
    },
  };

function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return "未设置";
  return new Date(value).toLocaleString(
    "zh-CN",
    withTime
      ? { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : { year: "numeric", month: "long", day: "numeric" },
  );
}

export default function EmployeeDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const router = useRouter();
  const { roleInEnterprise } = useAuthStore();
  const isAdmin = roleInEnterprise === "ENTERPRISE_ADMIN";
  const [activeTab, setActiveTab] = useState("overview");
  const [days, setDays] = useState(7);
  const [range, setRange] = useState(() => businessDateRange(7));
  const [userId, setUserId] = useState("");
  const [source, setSource] = useState<UsageSource | "">("");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const subscriptionQuery = useSubscription(id);
  const subscription = subscriptionQuery.data;
  const employeeId = subscription?.employee?.id ?? "";
  const employeeQuery = useEmployeeDetail(subscription ? id : "");
  const validRange = Boolean(range.from && range.to && range.from < range.to);
  const usageQuery = useEmployeeUsage(subscription && validRange ? id : "", {
    ...range,
    page,
    limit: 20,
    userId: isAdmin ? userId || undefined : undefined,
    source: source || undefined,
    order,
  });
  const grantsQuery = useSubscriptionGrants(isAdmin ? id : "");
  const updateSubscription = useUpdateSubscription();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [previewVersionId, setPreviewVersionId] = useState("");

  const status = subscription?.status as SubscriptionStatus | undefined;
  const statusMeta = (status && STATUS_META[status]) ?? {
    label: "已结束",
    tone: "border-gdanger/30 bg-gdanger/12 text-gdanger",
  };
  const employee = employeeQuery.data;
  const skillVersionsQuery = useEmployeeSkillVersions(employeeId);
  const consumption = usageQuery.data?.modelConsumption;
  const activeName = subscription?.name || subscription?.employee?.name || "";

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
              onClick={() => router.push("/my-employees")}
            >
              返回我的员工
            </Button>
          }
        />
      </div>
    );

  const saveName = () => {
    if (!name.trim()) return;
    updateSubscription.mutate(
      { id, name: name.trim() },
      {
        onSuccess: () => {
          toast.success("员工名称已保存");
          setEditing(false);
        },
        onError: (error) =>
          toast.error(error instanceof ApiError ? error.message : "保存失败"),
      },
    );
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6 -mx-4 sm:-mx-6 lg:-mx-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => router.push("/my-employees")}
          className="inline-flex items-center gap-2 text-sm text-gtext-secondary transition-colors hover:text-gtext-primary"
        >
          <ArrowLeft className="h-4 w-4" /> 返回我的硅基员工
        </button>
      </div>

      <section className="border-y border-border bg-blue-50/30 px-4 py-5 dark:bg-white/5 sm:px-6">
        <div className="flex flex-wrap items-center gap-5">
          <Avatar
            name={activeName}
            src={subscription.employee.avatar}
            asset={subscription.employee.avatarAsset}
            portrait
            fullBody
            focalPoint="50% 35%"
            className="h-28 w-20 shrink-0 rounded-lg sm:h-36 sm:w-28"
          />
          <div className="min-w-0 flex-1 basis-36 sm:basis-44">
            <div className="flex flex-wrap items-center gap-2.5">
              {editing && isAdmin ? (
                <form
                  className="flex min-w-0 flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveName();
                  }}
                >
                  <Input
                    aria-label="员工名称"
                    className="w-full sm:w-60"
                    maxLength={100}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoFocus
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    aria-label="保存名称"
                    title="保存名称"
                    disabled={!name.trim() || updateSubscription.isPending}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label="取消修改名称"
                    title="取消修改名称"
                    onClick={() => setEditing(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </form>
              ) : (
                <>
                  <h1 className="break-words text-2xl font-semibold text-gtext-primary">
                    {activeName}
                  </h1>
                  {isAdmin && (status === "ACTIVE" || status === "PAUSED") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="修改名称"
                      title="修改名称"
                      onClick={() => {
                        setName(activeName);
                        setEditing(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                </>
              )}
              <Badge className={statusMeta.tone}>{statusMeta.label}</Badge>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gtext-secondary">
              {subscription.employee.description ||
                "这位硅基员工还没有填写简介。"}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-gtext-muted">
              <span>{subscription.employee.position || "通用岗位"}</span>
              <span>{subscription.employee.industry || "通用行业"}</span>
              <span>雇佣于 {formatDate(subscription.startDate)}</span>
            </div>
          </div>
          <Button
            variant="glass-primary"
            onClick={() => router.push(`/chat?employeeId=${employeeId}`)}
            disabled={status !== "ACTIVE"}
          >
            <Sparkles className="h-4 w-4" />
            开始对话
          </Button>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gtext-secondary">
          {isAdmin ? "本企业使用情况" : "我的使用情况"}
          <span className="ml-3 text-gtext-muted">UTC+8</span>
        </p>
        <div
          aria-label="统计时间范围"
          className="inline-flex rounded-md border border-border bg-muted p-1"
        >
          {[7, 30].map((value) => (
            <button
              key={value}
              aria-pressed={days === value}
              onClick={() => {
                setDays(value);
                setRange(businessDateRange(value));
                setPage(1);
              }}
              className={`rounded px-3 py-1.5 text-sm ${days === value ? "bg-card font-medium text-foreground shadow-sm" : "text-fg-muted"}`}
            >
              近 {value} 天
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {isAdmin && (
          <label className="text-xs text-gtext-muted">
            成员
            <select
              aria-label="成员筛选"
              value={userId}
              onChange={(event) => {
                setUserId(event.target.value);
                setPage(1);
              }}
              className="mt-1 block max-w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">全部成员</option>
              {usageQuery.data?.members?.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.userName || "未命名成员"}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-xs text-gtext-muted">
          开始日期
          <Input
            aria-label="开始日期"
            type="date"
            className="mt-1 w-40"
            value={range.from ?? ""}
            onChange={(event) => {
              setRange((previous) => ({
                ...previous,
                from: event.target.value,
              }));
              setDays(0);
              setPage(1);
            }}
          />
        </label>
        <label className="text-xs text-gtext-muted">
          截止日期（不含）
          <Input
            aria-label="截止日期（不含）"
            type="date"
            className="mt-1 w-40"
            value={range.to ?? ""}
            onChange={(event) => {
              setRange((previous) => ({ ...previous, to: event.target.value }));
              setDays(0);
              setPage(1);
            }}
          />
        </label>
      </div>
      {!validRange && (
        <p role="alert" className="text-sm text-gdanger">
          截止日期必须晚于开始日期。
        </p>
      )}
      {usageQuery.isError && (
        <LoadError
          title={
            usageQuery.data
              ? "使用数据刷新失败，当前显示上次读取的数据"
              : "使用数据加载失败"
          }
          onRetry={() => void usageQuery.refetch()}
        />
      )}
      <div className="grid grid-cols-1 gap-4 border-y border-border py-4 sm:grid-cols-3">
        <Metric
          label="模型调用"
          value={validRange && consumption ? consumption.callCount : "—"}
          icon={<Activity className="h-4 w-4" />}
        />
        <Metric
          label="Token 用量"
          value={
            validRange && consumption
              ? consumption.totalTokens.toLocaleString()
              : "—"
          }
          icon={<Zap className="h-4 w-4" />}
        />
        <Metric
          label="模型消费"
          value={
            validRange && consumption
              ? `¥${consumption.costCNY.toFixed(4)}`
              : "—"
          }
          icon={<Wallet className="h-4 w-4" />}
        />
      </div>

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
          <TabsTrigger value="usage">
            <BarChart3 className="h-4 w-4" />
            使用记录
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-5 space-y-5">
          <div
            className={`grid gap-6 ${isAdmin ? "lg:grid-cols-[1.5fr_1fr]" : ""}`}
          >
            <section className="min-w-0">
              <SectionTitle
                icon={<FileText className="h-4 w-4" />}
                title="雇佣信息"
              />
              <div className="grid gap-4 text-sm sm:grid-cols-2">
                <Info
                  label="已配置能力"
                  value={String(employee?.capabilities.length ?? "—")}
                />
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
                            : `成员 · ${grant.member?.name || grant.member?.email || "未命名"}`}
                        </span>
                        <span
                          className={
                            grant.expired ? "text-gdanger" : "text-gtext-muted"
                          }
                        >
                          {grant.expired
                            ? "已过期"
                            : grant.expiresAt
                              ? `至 ${formatDate(grant.expiresAt)}`
                              : "长期有效"}
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
                  const sharedVersion = skill?.enterpriseVersion ?? skill?.currentVersion;
                  const enabledVersion = sharedVersion?.scope !== "PERSONAL" ? sharedVersion : null;
                  const meta = CAPABILITY_META[
                    capability.type as CapabilityType
                  ] ?? {
                    label: capability.type,
                    tone: "border-glassline bg-glass-2 text-gtext-secondary",
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
                        {capability.description || "暂无能力说明"}
                      </p>
                      {capability.type === "SKILL" && (
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
                          ) : enabledVersion ? (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                <span className="text-gtext-muted">
                                  企业当前启用 v{enabledVersion.version} ·{" "}
                                  {enabledVersion.scope === "PLATFORM"
                                    ? "平台"
                                    : "企业"}
                                </span>
                                {skill?.upgradeAvailable && (
                                  <Badge className="border-gwarning/30 bg-gwarning/10 text-gwarning">
                                    有新版本
                                  </Badge>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  variant="glass"
                                  size="sm"
                                  onClick={() =>
                                    setPreviewVersionId(
                                      enabledVersion.id,
                                    )
                                  }
                                >
                                  <Eye className="h-4 w-4" /> 查看内容
                                </Button>
                              </div>
                            </>
                          ) : (
                            <p className="text-xs text-gtext-muted">
                              暂无启用版本
                            </p>
                          )}
                          <Link href={`/capabilities/${capability.id}`} className="inline-flex text-xs text-gbrand-text hover:underline">
                            查看版本与审核历史
                          </Link>
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
        <TabsContent value="usage" className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex flex-wrap items-center gap-2 text-sm text-gtext-secondary">
              来源
              <select
                aria-label="来源筛选"
                value={source}
                onChange={(event) => {
                  setSource(event.target.value as UsageSource | "");
                  setPage(1);
                }}
                className="rounded-md border border-border bg-background px-3 py-2 text-foreground"
              >
                <option value="">全部来源</option>
                <option value="client">客户端（含旧记录）</option>
                <option value="client-legacy">旧客户端记录</option>
                <option value="web-conversation">Web 对话</option>
                <option value="web-task">Web 任务会话</option>
              </select>
            </label>
            <label className="inline-flex flex-wrap items-center gap-2 text-sm text-gtext-secondary">
              使用时间
              <select
                aria-label="使用时间排序"
                value={order}
                onChange={(event) => {
                  setOrder(event.target.value as "asc" | "desc");
                  setPage(1);
                }}
                className="rounded-md border border-border bg-background px-3 py-2 text-foreground"
              >
                <option value="desc">最近优先</option>
                <option value="asc">最早优先</option>
              </select>
            </label>
          </div>
          {validRange && (
            <EmployeeUsageRecords
              subscriptionId={id}
              data={usageQuery.data}
              isLoading={usageQuery.isLoading}
              isError={usageQuery.isError}
              onRetry={() => void usageQuery.refetch()}
              page={page}
              onPageChange={setPage}
            />
          )}
        </TabsContent>
      </Tabs>
      <SkillVersionPreviewDialog
        versionId={previewVersionId}
        open={Boolean(previewVersionId)}
        onOpenChange={(open) => !open && setPreviewVersionId("")}
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
  tone = "default",
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone?: "default" | "success" | "brand";
}) {
  const color =
    tone === "success"
      ? "text-gsuccess"
      : tone === "brand"
        ? "text-gbrand-text"
        : "text-ginfo";
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
