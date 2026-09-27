'use client';

import { Activity, CheckCircle2, CircleAlert, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CenteredSpinner } from '@/components/ui/feedback';
import { useAuthEvents, type AuthEvent } from '@/features/auth/use-auth';
import { ApiError } from '@/lib/api-client';

const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: '登录成功',
  LOGIN_FAILED: '登录失败',
  LOGOUT: '退出登录',
  LOGOUT_ALL: '退出全部设备',
  PASSWORD_CHANGED: '修改密码',
  PASSWORD_RESET_REQUESTED: '申请重置密码',
  PASSWORD_RESET_COMPLETED: '完成密码重置',
  EMAIL_VERIFICATION_REQUESTED: '申请邮箱验证',
  EMAIL_VERIFIED: '完成邮箱验证',
  EMAIL_CHANGED: '修改邮箱',
  IDENTITY_LINKED: '绑定第三方账号',
  IDENTITY_UNLINKED: '解绑第三方账号',
  TOKEN_REPLAY: '检测到令牌重放',
  SESSION_REVOKED: '撤销登录设备',
  OAUTH_CALLBACK_FAILED: '第三方登录失败',
};

const PROVIDER_LABELS: Record<string, string> = {
  wechat: '微信',
  qq: 'QQ',
  password: '密码',
  oauth: '第三方登录',
};

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action;
}

function providerLabel(provider: string | null) {
  return provider ? PROVIDER_LABELS[provider] ?? provider : null;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

function maskSessionId(sessionId: string | null) {
  if (!sessionId) return null;
  return sessionId.length > 10 ? `${sessionId.slice(0, 6)}…${sessionId.slice(-4)}` : sessionId;
}

function EventRow({ event }: { event: AuthEvent }) {
  const provider = providerLabel(event.provider);
  const session = maskSessionId(event.sessionId);
  return (
    <div className="flex gap-3 border-b border-border py-4 last:border-0">
      <div className="mt-0.5 shrink-0">
        {event.success ? (
          <CheckCircle2 className="h-5 w-5 text-success" aria-label="成功" />
        ) : (
          <CircleAlert className="h-5 w-5 text-danger" aria-label="失败" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-foreground">{actionLabel(event.action)}</p>
          <Badge variant={event.success ? 'secondary' : 'glass-danger'}>
            {event.success ? '成功' : '失败'}
          </Badge>
          {provider && <span className="text-xs text-fg-muted">方式：{provider}</span>}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
          <span>{formatDate(event.createdAt)}</span>
          {session && <span>会话：{session}</span>}
          {event.ipAddress && <span>IP：{event.ipAddress}</span>}
        </div>
        {event.userAgent && (
          <p className="mt-1 truncate text-xs text-fg-muted" title={event.userAgent}>
            {event.userAgent}
          </p>
        )}
      </div>
    </div>
  );
}

export default function SecurityEventsPage() {
  const events = useAuthEvents();

  if (events.isLoading) return <CenteredSpinner label="加载认证活动…" />;

  if (events.error) {
    const message = events.error instanceof ApiError ? events.error.message : '加载认证活动失败，请稍后重试';
    return (
      <div className="max-w-3xl p-6">
        <p role="alert" className="text-sm text-danger">{message}</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">认证活动</h1>
        <p className="mt-1 text-sm text-fg-muted">
          查看最近的登录、密码、邮箱和第三方账号安全操作。敏感凭据不会出现在活动记录中。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" />最近活动</CardTitle>
          <CardDescription>仅展示当前账号的最近 30 条认证事件，按发生时间倒序排列。</CardDescription>
        </CardHeader>
        <CardContent>
          {(events.data ?? []).length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-fg-muted">
              暂无认证活动记录。
            </div>
          ) : (
            <div>{events.data?.map((event) => <EventRow key={event.id} event={event} />)}</div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-fg-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>如果发现不认识的登录活动，请立即修改密码并在“登录设备”中退出异常会话。</p>
      </div>
    </div>
  );
}
