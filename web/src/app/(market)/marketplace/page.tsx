'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Search, Users, Check, Zap } from 'lucide-react';
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

const INDUSTRIES = ['全部', '电商零售', '金融服务', '医疗健康', '教育培训', '制造业', '物流运输', '餐饮服务', '企业服务'];

export default function MarketplacePage() {
  const { token, hydrated } = useAuthStore();
  const loggedIn = hydrated && Boolean(token);

  // 搜索走服务端（后端支持 ?search=），300ms 防抖
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [industry, setIndustry] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearch(input), 300);
    return () => clearTimeout(t);
  }, [input]);

  const { data: employees = [], isLoading } = useMarketEmployees(search);

  // 订阅列表需登录 —— 访客不请求，否则每次都白跑一轮 401 + refresh
  const { data: subs = [] } = useSubscriptions({ enabled: loggedIn });
  const subscribe = useSubscribe();
  const subscribedIds = new Set(subs.map((s) => s.employee.id));

  const filtered = search
    ? employees
    : industry
    ? employees.filter((e) => e.industry?.includes(industry))
    : employees;

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#eb3f00] to-orange-400 px-8 py-10 text-white">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="absolute -bottom-6 right-20 h-24 w-24 rounded-full bg-white/8" />
        <div className="relative">
          <p className="mb-2 text-sm font-medium text-orange-100">🌟 硅基员工人才市场</p>
          <h1 className="mb-3 text-3xl font-bold">发现适合你企业的数字员工</h1>
          <p className="text-base text-orange-100">涵盖电商、金融、医疗、教育等 8 大行业，120+ 经过审核的硅基员工等你招聘</p>
        </div>
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

      {/* 行业分类 Chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {INDUSTRIES.map((ind) => (
          <button
            key={ind}
            onClick={() => setIndustry(ind === '全部' ? '' : ind)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-sm transition-all ${
              (ind === '全部' && !industry) || industry === ind
                ? 'border-primary bg-primary text-white'
                : 'border-border bg-card text-fg-muted hover:border-primary/40 hover:text-foreground'
            }`}
          >
            {ind}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title={search ? '没有找到匹配的员工' : '暂无已上架的员工'}
          description={search ? '试试其他关键词' : '请稍后再来'}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((emp) => {
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

                  {/* 能力与版本统计 */}
                  <div className="flex items-center gap-3 border-t border-border pt-3 text-xs text-fg-subtle">
                    <span className="flex items-center gap-1">
                      <Zap className="h-3 w-3" />
                      {emp.bindings?.length ?? 0} 项能力
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" />
                      运行中
                    </span>
                    <span className="ml-auto">v{emp.version ?? '1.0.0'}</span>
                  </div>

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
