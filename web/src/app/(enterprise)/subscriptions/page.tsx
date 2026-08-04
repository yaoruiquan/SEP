'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { MessageSquare, Trash2, Users, Store, PlayCircle, PauseCircle, XCircle } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CAPABILITY_TYPE_META, SUBSCRIPTION_STATUS_META } from '@/lib/utils';
import { useSubscriptions, useUnsubscribe } from '@/features/subscription/use-subscriptions';
import { toast } from '@/components/ui/toast';
import { SubscriptionListSkeleton } from '@/features/subscription/subscription-skeleton';
import type { SubscriptionStatus } from '@/lib/types';

type FilterTab = 'ALL' | SubscriptionStatus;

const TAB_LABELS: { value: FilterTab; label: string }[] = [
  { value: 'ALL',     label: '全部' },
  { value: 'ACTIVE',  label: '进行中' },
  { value: 'PAUSED',  label: '已暂停' },
  { value: 'EXPIRED', label: '已过期' },
];

const STATUS_ICON: Record<SubscriptionStatus, React.ReactNode> = {
  ACTIVE:  <PlayCircle  className="h-3.5 w-3.5" />,
  PAUSED:  <PauseCircle className="h-3.5 w-3.5" />,
  EXPIRED: <XCircle     className="h-3.5 w-3.5" />,
};

