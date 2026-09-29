'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/feedback';
import { ApiError, api } from '@/lib/api-client';
import { useOAuthProviders, type OAuthProviderId } from './use-auth';

export type OAuthButtonIntent = 'LOGIN' | 'REGISTER' | 'INVITATION';

const ACTION_LABEL: Record<OAuthButtonIntent, string> = {
  LOGIN: '登录',
  REGISTER: '注册',
  INVITATION: '加入',
};

interface OAuthProviderButtonsProps {
  intent: OAuthButtonIntent;
  token?: string;
  disabled?: boolean;
}

/**
 * 公共第三方渠道按钮。
 * 渠道列表来自后端，不在页面里写死：运营端关闭或配置不完整时，
 * 对应按钮不会渲染；后端仍会在 start/callback 处再次校验。
 */
export function OAuthProviderButtons({
  intent,
  token,
  disabled = false,
}: OAuthProviderButtonsProps) {
  const { data, isLoading } = useOAuthProviders();
  const [pending, setPending] = useState<OAuthProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isLoading || !data?.providers.length) return null;

  const start = async (provider: OAuthProviderId) => {
    setPending(provider);
    setError(null);
    try {
      const path = intent === 'REGISTER'
        ? `/auth/oauth/${provider}/register/start`
        : intent === 'INVITATION'
          ? `/auth/oauth/${provider}/invitation/start?token=${encodeURIComponent(token ?? '')}`
          : `/auth/oauth/${provider}/start`;
      const result = await api.get<{ authorizationUrl: string }>(path, { skipAuthRetry: true });
      window.location.assign(result.authorizationUrl);
    } catch (cause) {
      setPending(null);
      setError(cause instanceof ApiError ? cause.message : '第三方登录暂时不可用，请稍后重试');
    }
  };

  return (
    <div className="mt-5 space-y-3">
      <div className="flex items-center gap-3 text-xs text-gtext-tertiary">
        <span className="h-px flex-1 bg-border" />
        <span>或使用以下方式{ACTION_LABEL[intent]}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {data.providers.map((provider) => (
          <Button
            key={provider.id}
            type="button"
            variant="outline"
            disabled={disabled || Boolean(pending)}
            onClick={() => void start(provider.id)}
          >
            {pending === provider.id && <Spinner />}
            {provider.displayName}{ACTION_LABEL[intent]}
          </Button>
        ))}
      </div>
      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
    </div>
  );
}
