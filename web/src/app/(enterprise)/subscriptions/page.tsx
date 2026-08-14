'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Store,
  UserMinus,
  Pause,
  Play,
  Pencil,
  ArrowUpCircle,
  ShieldCheck,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';
import {
  useSubscriptions,
  useUnsubscribe,
  useUpdateSubscription,
  useChangeSubscriptionStatus,
  useUpgradeSubscription,
} from '@/features/subscription/use-subscriptions';
import { GrantPanel } from '@/features/enterprise/grant-panel';
import { SUBSCRIPTION_STATUS_META } from '@/lib/utils';
import { employment, employee as employeeCopy } from '@/locales/zh-CN';
import type { Subscription } from '@/lib/types';

/** 职能分类，与市场页对齐 */
const CATEGORY_TABS = [
  { label: '全部', value: '' },
  { label: '人事', value: '人事' },
  { label: '销售', value: '销售' },
  { label: '财务', value: '财务' },
  { label: '运营', value: '运营' },
  { label: '营销', value: '营销' },
  { label: '技术', value: '技术' },
];

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="text-fg-muted hover:text-foreground">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export default function SubscriptionsPage() {
  const { roleInEnterprise } = useAuthStore();
  const isAdmin = roleInEnterprise === 'ENTERPRISE_ADMIN';

  const { data: subs = [], isLoading } = useSubscriptions();
  const unsubscribe = useUnsubscribe();
  const updateSub = useUpdateSubscription();
  const changeStatus = useChangeSubscriptionStatus();
  const upgradeSub = useUpgradeSubscription();

  const [releasing, setReleasing] = useState<Subscription | null>(null);
  const [renaming, setRenaming] = useState<Subscription | null>(null);
  const [granting, setGranting] = useState<Subscription | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [activeCategory, setActiveCategory] = useState('');

  /** 按分类筛选 */
  const filteredSubs = useMemo(() => {
    if (!activeCategory) return subs;
    return subs.filter((sub) => {
      const text = `${sub.employee.position ?? ''} ${sub.employee.industry ?? ''}`;
      return text.includes(activeCategory);
    });
  }, [subs, activeCategory]);

  const handleRelease = () => {
    if (!releasing) return;
    const name = releasing.employee.name;
    unsubscribe.mutate(releasing.id, {
      onSuccess: () => {
        toast.success(`已解除与「${name}」的雇佣关系`);
        setReleasing(null);
      },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : '解除失败'),
    });
  };

  const setStatus = (sub: Subscription, status: 'ACTIVE' | 'PAUSED') => {
    changeStatus.mutate(
      { id: sub.id, status },
      {
        onSuccess: (r) =>
          toast.success(
            r.changed
              ? `「${sub.name}」已${SUBSCRIPTION_STATUS_META[status].label}`
              : '状态未变化',
          ),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : '操作失败'),
      },
    );
  };

  const handleRename = () => {
    if (!renaming) return;
    const trimmed = renameValue.trim();
    updateSub.mutate(
      // 清空即恢复展示模板名，后端把 null 当作「取消自定义」
      { id: renaming.id, name: trimmed || null },
      {
        onSuccess: () => {
          toast.success('已更新称呼');
          setRenaming(null);
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : '更新失败'),
      },
    );
  };

  const handleUpgrade = (sub: Subscription) => {
    upgradeSub.mutate(sub.id, {
      onSuccess: (r) =>
        toast.success(
          `已从 v${r.from} 升级到 v${r.to}` +
            (r.configReviewRequired ? '，请复核配置（未自动迁移）' : ''),
        ),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : '升级失败'),
    });
  };

  if (isLoading) return <CenteredSpinner label="加载中…" />;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{employment.section}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {employment.description}
          </p>
        </div>
        <Link href="/marketplace">
          <Button size="sm">
            <Store className="h-4 w-4" />
            前往人才市场
          </Button>
        </Link>
      </div>

      {/* 分类筛选 */}
      {subs.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveCategory(tab.value)}
              className={cn(
                'shrink-0 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                activeCategory === tab.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-fg-muted hover:bg-muted hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {subs.length === 0 ? (
        <EmptyState
          icon={<Store className="h-8 w-8" />}
          title="还没有雇佣关系"
          description="前往硅基人才市场招聘你的第一位硅基员工，雇佣后可在「员工授权」分配给团队里的碳基员工。"
          action={
            <Link href="/marketplace">
              <Button size="sm">前往硅基人才市场</Button>
            </Link>
          }
        />
      ) : filteredSubs.length === 0 ? (
        <EmptyState
          icon={<Store className="h-8 w-8" />}
          title="没有匹配的雇佣关系"
          description="试试切换到其他分类"
          action={
            <Button size="sm" onClick={() => setActiveCategory('')}>
              查看全部
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredSubs.map((sub) => {
            const statusMeta = SUBSCRIPTION_STATUS_META[sub.status];
            // 已解聘是终态，所有管理动作都该禁掉而不是让后端报 409
            const dismissed = sub.status === 'EXPIRED';
            return (
              <div
                key={sub.id}
                className={`rounded-xl border border-border bg-background p-5 ${
                  dismissed ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <Avatar
                    name={sub.employee.name}
                    src={sub.employee.avatar}
                    className="h-12 w-12 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-semibold text-foreground">{sub.name}</p>
                      <Badge className={`shrink-0 ${statusMeta.tone}`}>
                        {statusMeta.label}
                      </Badge>
                    </div>
                    {/* 自定义称呼时补一行模板名，否则重复显示同一个名字 */}
                    {sub.name !== sub.employee.name && (
                      <p className="truncate text-xs text-fg-subtle">{sub.employee.name}</p>
                    )}
                    <p className="mt-1 truncate text-sm text-fg-muted">
                      {sub.employee.position}
                      {sub.employee.industry ? ` · ${sub.employee.industry}` : ''}
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-fg-muted">能力版本</span>
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium text-foreground">v{sub.templateVersion}</span>
                      {sub.upgradeAvailable && !dismissed && (
                        <Badge className="bg-warning/10 text-warning">
                          可升 v{sub.latestVersion}
                        </Badge>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-muted">雇佣开始</span>
                    <span className="text-foreground">
                      {new Date(sub.startDate).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-muted">雇佣到期</span>
                    <span className="text-foreground">
                      {sub.endDate
                        ? new Date(sub.endDate).toLocaleDateString('zh-CN')
                        : '长期有效'}
                    </span>
                  </div>
                </div>

                {isAdmin && !dismissed && (
                  <>
                    <div className="mt-3 flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => setGranting(sub)}
                      >
                        <ShieldCheck className="h-4 w-4" />
                        授权
                      </Button>
                      {sub.upgradeAvailable && (
                        <button
                          title={`升级到 v${sub.latestVersion}`}
                          onClick={() => handleUpgrade(sub)}
                          disabled={upgradeSub.isPending}
                          className="rounded-lg border border-warning/30 p-2 text-warning hover:bg-warning/10 disabled:opacity-40"
                        >
                          <ArrowUpCircle className="h-4 w-4" />
                        </button>
                      )}
                      {sub.status === 'ACTIVE' ? (
                        <button
                          title={employeeCopy.pause}
                          onClick={() => setStatus(sub, 'PAUSED')}
                          disabled={changeStatus.isPending}
                          className="rounded-lg border border-border p-2 text-fg-muted hover:bg-muted hover:text-foreground disabled:opacity-40"
                        >
                          <Pause className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          title={employeeCopy.onboard}
                          onClick={() => setStatus(sub, 'ACTIVE')}
                          disabled={changeStatus.isPending}
                          className="rounded-lg border border-success/30 p-2 text-success hover:bg-success/10 disabled:opacity-40"
                        >
                          <Play className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        title="改称呼"
                        onClick={() => {
                          setRenaming(sub);
                          // 与模板同名说明没自定义过，输入框留空更好改
                          setRenameValue(sub.name === sub.employee.name ? '' : sub.name);
                        }}
                        className="rounded-lg border border-border p-2 text-fg-muted hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>

                    <button
                      onClick={() => setReleasing(sub)}
                      disabled={unsubscribe.isPending}
                      className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-40"
                    >
                      <UserMinus className="h-4 w-4" />
                      {employment.release}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 解除雇佣确认 */}
      {releasing && (
        <Modal title={employment.release} onClose={() => setReleasing(null)}>
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-fg-muted">
              {employment.releaseConfirm(releasing.employee.name)}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setReleasing(null)}>
                我再想想
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleRelease}
                disabled={unsubscribe.isPending}
              >
                确认解除
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* 改称呼 */}
      {renaming && (
        <Modal title={`改称呼 · ${renaming.employee.name}`} onClose={() => setRenaming(null)}>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">企业内称呼</label>
              <Input
                placeholder={renaming.employee.name}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
              />
              <p className="mt-1 text-xs text-fg-subtle">
                留空则显示模板名「{renaming.employee.name}」。
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setRenaming(null)}>
                取消
              </Button>
              <Button size="sm" onClick={handleRename} disabled={updateSub.isPending}>
                保存
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {granting && (
        <GrantPanel subscription={granting} onClose={() => setGranting(null)} />
      )}
    </div>
  );
}
