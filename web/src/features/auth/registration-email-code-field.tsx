'use client';

import { useEffect, useState } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { z } from 'zod';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { useSendRegistrationEmailCode } from './use-auth';

export function RegistrationEmailCodeField({
  email,
  registration,
  error,
}: {
  email: string;
  registration: UseFormRegisterReturn;
  error?: string;
}) {
  const sendCode = useSendRegistrationEmailCode();
  const [cooldown, setCooldown] = useState(0);
  const [requestedEmail, setRequestedEmail] = useState('');
  const normalizedEmail = email.trim().toLowerCase();
  const validEmail = z.string().email().safeParse(normalizedEmail).success;

  useEffect(() => {
    if (cooldown === 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const requestCode = () => {
    setRequestedEmail(normalizedEmail);
    sendCode.mutate(
      { email: normalizedEmail },
      { onSuccess: () => setCooldown(60) },
    );
  };

  const currentRequest = requestedEmail === normalizedEmail;
  const sendError = sendCode.error instanceof ApiError
    ? sendCode.error.message
    : sendCode.error
      ? '验证码发送失败，请稍后重试'
      : null;

  return (
    <div>
      <label htmlFor="registration-email-code" className="mb-1.5 block text-sm font-medium text-gtext-primary">
        邮箱验证码
      </label>
      <div className="flex gap-2">
        <Input
          id="registration-email-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="输入 6 位验证码"
          aria-invalid={Boolean(error)}
          {...registration}
        />
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          disabled={!validEmail || sendCode.isPending || cooldown > 0}
          onClick={requestCode}
        >
          <Mail className="h-4 w-4" />
          {sendCode.isPending ? '发送中…' : cooldown > 0 ? `${cooldown} 秒后重发` : '发送验证码'}
        </Button>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
      {currentRequest && sendCode.isSuccess && (
        <p role="status" className="mt-1 text-xs text-gtext-secondary">
          {sendCode.data.message}，请检查收件箱和垃圾邮件。
        </p>
      )}
      {currentRequest && sendError && (
        <p role="alert" className="mt-1 text-xs text-danger">{sendError}</p>
      )}
    </div>
  );
}
