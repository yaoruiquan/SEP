'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, Loader2 } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CenteredSpinner } from '@/components/ui/feedback';
import { useMe, useUpdateProfile, useChangePassword } from '@/features/user/use-user';
import { useLogout } from '@/features/auth/use-auth';
import type { ApiError } from '@/lib/api-client';

const profileSchema = z.object({
  name: z.string().min(1, '姓名不能为空'),
  avatar: z.string().optional(),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, '当前密码不能为空'),
  newPassword: z.string().min(8, '新密码至少 8 位'),
  confirmPassword: z.string().min(1, '请确认新密码'),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: '两次输入的密码不一致',
  path: ['confirmPassword'],
});

export default function SettingsPage() {
  const { data: me, isLoading } = useMe();
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();
  const logout = useLogout();

  const [pwSuccess, setPwSuccess] = useState(false);

  const profileForm = useForm({
    resolver: zodResolver(profileSchema),
    values: me ? { name: me.name ?? '', avatar: me.avatar ?? '' } : undefined,
  });

  const passwordForm = useForm({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onProfileSubmit = profileForm.handleSubmit((data) => {
    updateProfile.mutate(
      { name: data.name, avatar: data.avatar || undefined },
      {
        onSuccess: () => {
          profileForm.reset(data);
        },
      },
    );
  });

  const onPasswordSubmit = passwordForm.handleSubmit((data) => {
    setPwSuccess(false);
    changePassword.mutate(
      { currentPassword: data.currentPassword, newPassword: data.newPassword },
      {
        onSuccess: () => {
          passwordForm.reset();
          setPwSuccess(true);
          setTimeout(() => setPwSuccess(false), 3000);
        },
      },
    );
  });

  if (isLoading) return <CenteredSpinner label="加载中…" />;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">个人设置</h1>
        <p className="mt-1 text-sm text-fg-muted">管理你的账号信息和偏好</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onProfileSubmit} className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar
                name={profileForm.watch('name') || me?.email}
                src={profileForm.watch('avatar') || undefined}
                className="h-16 w-16 text-xl"
              />
              <div className="text-sm text-fg-muted">
                <p className="font-medium text-foreground">{me?.email}</p>
                <p className="mt-0.5">头像 URL 可在下方编辑</p>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                姓名
              </label>
              <Input {...profileForm.register('name')} />
              {profileForm.formState.errors.name && (
                <p className="mt-1 text-sm text-danger">
                  {profileForm.formState.errors.name.message}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                头像 URL（可选）
              </label>
              <Input {...profileForm.register('avatar')} placeholder="https://…" />
            </div>

            {updateProfile.error && (
              <p className="text-sm text-danger">
                {(updateProfile.error as ApiError).message || '保存失败'}
              </p>
            )}

            <Button
              type="submit"
              size="sm"
              disabled={
                updateProfile.isPending || !profileForm.formState.isDirty
              }
            >
              {updateProfile.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              保存
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>修改密码</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onPasswordSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                当前密码
              </label>
              <Input
                type="password"
                {...passwordForm.register('currentPassword')}
              />
              {passwordForm.formState.errors.currentPassword && (
                <p className="mt-1 text-sm text-danger">
                  {passwordForm.formState.errors.currentPassword.message}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                新密码
              </label>
              <Input type="password" {...passwordForm.register('newPassword')} />
              {passwordForm.formState.errors.newPassword && (
                <p className="mt-1 text-sm text-danger">
                  {passwordForm.formState.errors.newPassword.message}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                确认新密码
              </label>
              <Input
                type="password"
                {...passwordForm.register('confirmPassword')}
              />
              {passwordForm.formState.errors.confirmPassword && (
                <p className="mt-1 text-sm text-danger">
                  {passwordForm.formState.errors.confirmPassword.message}
                </p>
              )}
            </div>

            {changePassword.error && (
              <p className="text-sm text-danger">
                {(changePassword.error as ApiError).message || '修改失败'}
              </p>
            )}

            {pwSuccess && (
              <p className="flex items-center gap-1.5 text-sm text-success">
                <Check className="h-4 w-4" />
                密码已更新
              </p>
            )}

            <Button
              type="submit"
              size="sm"
              disabled={changePassword.isPending}
            >
              {changePassword.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              修改密码
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>账号操作</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="danger"
            size="sm"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            退出登录
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
