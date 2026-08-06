'use client';

import { useRouter } from 'next/navigation';
import { Download, Settings, Key, BarChart3 } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { CAPABILITY_TYPE_META } from '@/lib/utils';
import type { MyEmployee } from '@/lib/types';
import type { useDownloadPackage } from '@/features/employee/use-packages';
import { useDownloadSkill } from '@/features/capability/use-capability';
import { memo } from 'react';

interface EmployeeCardProps {
  employee: MyEmployee;
  isAdmin: boolean;
  download: ReturnType<typeof useDownloadPackage>;
  /** @deprecated WebSocket 未实现，保留字段但不用于展示假数据 */
  status?: 'online' | 'offline' | 'busy';
}

export const EmployeeCard = memo(function EmployeeCard({
  employee,
  isAdmin,
  download,
}: EmployeeCardProps) {
  const router = useRouter();
  const downloadSkill = useDownloadSkill();
  const { instanceId, name, templateVersion, template, department, grantSource, expiresAt, packageAvailable } =
    employee;

  const handleDownload = () => {
    download.mutate(
      instanceId,
      {
        onSuccess: ({ filename, sha256 }) => {
          const message = sha256
            ? `下载成功：${filename}\nSHA256: ${sha256}`
            : `下载成功：${filename}`;
          toast.success(message);
        },
        onError: (err) => toast.error((err as Error).message),
      },
    );
  };

  const handleDownloadSkills = async () => {
    const skills = template.bindings?.filter((b) => b.capability.type === 'SKILL') || [];
    if (skills.length === 0) {
      toast.error('该员工没有可下载的技能');
      return;
    }

    for (const skill of skills) {
      try {
        const { filename } = await downloadSkill.mutateAsync(skill.capability.id);
        toast.success(`${skill.capability.name} 下载成功`);
      } catch (err) {
        toast.error(`${skill.capability.name} 下载失败：${(err as Error).message}`);
      }
    }
  };

  return (
    <Card className="glass-card-interactive group h-full overflow-hidden">
      {/* 卡片头部 - 点击进入详情 */}
      <div
        onClick={() => router.push(`/my-employees/${instanceId}`)}
        className="cursor-pointer"
      >
        <CardHeader className="border-b border-glassline bg-gradient-to-br from-gbrand-text/10 via-transparent to-transparent p-5">
          <div className="flex items-start gap-4">
            {/* 头像 */}
            <div className="relative shrink-0">
              <Avatar
                name={template.name}
                src={template.avatar}
                className="h-14 w-14 shadow-glass-sm ring-2 ring-white/15 transition-transform group-hover:scale-105"
              />
            </div>

            {/* 员工信息 */}
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-medium text-gtext-primary">{name}</h3>
              <p className="mt-0.5 truncate text-xs text-gtext-secondary">
                {template.name} <span className="opacity-60">v{templateVersion}</span>
              </p>
              <p className="mt-1.5 text-xs text-gtext-muted">
                {grantSource === 'DIRECT' ? '自助订阅' : grantSource === 'DEPARTMENT' ? '部门授权' : '未知'}
              </p>
            </div>
          </div>
        </CardHeader>
      </div>

      {/* 卡片内容 */}
      <CardContent className="space-y-4 p-5">
        {/* 授权信息 */}
        <div className="space-y-1.5 rounded-md bg-glass-2 p-2.5">
          {department && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-gtext-secondary">所属部门</span>
              <span className="text-gtext-muted">{department.name}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-xs">
            <span className="text-gtext-secondary">授权来源</span>
            <span className="text-gtext-muted">
              {grantSource === 'DIRECT' ? '自助订阅' : grantSource === 'DEPARTMENT' ? '部门授权' : '未知'}
            </span>
          </div>
          {expiresAt && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-gtext-secondary">授权到期</span>
              <span className="text-gtext-muted">{new Date(expiresAt).toLocaleDateString('zh-CN')}</span>
            </div>
          )}
        </div>

        {/* 能力列表 */}
        {template.bindings && template.bindings.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-gtext-secondary">绑定能力</p>
            <div className="flex flex-wrap gap-1.5">
              {template.bindings.map((binding) => {
                const meta = CAPABILITY_TYPE_META[binding.capability.type];
                return (
                  <Badge
                    key={binding.id}
                    className={`text-xs ${meta.tone}`}
                  >
                    {binding.capability.name}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="space-y-2">
          {/* 管理员操作 */}
          {isAdmin && (
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="glass"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/instances?selected=${instanceId}`);
                }}
              >
                <Settings className="h-3.5 w-3.5" />
                <span className="ml-1.5 text-xs">配置</span>
              </Button>
              <Button
                variant="glass"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/instances?selected=${instanceId}&tab=grants`);
                }}
              >
                <Key className="h-3.5 w-3.5" />
                <span className="ml-1.5 text-xs">授权</span>
              </Button>
              <Button
                variant="glass"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/usage?instanceId=${instanceId}`);
                }}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                <span className="ml-1.5 text-xs">统计</span>
              </Button>
            </div>
          )}

          {/* 下载按钮（所有人可见） */}
          {packageAvailable && (
            <Button
              variant="outline"
              size="sm"
              disabled={download.isPending}
              onClick={(e) => {
                e.stopPropagation();
                handleDownload();
              }}
              className="w-full"
            >
              <Download className="mr-2 h-4 w-4" />
              {download.isPending ? '下载中...' : '下载员工包'}
            </Button>
          )}

          {/* 下载所有技能按钮 */}
          {template.bindings?.some((b) => b.capability.type === 'SKILL') && (
            <Button
              variant="primary"
              size="sm"
              disabled={downloadSkill.isPending}
              onClick={(e) => {
                e.stopPropagation();
                handleDownloadSkills();
              }}
              className="w-full bg-success hover:bg-success/90"
            >
              <Download className="mr-2 h-4 w-4" />
              {downloadSkill.isPending ? '下载中...' : '下载所有技能'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
});
