'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CenteredSpinner } from '@/components/ui/feedback';
import { useConfirmEmailVerification } from '@/features/auth/use-auth';

export default function VerifyEmailPage() {
  return <Suspense fallback={<CenteredSpinner label="正在验证…" />}><VerifyEmailInner /></Suspense>;
}
function VerifyEmailInner() {
  const token = useSearchParams().get('token');
  const router = useRouter();
  const verify = useConfirmEmailVerification();
  useEffect(() => { if (token) verify.mutate(token); }, [token]);
  return <div className="text-center">
    <h2 className="text-2xl font-semibold text-gtext-primary">邮箱验证</h2>
    <p className="mt-3 text-sm text-gtext-secondary">{verify.isPending ? '正在验证…' : verify.isSuccess ? '验证成功，即将返回登录。' : '验证链接无效或已过期。'}</p>
    {verify.isSuccess && <button className="mt-6 text-sm text-primary hover:underline" onClick={() => router.replace('/login')}>返回登录</button>}
  </div>;
}
