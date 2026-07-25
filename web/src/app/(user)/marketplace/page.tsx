'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search, Users } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CenteredSpinner, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { cn, CAPABILITY_TYPE_META } from '@/lib/utils';
import { usePublishedEmployees } from '@/features/employee/use-employees';
import { useSubscriptions, useSubscribe } from '@/features/subscription/use-subscriptions';

export default function MarketplacePage() {
  const { data: employees = [], isLoading } = usePublishedEmployees();
  const { data: subs = [] } = useSubscriptions();
  const subscribe = useSubscribe();
  const [search, setSearch] = useState('');

  const subscribedIds = new Set(subs.map((s) => s.employee.id));

  const filtered = employees.filter((emp) => {
    const q = search.toLowerCase();
    return (
      emp.name.toLowerCase().includes(q) ||
      emp.description.toLowerCase().includes(q) ||
      emp.industry.toLowerCase().includes(q) ||
      emp.position.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">员工广场</h1>
        <p className="mt-1 text-sm text-fg-muted">挑选你的碳基员工，订阅后即可开始对话</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索员工名称、行业、职位…"
          className="pl-9"
        />
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
          title={search ? '没有找到匹配的员工' : '暂无可用员工'}
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
                  <span className="absolute right-2 top-2 z-10 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
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
                      <Link href={`/chat?employeeId=${emp.id}`} className="flex-1">
                        <Button variant="secondary" size="sm" className="w-full">
                          开始对话
                        </Button>
                      </Link>
                    ) : (
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={subscribe.isPending}
                        onClick={() => subscribe.mutate(emp.id)}
                      >
                        订阅
                      </Button>
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
