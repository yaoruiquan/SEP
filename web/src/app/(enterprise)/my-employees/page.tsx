'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MonitorPlay, Download, Settings, Key, BarChart3, Search, Clock, MessageSquare, MoreVertical } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { StatusDot } from '@/components/ui/status-dot';
import { useAuthStore } from '@/lib/auth-store';
import { useMyEmployees } from '@/features/enterprise/use-enterprise';
import { useDownloadPackage } from '@/features/employee/use-packages';
import { useEmployeeStatus } from '@/lib/websocket';
import { toast } from '@/components/ui/toast';
import type { MyEmployee } from '@/lib/types';
import { MyEmployeeListSkeleton } from '@/features/employee/employee-skeleton';

type SortOption = 'name' | 'recent';

/**
 * 使用者视角：我被授权的实例。
 *
 * 实例的管理（创建/停用/升级/授权）在 /instances，不放这里 ——
 * 这一页对普通成员是主页面，混入管理表格会让他看到一堆点不动的按钮。
 */
export default function MyEmployeesPage() {
  const { roleInEnterprise } = useAuthStore();
  const isAdmin = roleInEnterprise === 'ENTERPRISE_ADMIN';

  const { data: mine = [], isLoading, isError, error } = useMyEmployees();
  const download = useDownloadPackage();

  // WebSocket 功能暂时禁用（后端未实现）
  // const employeeStatuses = useEmployeeStatus();
  const employeeStatuses: Record<string, 'online' | 'busy' | 'offline'> = {}; // Mock 空对象

  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('recent');

  // 筛选 + 排序
  const filteredEmployees = useMemo(() => {
    let result = [...mine];

    // 搜索：实例名称或模板名称
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (emp) =>
          emp.name.toLowerCase().includes(query) ||
          emp.template.name.toLowerCase().includes(query),
      );
    }

    // 排序
    if (sortBy === 'name') {
      result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    }
    // 'recent' 保持原顺序（后端已按某种顺序返回）

    return result;
  }, [mine, searchQuery, sortBy]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
        {/* 页头 */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gtext-primary">我的员工</h1>
            <p className="mt-1 text-sm text-gtext-secondary">
              你被授权使用的硅基员工。已停用或授权过期的不会出现在这里。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge className="border-glassline-brand bg-gbrand-text/12 px-3 py-1.5 text-gbrand-text">
              {mine.length} 个员工
            </Badge>
            {isAdmin && (
              <Link href="/instances">
                <Button variant="glass" size="sm">
                  管理实例
                </Button>
              </Link>
            )}
          </div>
        </div>

        {isLoading ? (
          <MyEmployeeListSkeleton count={6} />
        ) : isError ? (
          <Card>
            <CardContent className="py-12">
              <EmptyState
                icon={<MonitorPlay className="h-12 w-12" />}
                title="加载失败"
                description={error?.message || '无法加载员工列表，请稍后重试。'}
                action={{
                  label: '刷新页面',
                  onClick: () => window.location.reload(),
                }}
              />
            </CardContent>
          </Card>
        ) : mine.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <EmptyState
                icon={<MonitorPlay className="h-12 w-12" />}
                title="还没有可用的员工"
                description={
                  isAdmin
                    ? '去「员工实例」创建实例并给自己或部门开通授权。'
                    : '请联系企业管理员为你开通授权。'
                }
                action={
                  isAdmin
                    ? {
                        label: '前往员工实例',
                        onClick: () => (window.location.href = '/instances'),
                      }
                    : undefined
                }
              />
            </CardContent>
          </Card>
        ) : (
          <>
            {/* 筛选排序栏 */}
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-wrap gap-4">
                  <div className="relative flex-1 min-w-[240px]">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gtext-muted pointer-events-none" />
                    <Input
                      placeholder="搜索员工名称..."
                      className="pl-10"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gtext-secondary">排序：</span>
                    <div className="flex gap-1 rounded-lg border border-glassline bg-glass-1 p-1">
                      <button
                        onClick={() => setSortBy('recent')}
                        className={`px-3 py-1.5 text-sm rounded transition-all ${
                          sortBy === 'recent'
                            ? 'bg-glass-3 font-medium text-gtext-primary shadow-glass-sm'
                            : 'text-gtext-secondary hover:text-gtext-primary'
                        }`}
                      >
                        <Clock className="inline h-3.5 w-3.5 mr-1.5" />
                        最近使用
                      </button>
                      <button
                        onClick={() => setSortBy('name')}
                        className={`px-3 py-1.5 text-sm rounded transition-all ${
                          sortBy === 'name'
                            ? 'bg-glass-3 font-medium text-gtext-primary shadow-glass-sm'
                            : 'text-gtext-secondary hover:text-gtext-primary'
                        }`}
                      >
                        按名称
                      </button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 卡片网格 */}
            {filteredEmployees.length === 0 ? (
              <Card>
                <CardContent className="py-12">
                  <EmptyState
                    icon={<Search className="h-12 w-12" />}
                    title="没有找到匹配的员工"
                    description="试试调整搜索条件"
                  />
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredEmployees.map((emp) => (
                  <EmployeeCard
                    key={emp.instanceId}
                    employee={emp}
                    isAdmin={isAdmin}
                    download={download}
                    status={employeeStatuses[emp.instanceId] || 'offline'}
                  />
                ))}
              </div>
            )}
          </>
        )}
    </div>
  );
}

