'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner, CenteredSpinner } from '@/components/ui/feedback';
import { useResetPassword } from '@/features/auth/use-auth';
import { ApiError } from '@/lib/api-client';

export default function ResetPasswordPage() {
  return <Suspense fallback={<CenteredSpinner label="加载中…" />}><ResetPasswordForm /></Suspense>;
}
function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const reset = useResetPassword();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!token || password.length < 8 || password !== confirm) return;
    reset.mutate({ token, newPassword: password });
  };
  return <div>
    <h2 className="text-2xl font-semibold text-gtext-primary">设置新密码</h2>
    <p className="mt-1 text-sm text-gtext-secondary">密码至少 8 位。重置成功后需要重新登录。</p>
    <form className="mt-6 space-y-4" onSubmit={submit}>
      <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="新密码" />
      <Input type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="再次输入新密码" />
      {password && confirm && password !== confirm && <p className="text-sm text-danger">两次密码不一致</p>}
      {reset.error && <p className="text-sm text-danger">{reset.error instanceof ApiError ? reset.error.message : '重置失败，请重新申请链接'}</p>}
      <Button type="submit" className="w-full" disabled={reset.isPending || !token || password.length < 8 || password !== confirm}>{reset.isPending && <Spinner />}确认重置</Button>
      <Link href="/login" className="block text-center text-sm text-gtext-secondary hover:underline">返回登录</Link>
    </form>
  </div>;
}
