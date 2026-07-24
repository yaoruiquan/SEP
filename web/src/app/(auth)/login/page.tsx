'use client';

import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/feedback';
import { useLogin } from '@/features/auth/use-auth';
import { ApiError } from '@/lib/api-client';

const schema = z.object({
  email: z.string().email('请输入有效邮箱'),
  password: z.string().min(1, '请输入密码'),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const login = useLogin();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = (values: FormValues) => {
    console.log('[LoginPage] Form submitted with values:', values);
    login.mutate(values);
  };
  const serverError =
    login.error instanceof ApiError ? login.error.message : login.error ? '登录失败' : null;

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground">欢迎回来</h2>
      <p className="mt-1 text-sm text-fg-muted">登录后进入你的数字员工工作台</p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium">邮箱</label>
          <Input type="email" placeholder="you@company.com" {...register('email')} />
          {errors.email && (
            <p className="mt-1 text-xs text-danger">{errors.email.message}</p>
          )}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">密码</label>
          <Input type="password" placeholder="••••••••" {...register('password')} />
          {errors.password && (
            <p className="mt-1 text-xs text-danger">{errors.password.message}</p>
          )}
        </div>

        {serverError && (
          <div className="rounded border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            {serverError}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending && <Spinner />}
          登录
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-fg-muted">
        还没有账号？{' '}
        <Link href="/register" className="font-medium text-primary hover:underline">
          注册
        </Link>
      </p>
    </div>
  );
}
