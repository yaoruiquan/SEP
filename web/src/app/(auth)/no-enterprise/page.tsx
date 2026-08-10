'use client';

import { useState } from 'react';
import { Building2, Mail, LogOut, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/feedback';
import { CenteredSpinner } from '@/components/ui/feedback';
import { useAuthStore } from '@/lib/auth-store';
import {
  useCreateEnterprise,
  useLogout,
  useAcceptInvitation,
} from '@/features/auth/use-auth';
import { ApiError } from '@/lib/api-client';
import { extractInviteToken } from '@/lib/invite-token';
import { useRedirectIfAffiliated } from './use-redirect-if-affiliated';

/**
 * 「无企业归属」落地页。
 *
 * 这个状态是正常的、可停留的：被原企业移除、主动离职、或受邀链接过期的
 * 账号都会落在这里。以前没有这个页面，此类账号会进到一个数据全空的
 * 企业台 —— 每个模块都 403，用户既不知道为什么，也不知道下一步做什么。
 *
 * 所以这页只做一件事：**说清现状 + 给出两条真实可走的出路**。
 * 「等邀请」不是空话（可以直接粘贴收到的链接），「开新公司」调
 * POST /auth/create-enterprise，不需要重新注册一个邮箱。
 */
export default function NoEnterprisePage() {
  const { user, enterprise, hydrated } = useAuthStore();
  const logout = useLogout();

  // 有归属的人不该看到这页（例如刚接受邀请后按了浏览器后退）
  const redirecting = useRedirectIfAffiliated();

  if (!hydrated || redirecting) {
    return (
      <div className="flex min-h-[24rem] items-center justify-center">
        <CenteredSpinner label={hydrated ? '正在跳转…' : '加载中…'} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-warning">
        <Building2 className="h-5 w-5" />
        <span className="text-xs font-medium uppercase tracking-wider">
          未归属任何企业
        </span>
      </div>
      <h2 className="mt-2 text-2xl font-semibold text-gtext-primary">
        您当前未归属任何企业
      </h2>
      <p className="mt-1 text-sm text-gtext-secondary">
        账号（{user?.email}）可正常登录，但企业功能需要企业归属才能使用。
        请等待企业管理员邀请，或自行开通一家公司。
      </p>
      {enterprise === null && (
        <p className="mt-3 rounded-lg border border-glassline bg-glass-2 px-3 py-2 text-xs leading-relaxed text-gtext-secondary">
          若你此前在某家企业任职：离职不会带走企业侧的数据 ——
          技能配置、知识库与工作记录都留在原企业，你的账号本身与历史对话保留。
        </p>
      )}

      <AcceptInviteSection email={user?.email ?? ''} />

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-glassline" />
        <span className="text-xs text-gtext-muted">或者</span>
        <div className="h-px flex-1 bg-glassline" />
      </div>

      <CreateEnterpriseSection />

      <Button
        variant="ghost"
        size="sm"
        className="mt-6 w-full justify-center text-gtext-secondary"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
      >
        <LogOut className="h-4 w-4" />
        退出登录
      </Button>
    </div>
  );
}

/**
 * 已登录用户接受邀请。
 *
 * 为什么这里收「链接或邀请码」而不只收码：管理员转达的是一条 URL
 * （/join?token=xxx），让用户从里面手抠 token 是纯粹的迁移成本。
 * extractInviteToken 两种都吃。
 */
function AcceptInviteSection({ email }: { email: string }) {
  const [raw, setRaw] = useState('');
  const accept = useAcceptInvitation();

  const token = extractInviteToken(raw);
  const serverError =
    accept.error instanceof ApiError
      ? accept.error.message
      : accept.error
        ? '加入失败，请稍后重试'
        : null;

  return (
    <div className="mt-6 rounded-xl border border-glassline bg-glass-2 p-4">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-gtext-secondary" />
        <h3 className="text-sm font-medium text-gtext-primary">
          我已收到邀请链接
        </h3>
      </div>
      <p className="mt-1 text-xs text-gtext-secondary">
        粘贴管理员发来的链接或邀请码。邀请与邮箱绑定，只有发给 {email}{' '}
        的邀请才能被本账号接受。
      </p>
      <div className="mt-3 flex gap-2">
        <Input
          placeholder="粘贴 /join?token=… 或邀请码"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          className="flex-1"
        />
        <Button
          size="sm"
          disabled={!token || accept.isPending}
          onClick={() => token && accept.mutate(token)}
        >
          {accept.isPending && <Spinner />}
          加入
        </Button>
      </div>
      {serverError && (
        <p className="mt-2 text-xs text-danger">{serverError}</p>
      )}
    </div>
  );
}

function CreateEnterpriseSection() {
  const [name, setName] = useState('');
  const create = useCreateEnterprise();

  const tooShort = name.trim().length > 0 && name.trim().length < 2;
  const serverError =
    create.error instanceof ApiError
      ? create.error.message
      : create.error
        ? '创建失败，请稍后重试'
        : null;

  return (
    <div className="rounded-xl border border-glassline bg-glass-2 p-4">
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-gtext-secondary" />
        <h3 className="text-sm font-medium text-gtext-primary">
          我要为公司开通
        </h3>
      </div>
      <p className="mt-1 text-xs text-gtext-secondary">
        用当前账号创建一家企业，你将成为它的首位管理员，可以邀请同事加入。
      </p>
      <div className="mt-3 flex gap-2">
        <Input
          placeholder="公司名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={name.trim().length < 2 || create.isPending}
          onClick={() => create.mutate({ name: name.trim() })}
        >
          {create.isPending ? <Spinner /> : <ArrowRight className="h-4 w-4" />}
          开通
        </Button>
      </div>
      {tooShort && (
        <p className="mt-2 text-xs text-danger">公司名称至少 2 个字</p>
      )}
      {serverError && (
        <p className="mt-2 text-xs text-danger">{serverError}</p>
      )}
    </div>
  );
}
