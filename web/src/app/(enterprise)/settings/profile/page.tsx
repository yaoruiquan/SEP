'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, Loader2, Upload } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { CenteredSpinner } from '@/components/ui/feedback';
import { useMe, useUpdateProfile, useChangePassword, useUploadAvatar } from '@/features/user/use-user';
import { useLogout, useLeaveEnterprise } from '@/features/auth/use-auth';
import { useAuthStore } from '@/lib/auth-store';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@/features/notifications/use-notifications';
import { ApiError } from '@/lib/api-client';

/** 头像上传的本地预检，与后端 MAX_USER_AVATAR_SIZE 保持一致；真正的校验在后端。 */
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp';

const profileSchema = z.object({
  name: z.string().min(1, '姓名不能为空'),
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
  const uploadAvatar = useUploadAvatar();

  const { data: notifPrefs } = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();

  const [pwSuccess, setPwSuccess] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarSaved, setAvatarSaved] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const profileForm = useForm({
    resolver: zodResolver(profileSchema),
    values: me ? { name: me.name ?? '' } : undefined,
  });

  const passwordForm = useForm({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onProfileSubmit = profileForm.handleSubmit((data) => {
    updateProfile.mutate(
      { name: data.name },
      {
        onSuccess: () => {
          profileForm.reset(data);
        },
      },
    );
  });

  /**
   * 头像是一次独立的 multipart 上传，成功后立即生效（不需要再点保存）。
   * 本地只做类型/大小预检给出即时反馈，服务端仍会按魔数与白名单复检。
   */
  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 清空 value：否则连续选择同一个文件不会再触发 change
    event.target.value = '';
    if (!file) return;
    setAvatarError(null);
    setAvatarSaved(false);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setAvatarError('请选择 PNG、JPG 或 WebP 图片');
      return;
    }
    if (!file.size || file.size > AVATAR_MAX_BYTES) {
      setAvatarError('图片不能为空，且不能超过 2 MB');
      return;
    }
    try {
      await uploadAvatar.mutateAsync(file);
      setAvatarSaved(true);
      setTimeout(() => setAvatarSaved(false), 3000);
    } catch (cause) {
      setAvatarError(cause instanceof ApiError ? cause.message : '上传失败，请重试');
    }
  }

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
                src={me?.avatar || undefined}
                className="h-16 w-16 text-xl"
              />
              <div className="space-y-2">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept={AVATAR_ACCEPT}
                  aria-label="选择头像图片"
                  className="hidden"
                  disabled={uploadAvatar.isPending}
                  onChange={handleAvatarChange}
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadAvatar.isPending}
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {uploadAvatar.isPending
                      ? '正在上传…'
                      : me?.avatar
                        ? '更换头像'
                        : '上传头像'}
                  </Button>
                  {avatarSaved && (
                    <span role="status" className="flex items-center gap-1 text-sm text-success">
                      <Check className="h-4 w-4" />
                      头像已更新
                    </span>
                  )}
                </div>
                <p className="text-xs text-fg-muted">支持 PNG、JPG、WebP，最大 2 MB</p>
                {avatarError && (
                  <p role="alert" className="text-sm text-danger">
                    {avatarError}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">邮箱</label>
              <Input value={me?.email ?? ''} disabled readOnly />
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
