'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Store, UserMinus } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';
import { useSubscriptions, useUnsubscribe } from '@/features/subscription/use-subscriptions';
import { useInstances } from '@/features/enterprise/use-enterprise';
import { SUBSCRIPTION_STATUS_META } from '@/lib/utils';
import { employment } from '@/locales/zh-CN';
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
  const { data: instances = [] } = useInstances();
  const unsubscribe = useUnsubscribe();

  const [releasing, setReleasing] = useState<Subscription | null>(null);
  const [activeCategory, setActiveCategory] = useState('');

  /** 每个雇佣关系下在岗的硅基员工数（不含已解聘） */
  const unitCountByTemplate = instances.reduce<Record<string, number>>((acc, inst) => {
    if (inst.status !== 'REVOKED') {
      acc[inst.template.id] = (acc[inst.template.id] ?? 0) + 1;
    }
    return acc;
  }, {});

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
            const count = unitCountByTemplate[sub.employee.id] ?? 0;
            return (
              <div
                key={sub.id}
                className={`rounded-xl border border-border bg-background p-5 ${
                  sub.status === 'EXPIRED' ? 'opacity-60' : ''
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
                      <p className="truncate font-semibold text-foreground">
                        {sub.employee.name}
                      </p>
                      <Badge className={`shrink-0 ${statusMeta.tone}`}>
                        {statusMeta.label}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-sm text-fg-muted">
                      {sub.employee.position}
                      {sub.employee.industry ? ` · ${sub.employee.industry}` : ''}
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-fg-muted">在岗数量</span>
                    <span className="font-medium text-foreground">{count} 位</span>
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

                {isAdmin && sub.status === 'ACTIVE' && (
                  <button
                    onClick={() => setReleasing(sub)}
                    disabled={unsubscribe.isPending}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-40"
                  >
                    <UserMinus className="h-4 w-4" />
                    {employment.release}
                  </button>
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
    </div>
  );
}
