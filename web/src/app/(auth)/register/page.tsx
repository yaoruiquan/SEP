'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, Mail, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/feedback';
import { useRegister } from '@/features/auth/use-auth';
import { ApiError } from '@/lib/api-client';
import { extractInviteToken } from '@/lib/invite-token';
import { cn } from '@/lib/utils';

/** 注册的两条路径。见下方 PATHS 注释。 */
type RegisterPath = 'found' | 'invited';

/**
 * 为什么注册要分流：这两件事在系统里是完全不同的写入。
 *
 *   found（我要为公司开通）  → 建 User + Enterprise + Member(ENTERPRISE_ADMIN)
 *   invited（我受邀加入）    → 建 User + Member(邀请里指定的角色)，不建企业
 *
 * 合成一个表单的代价是真实的：老板拿自己的老邮箱走注册，本意是"加入
 * 我公司的账号"，实际建出了第二家公司；而"我只想有个账号、等公司拉我
 * 进去"这条路径此前根本不存在 —— 用户只能眼看着注册表单要求填公司名。
 *
 * 所以入口先问意图，再给对应的表单。
 */
const PATHS: {
  key: RegisterPath;
  label: string;
  hint: string;
  icon: typeof Building2;
}[] = [
  {
    key: 'found',
    label: '我要为公司开通',
    hint: '创建企业，你是首位管理员',
    icon: Building2,
  },
  {
    key: 'invited',
    label: '我受邀加入公司',
    hint: '用管理员发来的邀请链接',
    icon: Mail,
  },
];

export default function RegisterPage() {
  const [path, setPath] = useState<RegisterPath>('found');

  return (
    <div>
      <h2 className="text-2xl font-semibold text-gtext-primary">注册</h2>
      <p className="mt-1 text-sm text-gtext-secondary">先选一条路径</p>

      <div className="mt-5 grid grid-cols-2 gap-2">
        {PATHS.map((p) => {
          const Icon = p.icon;
          const active = path === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setPath(p.key)}
              aria-pressed={active}
              className={cn(
                'rounded-xl border px-3 py-3 text-left transition-colors',
                active
                  ? 'border-primary/60 bg-primary/10'
                  : 'border-glassline bg-glass-2 hover:bg-glass-3',
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4',
                  active ? 'text-primary' : 'text-gtext-secondary',
                )}
              />
              <p className="mt-1.5 text-sm font-medium text-gtext-primary">
                {p.label}
              </p>
              <p className="mt-0.5 text-xs leading-snug text-gtext-muted">
                {p.hint}
              </p>
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        {path === 'found' ? <FoundEnterpriseForm /> : <InvitedForm />}
      </div>

      <p className="mt-6 text-center text-sm text-gtext-secondary">
        已有账号？{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          登录
        </Link>
      </p>
    </div>
  );
}

/**
 * 开公司。后端在一个事务里建 User + Enterprise + 首个企业管理员
 * + 算力账户，故公司名称必填（长度限制与后端 RegisterDtoSchema 一致）。
 */
const foundSchema = z.object({
  enterpriseName: z
    .string()
    .min(2, '公司名称至少 2 个字')
    .max(100, '公司名称最多 100 个字'),
  name: z.string().min(1, '请输入昵称'),
  email: z.string().email('请输入有效邮箱'),
  password: z.string().min(8, '密码至少 8 位'),
});
type FoundValues = z.infer<typeof foundSchema>;

function FoundEnterpriseForm() {
  const registerMutation = useRegister();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FoundValues>({ resolver: zodResolver(foundSchema) });

  const serverError =
    registerMutation.error instanceof ApiError
      ? registerMutation.error.message
      : registerMutation.error
        ? '注册失败'
        : null;

  return (
    <form
      onSubmit={handleSubmit((v) => registerMutation.mutate(v))}
      className="space-y-4"
    >
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gtext-primary">
          公司名称
        </label>
        <Input placeholder="你的公司" {...register('enterpriseName')} />
        {errors.enterpriseName && (
          <p className="mt-1 text-xs text-danger">
            {errors.enterpriseName.message}
          </p>
        )}
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
          邮箱
        </label>
        <Input type="email" placeholder="you@company.com" {...register('email')} />
        {errors.email && (
          <p className="mt-1 text-xs text-danger">{errors.email.message}</p>
        )}
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gtext-primary">
          密码
        </label>
        <Input type="password" placeholder="至少 8 位" {...register('password')} />
        {errors.password && (
          <p className="mt-1 text-xs text-danger">{errors.password.message}</p>
        )}
      </div>

      {serverError && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger backdrop-blur-sm">
          {serverError}
          {/* 「邮箱已被注册」在这条路径上最常见的真实原因是走错了路径 */}
          {registerMutation.error instanceof ApiError &&
            registerMutation.error.status === 409 && (
              <span className="mt-1 block text-xs text-gtext-secondary">
                如果你是要加入已有公司，请改用上方「我受邀加入公司」，
                或直接登录已有账号。
              </span>
            )}
        </div>
      )}

      <Button
        type="submit"
        className="w-full"
        disabled={registerMutation.isPending}
      >
        {registerMutation.isPending && <Spinner />}
        注册并开通企业
      </Button>
    </form>
  );
}

/**
 * 受邀加入。
 *
 * 这里**不**收邮箱和密码 —— 受邀注册的邮箱由邀请记录决定（后端会比对，
 * 不匹配直接 401），在这个还没校验 token 的阶段先让用户填邮箱，
 * 只会制造"填了才发现不是发给我的"。
 * 故本表单只负责把 token 交给 /join，由那页校验后展示企业名再收密码。
 */
function InvitedForm() {
  const router = useRouter();
  const [raw, setRaw] = useState('');
  const [touched, setTouched] = useState(false);

  const token = extractInviteToken(raw);
  const invalid = touched && raw.trim().length > 0 && !token;

  const go = () => {
    if (!token) {
      setTouched(true);
      return;
    }
    router.push(`/join?token=${encodeURIComponent(token)}`);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-glassline bg-glass-2 p-4">
        <p className="text-sm text-gtext-secondary">
          企业管理员会发给你一条邀请链接（形如 <code>/join?token=…</code>），
          通常通过微信或钉钉转达。密码由你自己设置，管理员不会接触。
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-gtext-primary">
          邀请链接或邀请码
        </label>
        <Input
          placeholder="粘贴收到的链接"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
        />
        {invalid && (
          <p className="mt-1 text-xs text-danger">
            没能从这段内容里认出邀请码，请把完整链接粘贴进来
          </p>
        )}
      </div>

      <Button className="w-full" onClick={go} disabled={!raw.trim()}>
        <ArrowRight className="h-4 w-4" />
        继续
      </Button>

      <p className="text-xs leading-relaxed text-gtext-muted">
        还没收到邀请？请联系企业管理员在「成员管理 → 邀请」里生成链接。
      </p>
    </div>
  );
}
