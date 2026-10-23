'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle, Check, Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CenteredSpinner } from '@/components/ui/feedback';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import {
  AccountClosureRequestSchema,
  type AccountClosureEligibility,
  type AccountClosureResult,
} from 'shared/account-closure';
import {
  useAccountClosureEligibility,
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
  const token = useSearchParams().get('token');
  const { user, hydrated } = useAuthStore();
  const eligibility = useAccountClosureEligibility(Boolean(hydrated && user));
  const request = useRequestAccountClosureVerification();
  const submit = useSubmitAccountClosure();
  const [confirmation, setConfirmation] = useState('');
  const [result, setResult] = useState<AccountClosureResult | null>(null);
  const parsed = AccountClosureRequestSchema.safeParse({ token, confirmation });

  if (!hydrated) return <CenteredSpinner label="加载中…" />;
  if (result)
    return (
      <div className="space-y-4">
        <Check className="h-6 w-6 text-success" />
        <h2 className="text-xl font-semibold">账号已注销</h2>
        <p className="text-sm text-fg-muted">
          已于 {new Date(result.closedAt).toLocaleString('zh-CN')}{' '}
          生效，无法撤销。原邮箱可在获得新邀请后重新注册。
        </p>
        {result.closedEnterprises.length > 0 && (
          <div className="space-y-2 text-sm">
            <p>以下企业已同时关闭：</p>
            <ul className="list-disc space-y-1 pl-5">
              {result.closedEnterprises.map((enterprise) => (
                <li key={enterprise.id}>{enterprise.name}</li>
              ))}
            </ul>
          </div>
        )}
        <Link className="text-sm text-primary underline" href="/login">
          返回登录
        </Link>
      </div>
    );
  if (!user) {
    const returnPath = token
      ? `/account-closure?token=${encodeURIComponent(token)}`
      : '/account-closure';
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">请先登录</h2>
        <p className="text-sm text-fg-muted">登录本人账号后才能继续注销。</p>
        <Link
          className="text-sm text-primary underline"
          href={`/login?redirect=${encodeURIComponent(returnPath)}`}
        >
          返回登录
        </Link>
      </div>
    );
  }
  if (request.isSuccess && !token)
    return (
      <div className="space-y-4">
        <Mail className="h-6 w-6 text-success" />
        <h2 className="text-xl font-semibold">验证邮件已发送</h2>
        <p className="text-sm text-fg-muted">
          请在 20
          分钟内打开邮箱中的专用链接。打开链接后仍需输入“注销账号”并确认，确认成功后立即生效。
        </p>
      </div>
    );

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">
        {token ? '确认注销账号' : '注销账号'}
      </h2>
      <p className="text-sm leading-relaxed text-fg-muted">
        邮件验证并确认后，账号立即注销且无法恢复，全部登录设备失效。原邮箱只能在获得新邀请后重新注册。企业账务和历史工作记录会按平台规则保留并以匿名主体关联，个人身份资料将按平台规则处理。
      </p>
      {eligibility.isLoading ? (
        <CenteredSpinner label="检查账号状态…" />
      ) : (
        eligibility.data && <EligibilityPanel data={eligibility.data} />
      )}
      <ErrorText error={eligibility.error} />
      {token ? (
        <>
          <label className="block text-sm" htmlFor="closure-confirmation">
            输入“注销账号”以确认立即注销
          </label>
          <Input
            id="closure-confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="注销账号"
            disabled={submit.isPending}
          />
          <Button
            variant="danger"
            className="w-full"
            disabled={
              !parsed.success || !eligibility.data?.eligible || submit.isPending
            }
            onClick={() =>
              parsed.success &&
              submit.mutate(parsed.data, { onSuccess: setResult })
            }
          >
            {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            确认立即注销
          </Button>
          <ErrorText error={submit.error} />
        </>
      ) : (
        <>
          <Button
            className="w-full"
            disabled={request.isPending || !eligibility.data?.eligible}
            onClick={() => request.mutate()}
          >
            {request.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            发送注销验证邮件
          </Button>
          <ErrorText error={request.error} />
        </>
      )}
    </div>
  );
}

function EligibilityPanel({ data }: { data: AccountClosureEligibility }) {
  return (
    <div className="space-y-3">
      {data.blockers.length > 0 && (
        <div className="space-y-2 rounded-md border border-warning/30 bg-warning/10 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4" />
            暂时无法注销
          </p>
          {data.blockers.map((item) => (
            <p key={item.code} className="text-sm text-fg-muted">
              {item.message}
            </p>
          ))}
        </div>
      )}
      {data.enterprisesToClose.length > 0 && (
        <div className="space-y-2 rounded-md border border-danger/30 bg-danger/10 p-3">
          <p className="text-sm font-medium">
            以下企业只剩你一名成员，将同时关闭：
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {data.enterprisesToClose.map((enterprise) => (
              <li key={enterprise.id}>{enterprise.name}</li>
            ))}
          </ul>
          <p className="text-sm text-fg-muted">
            关闭后企业不可继续使用，其订阅及相关访问权限将终止，企业历史数据按平台规则保留。此操作无法撤销。
          </p>
        </div>
      )}
    </div>
  );
}
