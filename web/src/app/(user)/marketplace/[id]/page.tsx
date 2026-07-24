'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, MessageSquare, Wrench } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CenteredSpinner } from '@/components/ui/feedback';
import { cn, CAPABILITY_TYPE_META } from '@/lib/utils';
import { useEmployee } from '@/features/employee/use-employees';
import { useSubscriptions, useSubscribe } from '@/features/subscription/use-subscriptions';

export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { data: emp, isLoading } = useEmployee(id);
  const { data: subs = [] } = useSubscriptions();
  const subscribe = useSubscribe();

  const subscribed = subs.some((s) => s.employee.id === id);

  if (isLoading) return <CenteredSpinner label="加载中…" />;
  if (!emp) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-fg-muted">员工不存在</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
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
            <Avatar name={emp.name} src={emp.avatar} className="h-24 w-24 text-2xl" />
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-foreground">{emp.name}</h1>
              <p className="mt-1 text-sm text-fg-muted">
                {emp.position} · {emp.industry}
              </p>
              <p className="mt-3 leading-relaxed text-foreground">
                {emp.description}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {subscribed ? (
                  <Link href={`/chat?employeeId=${emp.id}`}>
                    <Button size="sm">
                      <MessageSquare className="h-4 w-4" />
                      开始对话
                    </Button>
                  </Link>
                ) : (
                  <Button
                    size="sm"
                    disabled={subscribe.isPending}
                    onClick={() => subscribe.mutate(emp.id)}
                  >
                    订阅
                  </Button>
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
              {emp.bindings
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
                        {cap.industry && cap.industry.length > 0 && (
                          <p className="mt-1 text-xs text-fg-subtle">
                            行业：{cap.industry.join('、')}
                          </p>
                        )}
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
