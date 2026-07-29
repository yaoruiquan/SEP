'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Search, Users, Check } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { cn, CAPABILITY_TYPE_META } from '@/lib/utils';
import { useAuthStore } from '@/lib/auth-store';
import { useMarketEmployees } from '@/features/employee/use-employees';
import { useSubscriptions, useSubscribe } from '@/features/subscription/use-subscriptions';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';

export default function MarketplacePage() {
  const { token, hydrated } = useAuthStore();
  const loggedIn = hydrated && Boolean(token);

  // 搜索走服务端（后端支持 ?search=），300ms 防抖
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearch(input), 300);
    return () => clearTimeout(t);
  }, [input]);

  const { data: employees = [], isLoading } = useMarketEmployees(search);

  // 订阅列表需登录 —— 访客不请求，否则每次都白跑一轮 401 + refresh
  const { data: subs = [] } = useSubscriptions({ enabled: loggedIn });
  const subscribe = useSubscribe();
  const subscribedIds = new Set(subs.map((s) => s.employee.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">硅基人才市场</h1>
        <p className="mt-1 text-sm text-fg-muted">
          挑选适合你团队的硅基员工，订阅后即可为部门创建实例
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="搜索员工名称、行业、岗位…"
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : employees.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title={search ? '没有找到匹配的员工' : '暂无已上架的员工'}
          description={search ? '试试其他关键词' : '请稍后再来'}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {employees.map((emp) => {
            const subscribed = subscribedIds.has(emp.id);
            const capTypes = Array.from(
              new Set(emp.bindings?.map((b) => b.capability.type) ?? []),
            );

            return (
              <Card
                key={emp.id}
                className={cn(
                  'relative flex flex-col overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-lg',
                  subscribed && 'ring-1 ring-primary/30',
                )}
              >
                {subscribed && (
                  <span className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    <Check className="h-3 w-3" />
                    已订阅
                  </span>
                )}
                <CardContent className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex items-start gap-3">
                    <Avatar
                      name={emp.name}
                      src={emp.avatar}
                      className="h-12 w-12 shrink-0 ring-2 ring-primary/15"
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="line-clamp-1 font-semibold text-foreground">
                        {emp.name}
                      </h3>
                      <p className="text-xs text-fg-muted">
                        {emp.position} · {emp.industry}
                      </p>
                    </div>
                  </div>

                  <p className="line-clamp-3 flex-1 text-sm leading-relaxed text-fg-muted">
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

                  <div className="flex items-center gap-2">
                    {subscribed ? (
                      // 订阅后的下一步是「建实例」，不是聊天（会话已暂停）
                      <Link href="/my-employees" className="flex-1">
                        <Button variant="secondary" size="sm" className="w-full">
                          管理实例
                        </Button>
                      </Link>
                    ) : loggedIn ? (
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={subscribe.isPending}
                        onClick={() =>
                          subscribe.mutate(emp.id, {
                            onSuccess: () => toast.success(`已订阅「${emp.name}」`),
                            onError: (e) =>
                              toast.error(
                                e instanceof ApiError ? e.message : '订阅失败',
                              ),
                          })
                        }
                      >
                        订阅
                      </Button>
                    ) : (
                      // 访客：带 redirect 跳登录，登录后回到该员工详情
                      <Link
                        href={`/login?redirect=${encodeURIComponent(`/marketplace/${emp.id}`)}`}
                        className="flex-1"
                      >
                        <Button size="sm" className="w-full">
                          登录后订阅
                        </Button>
                      </Link>
                    )}
                    <Link href={`/marketplace/${emp.id}`}>
                      <Button variant="ghost" size="sm">
                        详情
                      </Button>
                    </Link>
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
