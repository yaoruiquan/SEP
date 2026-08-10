'use client';

import { useMe } from '@/features/user/use-user';
import { useEnterpriseSetting } from '@/features/enterprise-settings/use-enterprise-settings';
import { useAuthStore } from '@/lib/auth-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CenteredSpinner } from '@/components/ui/feedback';

export default function OrganizationPage() {
  const { isLoading } = useMe();
  const { data: setting } = useEnterpriseSetting();
  // 企业信息来自 auth store（登录/刷新时写入）。
  // GET /users/me 只返回 User 自身字段，不含 enterprise。
  const enterprise = useAuthStore((s) => s.enterprise);

  if (isLoading) return <CenteredSpinner label="加载中…" />;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">企业信息</h1>
        <p className="mt-1 text-sm text-fg-muted">查看企业基本信息</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex gap-2">
            <span className="w-28 shrink-0 text-fg-muted">企业名称</span>
            <span className="font-medium text-foreground">
              {enterprise?.name ?? '—'}
            </span>
          </div>
          <div className="flex gap-2">
            <span className="w-28 shrink-0 text-fg-muted">企业 ID</span>
            <span className="font-mono text-xs text-foreground">
              {enterprise?.id ?? '—'}
            </span>
          </div>
          {setting?.updatedAt && new Date(setting.updatedAt).getTime() > 0 && (
            <div className="flex gap-2">
              <span className="w-28 shrink-0 text-fg-muted">设置更新于</span>
              <span className="text-foreground">
                {new Date(setting.updatedAt).toLocaleString('zh-CN')}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
