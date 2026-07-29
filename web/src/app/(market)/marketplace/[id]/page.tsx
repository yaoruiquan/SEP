'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Wrench, Check, Package } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { cn, CAPABILITY_TYPE_META } from '@/lib/utils';
import { useAuthStore } from '@/lib/auth-store';
import { useMarketEmployee } from '@/features/employee/use-employees';
import { useSubscriptions, useSubscribe } from '@/features/subscription/use-subscriptions';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';

export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { token, hydrated } = useAuthStore();
  const loggedIn = hydrated && Boolean(token);

  // 走公开接口 —— 访客也要能看详情（不能用需登录的 useEmployee）
  const { data: emp, isLoading, isError } = useMarketEmployee(id);
  // 访客不请求订阅列表
  const { data: subs = [] } = useSubscriptions({ enabled: loggedIn });
  const subscribe = useSubscribe();

  const subscribed = subs.some((s) => s.employee.id === id);

  if (isLoading) return <CenteredSpinner label="加载中…" />;

  // 未上架的员工后端返回 404，对访客表现为「不存在」
  if (isError || !emp) {
    return (
      <div className="py-12">
        <EmptyState
          icon={<Package className="h-8 w-8" />}
          title="员工不存在或尚未上架"
          description="它可能已下架，或链接有误。"
          action={
            <Link href="/marketplace">
              <Button size="sm">返回人才市场</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-fg-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        返回
      </button>

      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col items-start gap-6 sm:flex-row">
            <Avatar
              name={emp.name}
              src={emp.avatar}
              className="h-24 w-24 shrink-0 text-2xl"
            />
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-foreground">{emp.name}</h1>
                <Badge className="bg-muted text-fg-muted">v{emp.version}</Badge>
              </div>
              <p className="mt-1 text-sm text-fg-muted">
                {emp.position} · {emp.industry}
              </p>
              <p className="mt-3 leading-relaxed text-foreground">
                {emp.description}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                {subscribed ? (
                  <>
                    <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
                      <Check className="h-4 w-4" />
                      已订阅
                    </span>
                    {/* 订阅后的下一步是建实例，不是聊天（会话已暂停） */}
                    <Link href="/my-employees">
                      <Button variant="secondary" size="sm">
                        管理实例
                      </Button>
                    </Link>
                  </>
                ) : loggedIn ? (
                  <Button
                    size="sm"
                    disabled={subscribe.isPending}
                    onClick={() =>
                      subscribe.mutate(emp.id, {
                        onSuccess: () =>
                          toast.success(`已订阅「${emp.name}」，可去「我的员工」创建实例`),
                        onError: (e) =>
                          toast.error(e instanceof ApiError ? e.message : '订阅失败'),
                      })
                    }
                  >
                    订阅该员工
                  </Button>
                ) : (
                  <Link href={`/login?redirect=${encodeURIComponent(`/marketplace/${emp.id}`)}`}>
                    <Button size="sm">登录后订阅</Button>
                  </Link>
                )}

                {typeof emp.price === 'number' && emp.price > 0 && (
                  <span className="text-sm text-fg-muted">
                    ¥{emp.price} / 月
                  </span>
                )}
                {typeof emp._count?.subscriptions === 'number' && (
                  <span className="text-sm text-fg-subtle">
                    {emp._count.subscriptions} 家企业已订阅
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            硅基能力
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!emp.bindings || emp.bindings.length === 0 ? (
            <p className="text-sm text-fg-muted">暂无绑定能力</p>
          ) : (
            <div className="space-y-3">
              {[...emp.bindings]
                .sort((a, b) => a.order - b.order)
                .map((b) => {
                  const cap = b.capability;
                  const meta = CAPABILITY_TYPE_META[cap.type];
                  return (
                    <div
                      key={b.id}
                      className="flex items-start gap-3 rounded-lg border border-border p-3"
                    >
                      <Badge className={cn('shrink-0', meta.tone)}>
                        {meta.label}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground">{cap.name}</p>
                        <p className="mt-0.5 text-sm text-fg-muted">
                          {cap.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
