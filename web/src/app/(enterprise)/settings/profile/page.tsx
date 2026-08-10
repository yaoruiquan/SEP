'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, Loader2 } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { CenteredSpinner } from '@/components/ui/feedback';
import { useMe, useUpdateProfile, useChangePassword } from '@/features/user/use-user';
import { useLogout, useLeaveEnterprise } from '@/features/auth/use-auth';
import { useAuthStore } from '@/lib/auth-store';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@/features/notifications/use-notifications';
import { ApiError } from '@/lib/api-client';

const profileSchema = z.object({
  name: z.string().min(1, '姓名不能为空'),
  avatar: z.string().optional(),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, '当前密码不能为空'),
    newPassword: z.string().min(8, '新密码至少 8 位'),
    confirmPassword: z.string().min(1, '请确认新密码'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: '两次输入的密码不一致',
    path: ['confirmPassword'],
  });

export default function SettingsPage() {
  const { data: me, isLoading } = useMe();
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();
  const logout = useLogout();

  const { data: notifPrefs } = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();

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
              <label className="mb-1.5 block text-sm font-medium text-foreground">姓名</label>
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
              disabled={updateProfile.isPending || !profileForm.formState.isDirty}
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
              <label className="mb-1.5 block text-sm font-medium text-foreground">当前密码</label>
              <Input type="password" {...passwordForm.register('currentPassword')} />
              {passwordForm.formState.errors.currentPassword && (
                <p className="mt-1 text-sm text-danger">
                  {passwordForm.formState.errors.currentPassword.message}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">新密码</label>
              <Input type="password" {...passwordForm.register('newPassword')} />
              {passwordForm.formState.errors.newPassword && (
                <p className="mt-1 text-sm text-danger">
                  {passwordForm.formState.errors.newPassword.message}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">确认新密码</label>
              <Input type="password" {...passwordForm.register('confirmPassword')} />
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

            <Button type="submit" size="sm" disabled={changePassword.isPending}>
              {changePassword.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              修改密码
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* 通知偏好 */}
      <Card id="notifications">
        <CardHeader>
          <CardTitle>通知偏好</CardTitle>
          <CardDescription>选择你希望接收哪些类型的通知</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(
            [
              { key: 'systemEnabled', label: '系统通知', desc: '平台公告、维护通知等' },
              { key: 'usageAlertEnabled', label: '用量预警', desc: 'Token 额度和预算超限提醒' },
              { key: 'securityEnabled', label: '安全通知', desc: 'API 密钥创建/吊销、登录异常等' },
              { key: 'approvalEnabled', label: '审批通知', desc: '员工申请和审批结果' },
              {
                key: 'emailEnabled',
                label: '邮件通知',
                desc: '将重要通知同时发送到邮箱（暂未开放）',
              },
            ] as const
          ).map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-fg-muted">{desc}</p>
              </div>
              <Switch
                checked={notifPrefs?.[key] ?? true}
                disabled={updatePrefs.isPending || key === 'emailEnabled'}
                onCheckedChange={(checked) => updatePrefs.mutate({ [key]: checked })}
              />
            </div>
          ))}
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

      <LeaveEnterpriseCard />
    </div>
  );
}

/**
 * 主动离职。
 *
 * 存在的理由是死锁兜底：若解除归属只有「管理员移除」一个入口，
 * 前雇主不作为就能把一个账号永久卡住 —— 既进不了新企业（一人一企业），
 * 也用不了原企业。故不需要原企业审批。
 *
 * 唯一管理员离职会让企业永久失去管理能力，后端返回 409 拦住 ——
 * 这里不预判，直接展示后端措辞。
 */
function LeaveEnterpriseCard() {
  const { enterprise, roleInEnterprise } = useAuthStore();
  const leave = useLeaveEnterprise();
  const [confirming, setConfirming] = useState(false);

  if (!enterprise) return null;

  const serverError =
    leave.error instanceof ApiError
      ? leave.error.message
      : leave.error
        ? '离职失败，请稍后重试'
        : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>退出企业</CardTitle>
        <CardDescription>
          解除与「{enterprise.name}」的归属关系。账号保留，转为「无企业归属」状态，
          之后可以接受新的企业邀请或自行开通公司。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border border-glassline bg-glass-2 px-3 py-2.5 text-xs leading-relaxed text-fg-muted">
          <p className="font-medium text-foreground">会发生什么</p>
          <p className="mt-1">
            立即回收：你被授权的硅基员工席位、你的部门归属、你提交的待审批申请。
          </p>
          <p className="mt-0.5">
            保留在企业：技能配置、知识库、工作与审批记录 ——
            这些属于企业，离职不会带走。
          </p>
          <p className="mt-0.5">保留在你名下：账号本身与历史对话。</p>
          {roleInEnterprise === 'ENTERPRISE_ADMIN' && (
            <p className="mt-1.5 text-warning">
              你是企业管理员。若你是唯一的管理员，需先指定另一位管理员才能退出。
            </p>
          )}
        </div>

        {serverError && <p className="text-sm text-danger">{serverError}</p>}

        {!confirming ? (
          <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
            退出「{enterprise.name}」
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={() => leave.mutate()}
              disabled={leave.isPending}
            >
              {leave.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              确认退出
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
              disabled={leave.isPending}
            >
              取消
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
