'use client';

import Link from 'next/link';
import { MonitorPlay, Download } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { useAuthStore } from '@/lib/auth-store';
import { useMyEmployees } from '@/features/enterprise/use-enterprise';
import { useDownloadPackage } from '@/features/employee/use-packages';
import { toast } from '@/components/ui/toast';

/**
 * 使用者视角：我被授权的实例。
 *
 * 实例的管理（创建/停用/升级/授权）在 /instances，不放这里 ——
 * 这一页对普通成员是主页面，混入管理表格会让他看到一堆点不动的按钮。
 */
export default function MyEmployeesPage() {
  const { roleInEnterprise } = useAuthStore();
  const isAdmin = roleInEnterprise === 'ENTERPRISE_ADMIN';

  const { data: mine = [], isLoading } = useMyEmployees();
  const download = useDownloadPackage();

  if (isLoading) return <CenteredSpinner label="加载中…" />;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">我的员工</h1>
          <p className="mt-1 text-sm text-fg-muted">
            你被授权使用的硅基员工。已停用或授权过期的不会出现在这里。
          </p>
        </div>
        {isAdmin && (
          <Link href="/instances">
            <Button variant="secondary" size="sm">管理实例</Button>
          </Link>
        )}
      </div>

      {mine.length === 0 ? (
        <EmptyState
          icon={<MonitorPlay className="h-8 w-8" />}
          title="还没有可用的员工"
          description={
            isAdmin
              ? '去「员工实例」创建实例并给自己或部门开通授权。'
              : '请联系企业管理员为你开通授权。'
          }
          action={
            isAdmin ? (
              <Link href="/instances"><Button size="sm">前往员工实例</Button></Link>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {mine.map((e) => (
            <Card key={e.instanceId}>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start gap-3">
                  <Avatar
                    name={e.template.name}
                    src={e.template.avatar}
                    className="h-10 w-10 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{e.name}</p>
                    <p className="truncate text-xs text-fg-muted">
                      {e.template.name} · v{e.templateVersion}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    className={
                      e.grantSource === 'DIRECT'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-fg-muted'
                    }
                  >
                    {e.grantSource === 'DIRECT' ? '直接授权' : '部门授权'}
                  </Badge>
                  {e.department && (
                    <Badge className="bg-muted text-fg-muted">{e.department.name}</Badge>
                  )}
                  {e.expiresAt && (
                    <Badge className="bg-warning/10 text-warning">
                      {new Date(e.expiresAt).toLocaleDateString('zh-CN')} 到期
                    </Badge>
                  )}
                </div>

                {/* 下载按钮：运营上传包后 packageAvailable 才为 true */}
                {e.packageAvailable && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    disabled={download.isPending}
                    onClick={() =>
                      download.mutate(e.template.id, {
                        onSuccess: ({ filename, sha256 }) => {
                          toast.success(
                            `已下载 ${filename}${sha256 ? `，SHA-256: ${sha256.slice(0, 12)}…` : ''}`,
                          );
                        },
                        onError: (err) => {
                          toast.error((err as Error).message || '下载失败');
                        },
                      })
                    }
                  >
                    <Download className="mr-1.5 h-4 w-4" />
                    下载到本地
                  </Button>
                )}
                {!e.packageAvailable && (
                  <p className="text-center text-xs text-fg-subtle">
                    员工包准备中，暂不可下载
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
