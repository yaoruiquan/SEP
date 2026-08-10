'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner, CenteredSpinner } from '@/components/ui/feedback';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/lib/auth-store';
import {
  useVerifyInvitation,
  useRegisterByInvitation,
  useAcceptInvitation,
} from '@/features/auth/use-auth';
import { ApiError } from '@/lib/api-client';
import type { InvitationPreview } from '@/lib/types';

const ROLE_LABEL: Record<string, string> = {
  ENTERPRISE_ADMIN: '企业管理员',
  DEPT_MANAGER: '部门负责人',
  MEMBER: '企业成员',
};

/**
 * 受邀加入页。链接形如 `/join?token=xxx`。
 *
 * 这页服务两类人，分支在于「当前浏览器有没有登录态」：
 *   - 没有账号 → 设置密码，POST /auth/register-by-invitation（建号 + 入职一步完成）
 *   - 已有账号 → POST /auth/accept-invitation（只建 membership）
 *
 * 两条路径后端都会比对邀请邮箱，故这页**不让用户填邮箱** ——
 * 邮箱由邀请记录决定，让人填只会制造"填错了才被拒"。
 *
 * useSearchParams 要求 Suspense 边界（Next 15 App Router），故拆成两层。
 */
export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[20rem] items-center justify-center">
          <CenteredSpinner label="加载中…" />
        </div>
      }
    >
      <JoinInner />
    </Suspense>
  );
}

function JoinInner() {
  const token = useSearchParams().get('token');
  const { data, isLoading, error } = useVerifyInvitation(token);

  if (!token) {
    return (
      <InvalidLink
        detail="这个地址里没有邀请码。请直接点击管理员发来的完整链接。"
      />
    );
  }
  if (isLoading) {
    return (
      <div className="flex min-h-[20rem] items-center justify-center">
        <CenteredSpinner label="正在校验邀请…" />
      </div>
    );
  }
  if (error || !data) {
    // 后端对「不存在」「已过期」「已被使用」「已撤回」返回同一句 400 ——
    // 区分它们会让响应差异成为 token 枚举的入口。这里照搬后端措辞，
    // 不自行推测原因，只把可行动的下一步说清楚。
    return (
      <InvalidLink
        detail={
          error instanceof ApiError
            ? error.message
            : '邀请链接无效或已失效。'
        }
      />
    );
  }

  return <ValidInvitation invitation={data} token={token} />;
}

function InvalidLink({ detail }: { detail: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-danger">
        <AlertTriangle className="h-5 w-5" />
        <span className="text-xs font-medium uppercase tracking-wider">
          链接不可用
        </span>
      </div>
      <h2 className="mt-2 text-2xl font-semibold text-gtext-primary">
        无法使用这条邀请
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-gtext-secondary">
        {detail}
      </p>
      <div className="mt-4 rounded-xl border border-glassline bg-glass-2 p-4 text-xs leading-relaxed text-gtext-secondary">
        常见原因：链接已超过有效期、已经被使用过、或管理员重新邀请后旧链接自动作废。
        请联系企业管理员在「成员管理 → 邀请」里重新生成一条。
      </div>
      <div className="mt-6 flex gap-2">
        <Link href="/login" className="flex-1">
          <Button variant="outline" className="w-full">
            去登录
          </Button>
        </Link>
        <Link href="/register" className="flex-1">
          <Button variant="outline" className="w-full">
            去注册
          </Button>
        </Link>
      </div>
    </div>
  );
}

