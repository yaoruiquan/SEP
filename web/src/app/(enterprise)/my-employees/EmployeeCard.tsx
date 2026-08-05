'use client';

import { useRouter } from 'next/navigation';
import { MonitorPlay, Download, Settings, Key, BarChart3, MessageSquare } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { StatusDot } from '@/components/ui/status-dot';
import { toast } from '@/components/ui/toast';
import type { MyEmployee } from '@/lib/types';
import type { useDownloadPackage } from '@/features/employee/use-packages';
import { memo } from 'react';

interface EmployeeCardProps {
  employee: MyEmployee;
  isAdmin: boolean;
  download: ReturnType<typeof useDownloadPackage>;
  status: 'online' | 'offline' | 'busy';
}

export const EmployeeCard = memo(function EmployeeCard({
  employee,
  isAdmin,
  download,
  status,
}: EmployeeCardProps) {
  const router = useRouter();
  const { instanceId, name, templateVersion, template, department, grantSource, expiresAt, packageAvailable } =
    employee;

  // Mock 统计数据（待后端实现）
  const mockMonthCalls = Math.floor(Math.random() * 200) + 10;
  const mockMonthSpend = (Math.random() * 100 + 5).toFixed(2);

  const statusText = {
    online: '在线',
    offline: '离线',
    busy: '忙碌中',
  }[status];

  const handleDownload = () => {
    download.mutate(
      { instanceId },
      {
        onSuccess: ({ filename, sha256 }) => {
          toast.success(
            <>
              下载成功：{filename}
              {sha256 && (
                <div className="mt-2 text-xs opacity-75">
                  SHA256: <code className="break-all">{sha256}</code>
                </div>
              )}
            </>,
          );
        },
        onError: (err) => toast.error((err as Error).message),
      },
    );
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
            {/* 头像 + 状态指示器 */}
            <div className="relative shrink-0">
              <Avatar
                name={template.name}
                src={template.avatar}
                className="h-14 w-14 shadow-glass-sm ring-2 ring-white/15 transition-transform group-hover:scale-105"
              />
              {/* 实时状态指示器 */}
              <div className="absolute -bottom-1 -right-1">
                <StatusDot status={status} size="lg" />
              </div>
            </div>

            {/* 员工信息 */}
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-medium text-gtext-primary">{name}</h3>
              <p className="mt-0.5 truncate text-xs text-gtext-secondary">
                {template.name} <span className="opacity-60">v{templateVersion}</span>
              </p>
              <div className="mt-2 flex items-center gap-2 text-xs text-gtext-muted">
                <StatusDot status={status} size="sm" />
                <span>{statusText}</span>
                <span className="text-xs text-gtext-muted">· 2 小时前活跃</span>
              </div>
            </div>
          </div>
        </CardHeader>
      </div>

      {/* 卡片内容 */}
      <CardContent className="space-y-4 p-5">
        {/* 使用统计 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gtext-secondary">本月调用</span>
            <span className="font-medium text-gtext-primary">{mockMonthCalls} 次</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-gtext-secondary">本月消费</span>
            <span className="font-medium text-gneon-green">¥{mockMonthSpend}</span>
          </div>
        </div>

        {/* 授权信息 */}
        <div className="space-y-1.5 rounded-md bg-glass-2 p-2.5">
          {department && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-gtext-secondary">所属部门</span>
              <Badge className="bg-glass-3 text-xs">{department}</Badge>
            </div>
          )}
          <div className="flex items-center justify-between text-xs">
            <span className="text-gtext-secondary">授权来源</span>
            <span className="text-gtext-muted">{grantSource === 'ADMIN' ? '管理员' : '自助订阅'}</span>
          </div>
          {expiresAt && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-gtext-secondary">授权到期</span>
              <span className="text-gtext-muted">{new Date(expiresAt).toLocaleDateString('zh-CN')}</span>
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="space-y-2">
          {/* 聊天功能暂未开发，暂时隐藏 */}
          {/* <Button
            size="sm"
            className="w-full shadow-sm"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/chat?employeeId=${instanceId}`);
            }}
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            开始对话
          </Button> */}

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
              {download.isPending ? '下载中...' : '下载到本地'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
});
