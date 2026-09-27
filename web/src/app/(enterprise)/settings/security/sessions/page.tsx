'use client';

import { useState } from 'react';
import { Laptop, Loader2, LogOut, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CenteredSpinner } from '@/components/ui/feedback';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  useAuthSessions,
  useRevokeAllAuthSessions,
  useRevokeAuthSession,
  type AuthSession,
} from '@/features/auth/use-auth';
import { ApiError } from '@/lib/api-client';

function formatDate(value: string | null) {
  if (!value) return '暂无记录';
  return new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

function sessionLabel(session: AuthSession) {
  return session.type === 'DESKTOP' ? '桌面客户端' : '浏览器';
}

export default function SecuritySessionsPage() {
  const sessions = useAuthSessions();
  const revoke = useRevokeAuthSession();
  const revokeAll = useRevokeAllAuthSessions();
  const [pending, setPending] = useState<AuthSession | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  if (sessions.isLoading) return <CenteredSpinner label="加载登录设备…" />;

  const sessionError = sessions.error || revoke.error || revokeAll.error;
  const message = sessionError instanceof ApiError ? sessionError.message : '操作失败，请稍后重试';

  const confirmRevoke = async () => {
    if (!pending) return;
    await revoke.mutateAsync(pending.id);
    setPending(null);
  };

  return (
    <div className="max-w-3xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">登录设备</h1>
          <p className="mt-1 text-sm text-fg-muted">
            查看账号当前登录的浏览器和桌面客户端。发现异常设备时可以立即退出。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirmAll(true)}
          disabled={revokeAll.isPending || sessions.data?.length === 0}
        >
          {revokeAll.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          退出全部设备
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>当前会话</CardTitle>
          <CardDescription>
            当前设备会标记为“本设备”。退出全部设备后，你需要重新登录。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(sessions.data ?? []).length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-fg-muted">
              当前没有可用登录会话。
            </div>
          ) : (
            sessions.data?.map((session) => {
              const Icon = session.type === 'DESKTOP' ? Laptop : MonitorSmartphone;
              return (
                <div key={session.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">{sessionLabel(session)}</p>
                        {session.isCurrent && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">本设备</span>}
                      </div>
                      <p className="mt-1 text-xs text-fg-muted">最近活跃：{formatDate(session.lastUsedAt)}</p>
                      <p className="text-xs text-fg-muted">创建于：{formatDate(session.createdAt)} · 有效期至：{formatDate(session.expiresAt)}</p>
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setPending(session)} disabled={revoke.isPending}>
                    <LogOut className="mr-1.5 h-4 w-4" />退出
                  </Button>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-fg-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>退出设备会立即撤销该设备的 Refresh Token；已发出的短期 Access Token 也会在自然过期后失效。</p>
      </div>

      {sessionError && <p role="alert" className="text-sm text-danger">{message}</p>}

      <ConfirmDialog
        open={Boolean(pending)}
        onOpenChange={(open) => !open && setPending(null)}
        title={`退出${pending?.isCurrent ? '本设备' : '该设备'}`}
        description="退出后该设备需要重新登录。确定继续吗？"
        confirmText="确认退出"
        variant="danger"
        loading={revoke.isPending}
        onConfirm={confirmRevoke}
      />

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="退出全部设备"
        description="这会撤销账号的全部登录会话，包括本设备。确定继续吗？"
        confirmText="退出全部"
        variant="danger"
        loading={revokeAll.isPending}
        onConfirm={() => revokeAll.mutateAsync()}
      />
    </div>
  );
}
