'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/feedback';
import { useRequestPasswordReset } from '@/features/auth/use-auth';
import { ApiError } from '@/lib/api-client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const request = useRequestPasswordReset();
  const submitted = request.isSuccess;
  return (
    <div>
      <h2 className="text-2xl font-semibold text-gtext-primary">忘记密码</h2>
      <p className="mt-1 text-sm text-gtext-secondary">输入注册邮箱，我们会发送重置密码邮件。</p>
      {submitted ? (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-3 text-sm text-gtext-primary">
            如果该邮箱已注册，你会收到密码重置邮件。请在 20 分钟内完成操作。
          </div>
          <Link href="/login" className="block text-center text-sm text-primary hover:underline">返回登录</Link>
        </div>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); request.mutate({ email }); }}>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gtext-primary">邮箱</label>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </div>
          {request.error && <p className="text-sm text-danger">{request.error instanceof ApiError ? request.error.message : '请求失败，请稍后再试'}</p>}
          <Button type="submit" className="w-full" disabled={request.isPending}>{request.isPending && <Spinner />}发送重置邮件</Button>
          <Link href="/login" className="block text-center text-sm text-gtext-secondary hover:underline">返回登录</Link>
        </form>
      )}
    </div>
  );
}
