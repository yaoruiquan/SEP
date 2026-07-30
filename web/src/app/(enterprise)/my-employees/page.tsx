'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { MonitorPlay, Download, Settings, Key, BarChart3, Search, Clock } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { useAuthStore } from '@/lib/auth-store';
import { useMyEmployees } from '@/features/enterprise/use-enterprise';
import { useDownloadPackage } from '@/features/employee/use-packages';
import { toast } from '@/components/ui/toast';
import type { MyEmployee } from '@/lib/types';

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

  const { data: mine = [], isLoading } = useMyEmployees();
  const download = useDownloadPackage();

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

  if (isLoading) return <CenteredSpinner label="加载中…" />;

  return (
    <div className="space-y-6 p-6">
      {/* 页头 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">我的员工</h1>
          <p className="mt-1 text-sm text-fg-muted">
            你被授权使用的硅基员工。已停用或授权过期的不会出现在这里。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className="text-base px-3 py-1.5 bg-muted text-fg">
            {mine.length} 个员工
          </Badge>
          {isAdmin && (
            <Link href="/instances">
              <Button variant="secondary" size="sm">
                管理实例
              </Button>
            </Link>
          )}
        </div>
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
              <Link href="/instances">
                <Button size="sm">前往员工实例</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* 筛选排序栏 */}
          <div className="flex flex-wrap gap-4">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted pointer-events-none" />
              <Input
                placeholder="搜索员工名称..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-fg-muted">排序：</span>
              <div className="flex gap-1 rounded-md border border-border p-1 bg-muted/30">
                <button
                  onClick={() => setSortBy('recent')}
                  className={`px-3 py-1.5 text-sm rounded transition-colors ${
                    sortBy === 'recent'
                      ? 'bg-white shadow-sm font-medium'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                >
                  <Clock className="inline h-3.5 w-3.5 mr-1.5" />
                  最近使用
                </button>
                <button
                  onClick={() => setSortBy('name')}
                  className={`px-3 py-1.5 text-sm rounded transition-colors ${
                    sortBy === 'name'
                      ? 'bg-white shadow-sm font-medium'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                >
                  按名称
                </button>
              </div>
            </div>
          </div>

          {/* 卡片网格 */}
          {filteredEmployees.length === 0 ? (
            <EmptyState
              icon={<Search className="h-8 w-8" />}
              title="没有找到匹配的员工"
              description="试试调整搜索条件"
            />
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {filteredEmployees.map((emp) => (
                <EmployeeCard
                  key={emp.instanceId}
                  employee={emp}
                  isAdmin={isAdmin}
                  download={download}
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
}: {
  employee: MyEmployee;
  isAdmin: boolean;
  download: ReturnType<typeof useDownloadPackage>;
}) {
  const { instanceId, name, templateVersion, template, department, grantSource, expiresAt, packageAvailable } =
    employee;

  // Mock 统计数据（待后端实现）
  const mockMonthCalls = Math.floor(Math.random() * 200) + 10;
  const mockMonthSpend = (Math.random() * 100 + 5).toFixed(2);

  return (
    <Card className="group transition-all duration-300 hover:-translate-y-1 hover:shadow-xl border-2 hover:border-primary/30">
      {/* 卡片头部 */}
      <CardHeader className="border-b bg-gradient-to-br from-primary/5 via-orange-50/30 to-transparent p-5">
        <div className="flex items-start gap-4">
          {/* 头像 */}
          <div className="relative shrink-0">
            <Avatar
              name={template.name}
              src={template.avatar}
              className="h-14 w-14 ring-2 ring-background shadow-md"
            />
            {/* 运行状态指示器 */}
            <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex h-4 w-4 rounded-full bg-success border-2 border-white" />
            </span>
          </div>

          {/* 名称 + 版本 */}
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-base leading-tight truncate" title={name}>
              {name}
            </h3>
            <p className="text-xs text-fg-muted mt-1 truncate" title={template.name}>
              {template.name} · v{templateVersion}
            </p>
            {department && (
              <Badge className="mt-2 bg-muted text-fg-muted text-xs px-2 py-0.5">
                {department.name}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-5">
        {/* 授权信息 */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            className={
              grantSource === 'DIRECT'
                ? 'bg-primary/10 text-primary border border-primary/20'
                : 'bg-muted text-fg-muted'
            }
          >
            {grantSource === 'DIRECT' ? '直接授权' : '部门授权'}
          </Badge>
          {expiresAt && (
            <Badge className="bg-warning/10 text-warning border border-warning/20">
              <Clock className="mr-1 h-3 w-3" />
              {new Date(expiresAt).toLocaleDateString('zh-CN')} 到期
            </Badge>
          )}
        </div>

        {/* 统计数据（Mock - 待后端实现）*/}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-gradient-to-br from-blue-50 to-blue-100/50 p-3 border border-blue-200/50">
            <p className="text-xs text-blue-700 font-medium">本月调用</p>
            <p className="text-xl font-bold text-blue-900 mt-0.5">{mockMonthCalls}</p>
          </div>
          <div className="rounded-lg bg-gradient-to-br from-emerald-50 to-emerald-100/50 p-3 border border-emerald-200/50">
            <p className="text-xs text-emerald-700 font-medium">本月消费</p>
            <p className="text-xl font-bold text-emerald-900 mt-0.5">¥{mockMonthSpend}</p>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="space-y-2">
          {/* 管理员操作 */}
          {isAdmin && (
            <div className="grid grid-cols-3 gap-2">
              <Link href={`/instances?selected=${instanceId}`}>
                <Button variant="secondary" size="sm" className="w-full">
                  <Settings className="mr-1 h-3.5 w-3.5" />
                  配置
                </Button>
              </Link>
              <Link href={`/instances?selected=${instanceId}&tab=grants`}>
                <Button variant="secondary" size="sm" className="w-full">
                  <Key className="mr-1 h-3.5 w-3.5" />
                  授权
                </Button>
              </Link>
              <Link href={`/usage?instanceId=${instanceId}`}>
                <Button variant="secondary" size="sm" className="w-full">
                  <BarChart3 className="mr-1 h-3.5 w-3.5" />
                  统计
                </Button>
              </Link>
            </div>
          )}

          {/* 下载按钮 */}
          {packageAvailable ? (
            <Button
              size="sm"
              variant={isAdmin ? 'secondary' : 'primary'}
              className="w-full"
              disabled={download.isPending}
              onClick={() =>
                download.mutate(template.id, {
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
          ) : (
            <p className="text-center text-xs text-fg-subtle py-2 bg-muted/30 rounded">
              员工包准备中，暂不可下载
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
