'use client';

import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/feedback';
import { useRegister } from '@/features/auth/use-auth';
import { ApiError } from '@/lib/api-client';

/**
 * 注册即开公司 —— 后端在一个事务里建 User + Enterprise + 首个企业管理员
 * + 算力账户，故公司名称必填（长度限制与后端 RegisterDtoSchema 一致）。
 * 第二个人进企业只能由管理员在成员管理里添加，不走这个入口。
 */
const schema = z.object({
  enterpriseName: z
    .string()
    .min(2, '公司名称至少 2 个字')
    .max(100, '公司名称最多 100 个字'),
  name: z.string().min(1, '请输入昵称'),
  email: z.string().email('请输入有效邮箱'),
  password: z.string().min(8, '密码至少 8 位'),
});
type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const registerMutation = useRegister();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = (values: FormValues) => registerMutation.mutate(values);
  const serverError =
    registerMutation.error instanceof ApiError
      ? registerMutation.error.message
      : registerMutation.error
        ? '注册失败'
        : null;

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground">创建企业账号</h2>
      <p className="mt-1 text-sm text-fg-muted">
        注册即开通企业，你将成为该企业的首位管理员
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium">公司名称</label>
          <Input placeholder="你的公司" {...register('enterpriseName')} />
          {errors.enterpriseName && (
            <p className="mt-1 text-xs text-danger">
              {errors.enterpriseName.message}
            </p>
          )}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">昵称</label>
          <Input placeholder="你的名字" {...register('name')} />
          {errors.name && <p className="mt-1 text-xs text-danger">{errors.name.message}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">邮箱</label>
          <Input type="email" placeholder="you@company.com" {...register('email')} />
          {errors.email && (
            <p className="mt-1 text-xs text-danger">{errors.email.message}</p>
          )}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">密码</label>
          <Input type="password" placeholder="至少 8 位" {...register('password')} />
          {errors.password && (
            <p className="mt-1 text-xs text-danger">{errors.password.message}</p>
          )}
        </div>

        {serverError && (
          <div className="rounded border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            {serverError}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={registerMutation.isPending}>
          {registerMutation.isPending && <Spinner />}
          注册
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-fg-muted">
        已有账号？{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          登录
        </Link>
      </p>
    </div>
  );
}
