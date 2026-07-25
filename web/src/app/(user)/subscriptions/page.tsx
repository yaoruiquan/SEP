'use client';

import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { MessageSquare, Trash2, Users } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CenteredSpinner, EmptyState, Skeleton } from '@/components/ui/feedback';
import { CAPABILITY_TYPE_META, SUBSCRIPTION_STATUS_META } from '@/lib/utils';
import { useSubscriptions, useUnsubscribe } from '@/features/subscription/use-subscriptions';
import { toast } from '@/components/ui/toast';

export default function SubscriptionsPage() {
  const { data: subs = [], isLoading } = useSubscriptions();
  const unsubscribe = useUnsubscribe();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">我的订阅</h1>
        <p className="mt-1 text-sm text-fg-muted">
          管理你订阅的碳基员工，随时开启对话
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : subs.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title="你还没有订阅任何员工"
          description="去员工广场挑选一位碳基员工开始使用吧。"
          action={
            <Link href="/marketplace">
              <Button size="sm">前往员工广场</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {subs.map((sub) => {
            const emp = sub.employee;
            const statusMeta = SUBSCRIPTION_STATUS_META[sub.status];
            const capTypes = Array.from(
              new Set(emp.bindings?.map((b) => b.capability.type) ?? []),
            );
            return (
              <Card key={sub.id} className="overflow-hidden">
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <Avatar
                        name={emp.name}
                        src={emp.avatar}
                        className="h-12 w-12 shrink-0"
                      />
                      <div className="min-w-0">
                        <h3 className="font-semibold text-foreground">{emp.name}</h3>
                        <p className="text-xs text-fg-muted">
                          {emp.position} · {emp.industry}
                        </p>
                      </div>
                    </div>
                    <span className={`text-xs font-medium ${statusMeta.tone}`}>
                      {statusMeta.label}
                    </span>
                  </div>

                  <p className="line-clamp-2 text-sm leading-relaxed text-fg-muted">
                    {emp.description}
                  </p>

                  {capTypes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {capTypes.map((t) => {
                        const meta = CAPABILITY_TYPE_META[t];
                        return (
                          <Badge key={t} className={meta.tone}>
                            {meta.label}
                          </Badge>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-xs text-fg-subtle">
                    <span>
                      订阅于{' '}
                      {formatDistanceToNow(new Date(sub.createdAt), {
                        addSuffix: true,
                        locale: zhCN,
                      })}
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <Link href={`/chat?employeeId=${emp.id}`} className="flex-1">
                      <Button variant="secondary" size="sm" className="w-full">
                        <MessageSquare className="h-4 w-4" />
                        开始对话
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={unsubscribe.isPending}
                      onClick={() => {
                        if (confirm(`确定取消订阅「${emp.name}」吗？`)) {
                          unsubscribe.mutate(sub.id, {
                            onSuccess: () => toast.success(`已取消订阅「${emp.name}」`),
                            onError: (e) => toast.error(`取消失败: ${(e as Error).message}`),
                          });
                        }
                      }}
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
    </div>
  );
}
