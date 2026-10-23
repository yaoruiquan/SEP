'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle, Check, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CenteredSpinner } from '@/components/ui/feedback';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { AccountClosureRequestSchema } from 'shared/account-closure';
import { AccountClosureRecoverySchema } from 'shared/index';
import type { AccountClosureEligibility } from 'shared/account-closure';
import {
  useAccountClosureEligibility,
  useAccountClosureCancellationPreview,
  useCancelAccountClosure,
  useRecoverAccountClosure,
  useRequestAccountClosureVerification,
  useSubmitAccountClosure,
} from './use-auth';

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {error instanceof ApiError ? error.message : '操作失败，请稍后重试'}
    </p>
  );
}

export function AccountClosureFlow() {
  const params = useSearchParams();
  const token = params.get('token');
  const { user, hydrated } = useAuthStore();
  const eligibility = useAccountClosureEligibility(Boolean(hydrated && user));
  const request = useRequestAccountClosureVerification();
  const submit = useSubmitAccountClosure();
  const [confirmation, setConfirmation] = useState('');
  const [result, setResult] = useState<string | null>(null);

  if (!hydrated) return <CenteredSpinner label="加载中…" />;
  if (result)
    return (
      <MessageCard
        title="注销申请已提交"
        description={`预计生效时间：${new Date(result).toLocaleString('zh-CN')}。在生效前可通过撤销邮件取消申请。`}
      >
        <Check className="h-5 w-5 text-success" />
        <Link className="text-sm text-primary underline" href="/login">
          返回登录
        </Link>
      </MessageCard>
    );
  if (!user) {
    const returnPath = token
      ? `/account-closure?token=${encodeURIComponent(token)}`
      : '/account-closure';
    return (
      <MessageCard title="请先登录" description="登录后才能申请注销账号。">
        <Link
          className="text-sm text-primary underline"
          href={`/login?redirect=${encodeURIComponent(returnPath)}`}
        >
          返回登录
        </Link>
        <Link
          className="text-sm text-fg-muted underline"
          href="/account-closure/recovery"
        >
          获取撤销邮件
        </Link>
      </MessageCard>
    );
  }
  if (token)
    return (
      <ClosureTokenForm
        token={token}
        confirmation={confirmation}
        setConfirmation={setConfirmation}
        submit={submit}
        eligibility={eligibility}
        setResult={setResult}
      />
    );
  if (request.isSuccess) {
    return (
      <MessageCard
        title="验证邮件已发送"
        description="请打开邮箱中的专用链接继续。链接会在短时间后失效。"
      >
        <Mail className="h-5 w-5 text-success" />
      </MessageCard>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>注销账号</CardTitle>
        <CardDescription>
          注销会在宽限期结束后生效，期间可通过邮箱撤销。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {eligibility.isLoading ? (
          <CenteredSpinner label="检查账号状态…" />
        ) : (
          eligibility.data && <EligibilityPanel data={eligibility.data} />
        )}
        <ErrorText error={eligibility.error} />
        <Button
          onClick={() => request.mutate()}
          disabled={request.isPending || !eligibility.data?.eligible}
        >
          {request.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          发送注销验证邮件
        </Button>
        <ErrorText error={request.error} />
        <Link
          className="block text-sm text-fg-muted underline"
          href="/account-closure/recovery"
        >
          已提交申请？重新获取撤销邮件
        </Link>
      </CardContent>
    </Card>
  );
}

function EligibilityPanel({ data }: { data: AccountClosureEligibility }) {
  if (data.blockers.length)
    return (
      <div className="space-y-2 rounded-md border border-warning/30 bg-warning/10 p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4" />
          暂时无法注销
        </div>
        {data.blockers.map((item) => (
          <p key={item.code} className="text-sm text-fg-muted">
            {item.message}
          </p>
        ))}
      </div>
    );
  return (
    <div className="flex gap-2 rounded-md border border-border p-3 text-sm text-fg-muted">
      <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
      账号符合注销条件，申请将在 {data.gracePeriodDays} 天后生效。
    </div>
  );
}

function ClosureTokenForm({
  token,
  confirmation,
  setConfirmation,
  submit,
  eligibility,
  setResult,
}: {
  token: string;
  confirmation: string;
  setConfirmation: (value: string) => void;
  submit: ReturnType<typeof useSubmitAccountClosure>;
  eligibility: ReturnType<typeof useAccountClosureEligibility>;
  setResult: (value: string | null) => void;
}) {
  const parsed = AccountClosureRequestSchema.safeParse({ token, confirmation });
  return (
    <Card>
      <CardHeader>
        <CardTitle>确认注销账号</CardTitle>
        <CardDescription>
          生效后账号将无法恢复，原邮箱可重新注册。企业账务和历史工作记录会按平台规则保留并以匿名主体关联，个人身份资料将按平台规则处理。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {eligibility.isLoading ? (
          <CenteredSpinner label="检查账号状态…" />
        ) : (
          eligibility.data && <EligibilityPanel data={eligibility.data} />
        )}
        <ErrorText error={eligibility.error} />
        <p className="text-sm text-fg-muted">
          输入“注销账号”后提交。申请成功后当前登录会立即失效。
        </p>
        <Input
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          placeholder="注销账号"
          aria-label="注销账号确认"
          disabled={submit.isPending}
        />
        <Button
          variant="danger"
          onClick={() =>
            parsed.success &&
            submit.mutate(parsed.data, {
              onSuccess: (data) => setResult(data.scheduledFor),
            })
          }
          disabled={
            !parsed.success || !eligibility.data?.eligible || submit.isPending
          }
        >
          {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          提交注销申请
        </Button>
        <ErrorText error={submit.error} />
      </CardContent>
    </Card>
  );
}

export function AccountClosureCancelFlow() {
  const token = useSearchParams().get('token');
  const preview = useAccountClosureCancellationPreview(token);
  const cancel = useCancelAccountClosure();
  const [done, setDone] = useState(false);
  if (!token)
    return (
      <MessageCard
        title="撤销链接无效"
        description="请使用邮件中的完整撤销链接。"
      />
    );
  if (done)
    return (
      <MessageCard
        title="注销申请已撤销"
        description="账号不会按原计划注销。请重新登录继续使用。"
      >
        <Link className="text-sm text-primary underline" href="/login">
          去登录
        </Link>
      </MessageCard>
    );
  if (preview.isLoading) return <CenteredSpinner label="验证撤销链接…" />;
  if (preview.error)
    return (
      <MessageCard
        title="无法撤销注销申请"
        description={
          preview.error instanceof ApiError
            ? preview.error.message
            : '撤销链接无效或已失效。'
        }
      />
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>撤销注销申请</CardTitle>
        <CardDescription>
          原计划于{' '}
          {preview.data
            ? new Date(preview.data.scheduledFor).toLocaleString('zh-CN')
            : '宽限期结束后'}{' '}
          生效。撤销后请重新登录。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          onClick={() =>
            cancel.mutate(token, { onSuccess: () => setDone(true) })
          }
          disabled={cancel.isPending || !preview.data?.canCancel}
        >
          {cancel.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          确认撤销
        </Button>
        <ErrorText error={cancel.error} />
      </CardContent>
    </Card>
  );
}

export function AccountClosureRecoveryFlow() {
  const [email, setEmail] = useState('');
  const recovery = useRecoverAccountClosure();
  const parsedEmail = AccountClosureRecoverySchema.safeParse({ email });
  return (
    <Card>
      <CardHeader>
        <CardTitle>找回注销申请</CardTitle>
        <CardDescription>
          输入申请时使用的邮箱，我们会发送撤销链接。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {recovery.isSuccess ? (
          <p className="text-sm text-success">
            如果邮箱存在待处理申请，撤销邮件已发送。
          </p>
        ) : (
          <>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              aria-label="邮箱"
            />
            <Button
              onClick={() =>
                parsedEmail.success && recovery.mutate(parsedEmail.data)
              }
              disabled={!parsedEmail.success || recovery.isPending}
            >
              {recovery.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              发送撤销邮件
            </Button>
            <ErrorText error={recovery.error} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MessageCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {children && (
        <CardContent className="flex items-center gap-3">
          {children}
        </CardContent>
      )}
    </Card>
  );
}