function ValidInvitation({
  invitation,
  token,
}: {
  invitation: InvitationPreview;
  token: string;
}) {
  const { token: authToken, user, enterprise, hydrated } = useAuthStore();
  const loggedIn = hydrated && Boolean(authToken);

  return (
    <div>
      <div className="flex items-center gap-2 text-primary">
        <Building2 className="h-5 w-5" />
        <span className="text-xs font-medium uppercase tracking-wider">
          企业邀请
        </span>
      </div>
      <h2 className="mt-2 text-2xl font-semibold text-gtext-primary">
        加入 {invitation.enterprise.name}
      </h2>

      <dl className="mt-4 space-y-2 rounded-xl border border-glassline bg-glass-2 p-4 text-sm">
        <Row label="邀请邮箱">
          <span className="text-gtext-primary">{invitation.email}</span>
        </Row>
        <Row label="角色">
          <Badge variant="glass">
            {ROLE_LABEL[invitation.role] ?? invitation.role}
          </Badge>
        </Row>
        {invitation.department && (
          <Row label="部门">
            <span className="text-gtext-primary">
              {invitation.department.name}
            </span>
          </Row>
        )}
        {invitation.position && (
          <Row label="岗位">
            <span className="text-gtext-primary">{invitation.position}</span>
          </Row>
        )}
        <Row label="有效期至">
          <span className="text-gtext-secondary">
            {new Date(invitation.expiresAt).toLocaleString('zh-CN')}
          </span>
        </Row>
      </dl>

      {!hydrated ? (
        <div className="mt-6 flex justify-center">
          <CenteredSpinner label="加载中…" />
        </div>
      ) : loggedIn ? (
        <AcceptAsLoggedIn
          invitation={invitation}
          token={token}
          currentEmail={user?.email ?? ''}
          hasEnterprise={Boolean(enterprise)}
          currentEnterpriseName={enterprise?.name ?? ''}
        />
      ) : (
        <RegisterByInvitationForm invitation={invitation} token={token} />
      )}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-gtext-muted">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  );
}

const joinSchema = z.object({
  name: z.string().min(1, '请输入昵称').max(50, '昵称最多 50 个字'),
  password: z.string().min(8, '密码至少 8 位'),
});
type JoinValues = z.infer<typeof joinSchema>;

/**
 * 没有账号的受邀人：设置密码即完成建号 + 入职。
 *
 * 邮箱只展示不可改 —— 它由邀请决定。管理员不接触这个密码，
 * 这正是邀请路径相对「管理员代建账号并设初始密码」的意义所在。
 */
function RegisterByInvitationForm({
  invitation,
  token,
}: {
  invitation: InvitationPreview;
  token: string;
}) {
  const mutation = useRegisterByInvitation();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<JoinValues>({ resolver: zodResolver(joinSchema) });

  const err = mutation.error;
  const serverError =
    err instanceof ApiError ? err.message : err ? '加入失败，请稍后重试' : null;
  // 409「邮箱已被注册」在这条路径上有明确出路：登录后用同一链接接受
  const needsLogin = err instanceof ApiError && err.status === 409;

  return (
    <form
      onSubmit={handleSubmit((v) =>
        mutation.mutate({
          token,
          email: invitation.email,
          password: v.password,
          name: v.name,
        }),
      )}
      className="mt-6 space-y-4"
    >
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gtext-primary">
          邮箱
        </label>
        <Input value={invitation.email} readOnly disabled />
        <p className="mt-1 text-xs text-gtext-muted">
          由邀请指定，不可修改
        </p>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gtext-primary">
          昵称
        </label>
        <Input placeholder="你的名字" {...register('name')} />
        {errors.name && (
          <p className="mt-1 text-xs text-danger">{errors.name.message}</p>
        )}
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gtext-primary">
          设置密码
        </label>
        <Input type="password" placeholder="至少 8 位" {...register('password')} />
        {errors.password && (
          <p className="mt-1 text-xs text-danger">{errors.password.message}</p>
        )}
      </div>

      {serverError && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {serverError}
          {needsLogin && (
            <Link
              href={`/login?redirect=${encodeURIComponent(
                `/join?token=${token}`,
              )}`}
              className="mt-1 block text-xs font-medium text-primary hover:underline"
            >
              用该邮箱登录后再接受邀请 →
            </Link>
          )}
        </div>
      )}

      <Button type="submit" className="w-full" disabled={mutation.isPending}>
        {mutation.isPending && <Spinner />}
        设置密码并加入
      </Button>

      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-gtext-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        密码由你本人设置，企业管理员无法看到。
      </p>
    </form>
  );
}

/**
 * 已登录用户接受邀请。
 *
 * 两种拒绝要在点之前就说清楚，因为它们都需要用户先去别处做一件事：
 *   - 登录的邮箱与邀请不符 → 换账号（后端 400）
 *   - 已归属其他企业 → 先退出当前企业（后端 409）
 * 让用户点下去再看报错也能工作，但那等于把可预判的信息藏到失败之后。
 */
function AcceptAsLoggedIn({
  invitation,
  token,
  currentEmail,
  hasEnterprise,
  currentEnterpriseName,
}: {
  invitation: InvitationPreview;
  token: string;
  currentEmail: string;
  hasEnterprise: boolean;
  currentEnterpriseName: string;
}) {
  const accept = useAcceptInvitation();

  const emailMismatch =
    currentEmail.toLowerCase() !== invitation.email.toLowerCase();
  const blocked = emailMismatch || hasEnterprise;

  const serverError =
    accept.error instanceof ApiError
      ? accept.error.message
      : accept.error
        ? '加入失败，请稍后重试'
        : null;

  return (
    <div className="mt-6 space-y-4">
      {emailMismatch && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-gtext-primary">
          <p className="font-medium">当前登录的不是被邀请的账号</p>
          <p className="mt-1 text-xs leading-relaxed text-gtext-secondary">
            你现在登录的是 {currentEmail}，而这条邀请发给 {invitation.email}。
            邀请与邮箱绑定，请换账号后再打开本链接。
          </p>
          <Link
            href={`/login?redirect=${encodeURIComponent(
              `/join?token=${token}`,
            )}`}
            className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
          >
            用 {invitation.email} 登录 →
          </Link>
        </div>
      )}

      {!emailMismatch && hasEnterprise && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-gtext-primary">
          <p className="font-medium">你已归属「{currentEnterpriseName}」</p>
          <p className="mt-1 text-xs leading-relaxed text-gtext-secondary">
            一个账号同时只能属于一家企业。若确实要转到
            {invitation.enterprise.name}，请先在个人设置里退出当前企业，
            再回到本链接。原企业的数据会留在原企业。
          </p>
          <Link
            href="/settings"
            className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
          >
            去个人设置 →
          </Link>
        </div>
      )}

      {serverError && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {serverError}
        </div>
      )}

      <Button
        className="w-full"
        disabled={blocked || accept.isPending}
        onClick={() => accept.mutate(token)}
      >
        {accept.isPending && <Spinner />}
        以 {currentEmail} 加入 {invitation.enterprise.name}
      </Button>
    </div>
  );
}
