'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Wrench, Check, Package, PlayCircle, BarChart3,
} from 'lucide-react';
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

      {/* 详情页五段式（方案 §7.1）：
          我是谁 / 我能做什么 / 如何使用 / 做得怎么样 / 如何获得
          「如何获得」提到第二位 —— 访客看完介绍最想知道的是下一步怎么做 */}

      {/* 一 · 我是谁 */}
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
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 五 · 如何获得（放在前面，因为这是访客最想知道的下一步动作） */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            如何获得
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            {subscribed ? (
              <>
                <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
                  <Check className="h-4 w-4" />
                  本企业已订阅
                </span>
                {/* 订阅后的下一步是建实例，不是聊天（会话已暂停） */}
                <Link href="/instances">
                  <Button variant="secondary" size="sm">
                    去创建实例
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
                      toast.success(`已订阅「${emp.name}」，可去「员工实例」创建实例`),
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

            {typeof emp.price === 'number' && emp.price > 0 ? (
              <span className="text-sm text-fg-muted">¥{emp.price} / 月</span>
            ) : (
              <span className="text-sm text-fg-muted">免费</span>
            )}
          </div>
          <p className="mt-3 text-xs text-fg-subtle">
            订阅由企业管理员操作，作用于整个企业；普通成员如需使用，
            请联系管理员开通授权。
          </p>
        </CardContent>
      </Card>

      {/* 二 · 我能做什么 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            我能做什么
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

      {/* 三 · 如何使用 —— 纯静态说明，讲清从订阅到用起来的路径 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlayCircle className="h-5 w-5" />
            如何使用
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {[
              {
                t: '企业订阅',
                d: '由企业管理员订阅该员工，获得使用权。订阅是企业级的，一次订阅可在多处部署。',
              },
              {
                t: '创建实例',
                d: '在「员工实例」为具体部门创建实例。同一员工可创建多个实例，各自独立配置、互不影响。',
              },
              {
                t: '开通授权',
                d: '把实例授权给部门或具体成员，可设到期时间。被授权的人在「我的员工」里就能看到它。',
              },
              {
                t: '下载到本地运行',
                d: '员工以员工包形式下载到本地，放入你自己的运行环境即可使用；企业知识库留在本地不出内网。',
              },
            ].map((s, i) => (
              <li key={s.t} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{s.t}</p>
                  <p className="mt-0.5 text-sm text-fg-muted">{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* 四 · 做得怎么样 —— 本期无履历上报，显式说明而非放假数字 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            做得怎么样
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-fg-muted">已服务企业</p>
              <p className="mt-1 text-xl font-semibold">
                {emp._count?.subscriptions ?? 0}
              </p>
            </div>
            <div className="rounded-lg border border-dashed border-border p-3">
              <p className="text-xs text-fg-muted">累计任务量</p>
              <p className="mt-1 text-xl font-semibold text-fg-subtle">—</p>
            </div>
            <div className="rounded-lg border border-dashed border-border p-3">
              <p className="text-xs text-fg-muted">任务成功率</p>
              <p className="mt-1 text-xl font-semibold text-fg-subtle">—</p>
            </div>
          </div>
          {/* 空数据必须说清「为什么没有」，否则用户无法判断是没数据还是坏了 */}
          <p className="mt-3 text-xs text-fg-subtle">
            员工在本地运行，任务量与成功率依赖客户端回传履历，本期尚未接入 ——
            故这两项暂无数据，而非为 0。「已服务企业」取自平台订阅记录，是真实值。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