function EmployeeCard({
  employee,
  isAdmin,
  download,
  status,
}: {
  employee: MyEmployee;
  isAdmin: boolean;
  download: ReturnType<typeof useDownloadPackage>;
  status: 'online' | 'offline' | 'busy';
}) {
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

            {/* 名称 + 状态文本 */}
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-semibold leading-tight text-gtext-primary transition-colors group-hover:text-gbrand-text" title={name}>
                {name}
              </h3>
              <p className="mt-1 truncate text-xs text-gtext-secondary" title={template.name}>
                {template.name} · v{templateVersion}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <StatusDot status={status} showLabel size="sm" />
                <span className="text-xs text-gtext-muted">· 2 小时前活跃</span>
              </div>
            </div>
          </div>
        </CardHeader>
      </div>

      {/* 卡片内容 */}
      <CardContent className="space-y-4 p-5">
        {/* 授权信息 + 部门标签 */}
        <div className="flex flex-wrap items-center gap-2">
          {department && (
            <Badge className="border-glassline bg-glass-2 px-2 py-0.5 text-xs text-gtext-secondary">
              {department.name}
            </Badge>
          )}
          <Badge
            className={
              grantSource === 'DIRECT'
                ? 'border-glassline-brand bg-gbrand-text/12 text-gbrand-text'
                : 'border-glassline bg-glass-2 text-gtext-secondary'
            }
          >
            {grantSource === 'DIRECT' ? '直接授权' : '部门授权'}
          </Badge>
          {expiresAt && (
            <Badge className="bg-warning/10 text-warning border-warning/20">
              <Clock className="mr-1 h-3 w-3" />
              {new Date(expiresAt).toLocaleDateString('zh-CN')} 到期
            </Badge>
          )}
        </div>

        {/* 统计数据（Mock - 待后端实现）*/}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-glass-sm border border-glassline bg-glass-2 p-3 transition-colors hover:bg-glass-3">
            <p className="text-xs font-medium text-gtext-secondary">本月调用</p>
            <p className="mt-1 text-lg font-semibold text-gneon-blue">{mockMonthCalls}</p>
          </div>
          <div className="rounded-glass-sm border border-glassline bg-glass-2 p-3 transition-colors hover:bg-glass-3">
            <p className="text-xs font-medium text-gtext-secondary">本月消费</p>
            <p className="mt-1 text-lg font-semibold text-gneon-green">¥{mockMonthSpend}</p>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="space-y-2">
          {/* 主操作：开始对话 */}
          <Button
            size="sm"
            className="w-full shadow-sm"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/chat?employeeId=${instanceId}`);
            }}
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            开始对话
          </Button>

          {/* 管理员操作 */}
          {isAdmin && (
            <div className="grid grid-cols-3 gap-2">
              <Link href={`/instances?selected=${instanceId}`} onClick={(e) => e.stopPropagation()}>
                <Button variant="glass" size="sm" className="w-full text-xs">
                  <Settings className="mr-1 h-3.5 w-3.5" />
                  配置
                </Button>
              </Link>
              <Link href={`/instances?selected=${instanceId}&tab=grants`} onClick={(e) => e.stopPropagation()}>
                <Button variant="glass" size="sm" className="w-full text-xs">
                  <Key className="mr-1 h-3.5 w-3.5" />
                  授权
                </Button>
              </Link>
              <Link href={`/usage?instanceId=${instanceId}`} onClick={(e) => e.stopPropagation()}>
                <Button variant="glass" size="sm" className="w-full text-xs">
                  <BarChart3 className="mr-1 h-3.5 w-3.5" />
                  统计
                </Button>
              </Link>
            </div>
          )}

          {/* 下载按钮 */}
          {packageAvailable && (
            <Button
              size="sm"
              variant="ghost"
              className="w-full text-gtext-secondary hover:bg-glass-2 hover:text-gtext-primary"
              disabled={download.isPending}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                download.mutate(template.id, {
                  onSuccess: ({ filename, sha256 }) => {
                    toast.success(
                      `已下载 ${filename}${sha256 ? `，SHA-256: ${sha256.slice(0, 12)}…` : ''}`,
                    );
                  },
                  onError: (err) => {
                    toast.error((err as Error).message || '下载失败');
                  },
                });
              }}
            >
              <Download className="mr-1.5 h-4 w-4" />
              下载到本地
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