export default function SubscriptionsPage() {
  const { data: subs = [], isLoading, isError, error } = useSubscriptions();
  const unsubscribe = useUnsubscribe();
  const [activeTab, setActiveTab] = useState<FilterTab>('ALL');
  const [unsubscribeDialog, setUnsubscribeDialog] = useState<{
    open: boolean; subId: string; empName: string;
  }>({ open: false, subId: '', empName: '' });

  // 按状态统计
  const counts = useMemo(() => ({
    ALL:     subs.length,
    ACTIVE:  subs.filter((s) => s.status === 'ACTIVE').length,
    PAUSED:  subs.filter((s) => s.status === 'PAUSED').length,
    EXPIRED: subs.filter((s) => s.status === 'EXPIRED').length,
  }), [subs]);

  // 过滤后列表
  const filtered = useMemo(
    () => activeTab === 'ALL' ? subs : subs.filter((s) => s.status === activeTab),
    [subs, activeTab],
  );

  const handleUnsubscribe = () => {
    unsubscribe.mutate(unsubscribeDialog.subId, {
      onSuccess: () => toast.success(`已取消订阅「${unsubscribeDialog.empName}」`),
      onError:   (e) => toast.error(`取消失败: ${(e as Error).message}`),
    });
  };

  return (
    <div className="space-y-6 p-6">
      {/* 页头 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">我的订阅</h1>
          <p className="mt-1 text-sm text-fg-muted">管理你订阅的硅基员工，随时开启对话</p>
        </div>
        <Link href="/marketplace">
          <Button variant="outline" size="sm">
            <Store className="h-4 w-4" />
            前往市场
          </Button>
        </Link>
      </div>

      {/* 统计条 */}
      {!isLoading && !isError && subs.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-success/10 px-4 py-3 text-center">
            <div className="text-2xl font-bold text-success">{counts.ACTIVE}</div>
            <div className="text-xs text-fg-muted mt-0.5">进行中</div>
          </div>
          <div className="rounded-lg border border-border bg-warning/10 px-4 py-3 text-center">
            <div className="text-2xl font-bold text-warning">{counts.PAUSED}</div>
            <div className="text-xs text-fg-muted mt-0.5">已暂停</div>
          </div>
          <div className="rounded-lg border border-border bg-muted px-4 py-3 text-center">
            <div className="text-2xl font-bold text-fg-muted">{counts.EXPIRED}</div>
            <div className="text-xs text-fg-muted mt-0.5">已过期</div>
          </div>
        </div>
      )}

      {/* 状态 Tab 过滤 */}
      {!isLoading && !isError && subs.length > 0 && (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FilterTab)}>
          <TabsList className="bg-muted/60">
            {TAB_LABELS.map(({ value, label }) => (
              <TabsTrigger key={value} value={value} className="gap-1.5">
                {label}
                {counts[value] > 0 && (
                  <span className="rounded-full bg-background px-1.5 text-xs font-medium">
                    {counts[value]}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {/* 内容区 */}
      {isLoading ? (
        <SubscriptionListSkeleton count={4} />
      ) : isError ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title="加载失败"
          description={error?.message || '无法加载订阅列表，请稍后重试。'}
          action={
            <Button size="sm" onClick={() => window.location.reload()}>
              刷新页面
            </Button>
          }
        />
      ) : subs.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title="你还没有订阅任何员工"
          description="去员工广场挑选一位硅基员工开始使用吧。"
          action={
            <Link href="/marketplace">
              <Button size="sm">前往员工广场</Button>
            </Link>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title={`没有${TAB_LABELS.find((t) => t.value === activeTab)?.label}的订阅`}
          description="切换上方标签查看其他状态的订阅。"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filtered.map((sub) => {
            const emp = sub.employee;
            const statusMeta = SUBSCRIPTION_STATUS_META[sub.status];
            const capTypes = Array.from(
              new Set(emp.bindings?.map((b) => b.capability.type) ?? []),
            );
            const isActive = sub.status === 'ACTIVE';

            return (
              <Card
                key={sub.id}
                className={`overflow-hidden transition-opacity ${
                  sub.status === 'EXPIRED' ? 'opacity-60' : ''
                }`}
              >
                <CardContent className="flex flex-col gap-4 p-5">
                  {/* 头部：头像 + 名称 + 状态 */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <Avatar
                        name={emp.name}
                        src={emp.avatar}
                        className="h-12 w-12 shrink-0"
                      />
                      <div className="min-w-0">
                        <h3 className="font-semibold">{emp.name}</h3>
                        <p className="text-xs text-fg-muted">
                          {emp.position} · {emp.industry}
                        </p>
                      </div>
                    </div>
                    <Badge className={`flex items-center gap-1 shrink-0 ${statusMeta.tone}`}>
                      {STATUS_ICON[sub.status]}
                      {statusMeta.label}
                    </Badge>
                  </div>

                  {/* 描述 */}
                  <p className="line-clamp-2 text-sm leading-relaxed text-fg-muted">
                    {emp.description}
                  </p>

                  {/* 能力标签 */}
                  {capTypes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {capTypes.map((t) => {
                        const meta = CAPABILITY_TYPE_META[t];
                        return (
                          <Badge key={t} className={`text-xs ${meta.tone}`}>
                            {meta.label}
                          </Badge>
                        );
                      })}
                    </div>
                  )}

                  {/* 元信息 */}
                  <div className="text-xs text-fg-subtle">
                    订阅于{' '}
                    {formatDistanceToNow(new Date(sub.createdAt), {
                      addSuffix: true,
                      locale: zhCN,
                    })}
                  </div>

                  {/* 操作 */}
                  <div className="flex gap-2">
                    {isActive ? (
                      <Link href={`/chat?employeeId=${emp.id}`} className="flex-1">
                        <Button variant="secondary" size="sm" className="w-full">
                          <MessageSquare className="h-4 w-4" />
                          开始对话
                        </Button>
                      </Link>
                    ) : (
                      <Link href="/marketplace" className="flex-1">
                        <Button variant="outline" size="sm" className="w-full">
                          <Store className="h-4 w-4" />
                          {sub.status === 'EXPIRED' ? '重新订阅' : '前往市场'}
                        </Button>
                      </Link>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={unsubscribe.isPending}
                      onClick={() =>
                        setUnsubscribeDialog({ open: true, subId: sub.id, empName: emp.name })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={unsubscribeDialog.open}
        onOpenChange={(open) => setUnsubscribeDialog({ ...unsubscribeDialog, open })}
        title="取消订阅"
        description={`确定要取消订阅「${unsubscribeDialog.empName}」吗？取消后将无法继续使用该员工的服务。`}
        confirmText="确认取消"
        cancelText="我再想想"
        variant="danger"
        loading={unsubscribe.isPending}
        onConfirm={handleUnsubscribe}
      />
    </div>
  );
}
