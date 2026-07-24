'use client';

import Link from 'next/link';
import { Bot, MessageSquare, Users, Zap } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { CenteredSpinner, EmptyState, Skeleton } from '@/components/ui/feedback';
import { useMe } from '@/features/user/use-user';
import { useSubscriptions } from '@/features/subscription/use-subscriptions';
import { useConversations } from '@/features/chat/use-conversations';

export default function DashboardPage() {
  const { data: me } = useMe();
  const { data: subs = [], isLoading: subsLoading } = useSubscriptions();
  const { data: convs = [], isLoading: convsLoading } = useConversations();

  // derive stats client-side per design doc §9
  const activeSubs = subs.length;
  const totalConvs = convs.length;
  const totalMessages = convs.reduce((sum, c) => sum + (c._count?.messages ?? 0), 0);
  const recentConvs = [...convs].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  ).slice(0, 5);

  const greeting = me?.name ? `你好，${me.name}` : '你好';

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{greeting}</h1>
        <p className="mt-1 text-sm text-fg-muted">欢迎回到硅基人才平台</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="活跃订阅"
          value={activeSubs}
          loading={subsLoading}
        />
        <StatCard
          icon={<MessageSquare className="h-5 w-5" />}
          label="累计会话"
          value={totalConvs}
          loading={convsLoading}
        />
        <StatCard
          icon={<Zap className="h-5 w-5" />}
          label="累计消息"
          value={totalMessages}
          loading={convsLoading}
        />
        <Link href="/chat" className="block">
          <Card className="h-full transition-colors hover:border-primary/40 hover:bg-primary-subtle/30">
            <CardContent className="flex h-full items-center justify-center p-5">
              <div className="text-center">
                <Bot className="mx-auto h-6 w-6 text-primary" />
                <p className="mt-2 text-sm font-medium text-foreground">开始对话</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {subsLoading ? (
        <Card>
          <CardHeader>
            <CardTitle>我的碳基员工</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : subs.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>我的碳基员工</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              title="你还没有订阅任何员工"
              description="去员工广场挑选一位碳基员工开始使用吧。"
              action={
                <Link href="/marketplace">
                  <Button size="sm">前往员工广场</Button>
                </Link>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>我的碳基员工</CardTitle>
            <Link href="/subscriptions">
              <Button variant="ghost" size="sm">
                查看全部
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {subs.slice(0, 3).map((sub) => {
                const emp = sub.employee;
                return (
                  <Link key={sub.id} href={`/chat?employeeId=${emp.id}`}>
                    <div className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary/40 hover:bg-primary-subtle/20">
                      <Avatar name={emp.name} src={emp.avatar} className="h-10 w-10" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {emp.name}
                        </p>
                        <p className="truncate text-xs text-fg-muted">
                          {emp.position} · {emp.industry}
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>最近会话</CardTitle>
          <Link href="/chat">
            <Button variant="ghost" size="sm">
              查看全部
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {convsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : recentConvs.length === 0 ? (
            <EmptyState
              title="还没有会话记录"
              description="开始和碳基员工对话吧。"
            />
          ) : (
            <ul className="divide-y divide-border">
              {recentConvs.map((conv) => (
                <li key={conv.id}>
                  <Link
                    href={`/chat?sessionId=${conv.id}`}
                    className="flex items-center gap-3 py-3 transition-colors hover:bg-muted/40"
                  >
                    <Avatar
                      name={conv.employee?.name}
                      src={conv.employee?.avatar}
                      className="h-9 w-9 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {conv.title || conv.employee?.name || '新会话'}
                      </p>
                      <p className="text-xs text-fg-subtle">
                        {formatDistanceToNow(new Date(conv.updatedAt), {
                          addSuffix: true,
                          locale: zhCN,
                        })}
                        {conv._count?.messages ? ` · ${conv._count.messages} 条消息` : ''}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  loading,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  loading?: boolean;
  badge?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-subtle text-primary">
          {icon}
        </div>
        <div className="flex-1">
          <p className="text-xs text-fg-muted">{label}</p>
          {loading ? (
            <Skeleton className="mt-1 h-7 w-12" />
          ) : (
            <p className="text-2xl font-bold text-foreground">
              {value}
              {badge && (
                <span className="ml-2 text-xs font-normal text-fg-subtle">
                  {badge}
                </span>
              )}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
