'use client';

import { useState } from 'react';
import { Link2, Loader2, ShieldCheck, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CenteredSpinner } from '@/components/ui/feedback';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  useOAuthIdentities,
  useStartOAuthLink,
  useUnlinkOAuthIdentity,
  type OAuthIdentity,
} from '@/features/auth/use-auth';
import { ApiError } from '@/lib/api-client';

const PROVIDERS = {
  wechat: { name: '微信', description: '使用微信扫码登录和绑定' },
  qq: { name: 'QQ', description: '使用 QQ 登录和绑定' },
} as const;

type Provider = keyof typeof PROVIDERS;

export default function OAuthIdentitiesPage() {
  const identities = useOAuthIdentities();
  const startLink = useStartOAuthLink();
  const unlink = useUnlinkOAuthIdentity();
  const [pendingUnlink, setPendingUnlink] = useState<OAuthIdentity | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  if (identities.isLoading) return <CenteredSpinner label="加载第三方账号…" />;

  const bound = new Map((identities.data ?? []).map((identity) => [identity.provider, identity]));
  const providerError = (error: unknown, fallback: string) =>
    error instanceof ApiError ? error.message : fallback;

  const handleLink = (provider: Provider) => {
    setLinkError(null);
    startLink.mutate(provider, {
      onError: (error) => setLinkError(providerError(error, '启动绑定失败，请稍后重试')),
    });
  };

  const confirmUnlink = () => {
    if (!pendingUnlink) return;
    unlink.mutate(pendingUnlink.id, {
      onSuccess: () => setPendingUnlink(null),
    });
  };

  return (
    <div className="max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">第三方账号</h1>
        <p className="mt-1 text-sm text-fg-muted">
          绑定微信或 QQ 后，可以在登录时直接使用对应账号。绑定不会改变你的登录邮箱。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" />登录方式</CardTitle>
          <CardDescription>为避免账号被锁定，解绑前请确保仍保留密码或另一种登录方式。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.entries(PROVIDERS).map(([provider, config]) => {
            const identity = bound.get(provider);
            return (
              <div key={provider} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
                    {provider === 'wechat' ? '微' : 'Q'}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{config.name}</p>
                    <p className="text-xs text-fg-muted">{identity?.providerEmail || config.description}</p>
                  </div>
                </div>
                {identity ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-success">已绑定</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => setPendingUnlink(identity)} disabled={unlink.isPending}>
                      <Unlink className="mr-1.5 h-4 w-4" />解绑
                    </Button>
                  </div>
                ) : (
                  <Button type="button" variant="outline" size="sm" onClick={() => handleLink(provider as Provider)} disabled={startLink.isPending}>
                    {startLink.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                    绑定{config.name}
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-fg-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>第三方平台不会获得你的平台密码。解绑最后一个第三方账号前，系统会检查是否已有可用密码登录方式。</p>
      </div>

      {(identities.error || linkError || unlink.error) && (
        <p role="alert" className="text-sm text-danger">
          {linkError || providerError(unlink.error || identities.error, '操作失败，请稍后重试')}
        </p>
      )}

      <ConfirmDialog
        open={Boolean(pendingUnlink)}
        onOpenChange={(open) => !open && setPendingUnlink(null)}
        title={`解绑${pendingUnlink ? PROVIDERS[pendingUnlink.provider as Provider]?.name ?? '第三方账号' : '第三方账号'}`}
        description="解绑后将不能再使用该第三方账号登录。确定继续吗？"
        confirmText="确认解绑"
        variant="danger"
        loading={unlink.isPending}
        onConfirm={confirmUnlink}
      />
    </div>
  );
}
