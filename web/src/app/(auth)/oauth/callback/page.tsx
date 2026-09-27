'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { CenteredSpinner } from '@/components/ui/feedback';
import { tryRefresh } from '@/lib/api-client';
import { useAuthStore, defaultHomeFor } from '@/lib/auth-store';

export default function OAuthCallbackPage() {
  return <Suspense fallback={<CenteredSpinner label="正在完成登录…" />}><OAuthCallback /></Suspense>;
}

function OAuthCallback() {
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get('status');
  const intent = params.get('intent');
  const reason = params.get('reason');
  const setHydrated = useAuthStore((s) => s.setHydrated);

  useEffect(() => {
    let cancelled = false;
    if (status !== 'success') return;
    void tryRefresh().then((ok) => {
      if (cancelled) return;
      setHydrated();
      if (ok) {
        const state = useAuthStore.getState();
        router.replace(intent === 'LINK' ? '/settings/security/identities' : defaultHomeFor(state.user, state.enterprise));
      }
    });
    return () => { cancelled = true; };
  }, [intent, router, setHydrated, status]);

  if (status === 'success') return <CenteredSpinner label="登录成功，正在进入平台…" />;
  const message = status === 'cancelled'
    ? '你已取消第三方登录。'
    : intent === 'INVITATION' && reason === 'invitation_email_mismatch'
      ? '第三方账号与邀请邮箱不匹配，请使用邀请邮箱对应的账号。'
      : intent === 'INVITATION' && reason === 'account_conflict'
        ? '邀请邮箱已有账号，请先使用邮箱密码登录，再回到邀请链接接受邀请。'
        : intent === 'INVITATION' && reason === 'invitation_invalid'
          ? '邀请链接已失效，请联系企业管理员重新生成邀请。'
          : '第三方登录未完成，请重新尝试。';
  return (
    <div className="space-y-4 text-center">
      <h2 className="text-2xl font-semibold text-gtext-primary">无法完成登录</h2>
      <p className="text-sm text-gtext-secondary">{message}</p>
      <div className="flex justify-center gap-4">
        <Link href="/login" className="text-sm font-medium text-primary hover:underline">返回登录页</Link>
        {intent === 'INVITATION' && (
          <span className="text-xs text-gtext-muted">请使用浏览器返回邀请页重试</span>
        )}
      </div>
    </div>
  );
}
