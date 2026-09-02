'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { MonitorPlay, Search, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/feedback';
import { useAuthStore } from '@/lib/auth-store';
import { useMyEmployees } from '@/features/enterprise/use-enterprise';
import { useDownloadPackage } from '@/features/employee/use-packages';
import { useEmployeeStatus } from '@/lib/websocket';
import { MyEmployeeListSkeleton } from '@/features/employee/employee-skeleton';
import { employee as employeeCopy } from '@/locales/zh-CN';
import { summarizeEmployees } from '@/features/employee/usage-summary';
import { EmployeeCard } from './EmployeeCard';

type SortOption = 'name' | 'recent';

/**
 * 使用者视角：我被授权使用的硅基员工。
 *
 * 硅基员工的管理（雇佣/暂停/升级/授权）在 /subscriptions，不放这里 ——
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

    // 搜索：员工名称或模板名称
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (emp) =>
          emp.name.toLowerCase().includes(query) ||
          emp.employee.name.toLowerCase().includes(query),
      );
    }

    // 排序
    if (sortBy === 'name') {
      result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    }
    // 'recent' 保持后端顺序 —— 后端已按「本企业最后一次调用时间」倒序返回
    // （从未用过的排最后）。口径只在一处，前端不重算。

    return result;
  }, [mine, searchQuery, sortBy]);

  // 汇总条的分母是「我可用的」，与页头的徽章一致；不随搜索变化
  const summary = useMemo(() => summarizeEmployees(mine), [mine]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
        {/* 页头 */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gtext-primary">{employeeCopy.mine}</h1>
            <p className="mt-1 text-sm text-gtext-secondary">
              你被授权使用的硅基员工。已暂停或授权过期的不会出现在这里。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge className="border-glassline-brand bg-gbrand-text/12 px-3 py-1.5 text-gbrand-text">
              {mine.length} 位硅基员工
            </Badge>
            {isAdmin && (
              <Link href="/subscriptions">
                <Button variant="glass" size="sm">
                  {employeeCopy.manageUnit}
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
                description={error?.message || '无法加载硅基员工列表，请稍后重试。'}
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
                title="还没有可用的硅基员工"
                description={
                  isAdmin
                    ? '去「雇佣关系」雇一位硅基员工，再给自己或部门开通授权。'
                    : '请联系企业管理员为你开通授权。'
                }
                action={
                  isAdmin
                    ? {
                        label: '前往雇佣关系',
                        onClick: () => (window.location.href = '/subscriptions'),
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
                      placeholder="搜索硅基员工名称..."
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

            {/* 顶部汇总 —— 管理员一眼看到「花了多少 / 谁快用完了」（方案 §4.2） */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm text-gtext-secondary">
              <span>
                我可用{' '}
                <span className="font-medium text-gtext-primary">
                  {summary.employeeCount}
                </span>{' '}
                位硅基员工
              </span>
              <span className="text-gtext-muted">·</span>
              <span>
                本月共消费{' '}
                <span className="font-medium text-gtext-primary">
                  ¥{summary.monthCostCNY}
                </span>
              </span>
              {summary.lowGiftCount > 0 && (
                <>
                  <span className="text-gtext-muted">·</span>
                  <span className="text-warning">
                    {summary.lowGiftCount} 位赠送额度快用完
                  </span>
                </>
              )}
            </div>

            {/* 卡片网格 */}
            {filteredEmployees.length === 0 ? (
              <Card>
                <CardContent className="py-12">
                  <EmptyState
                    icon={<Search className="h-12 w-12" />}
                    title="没有找到匹配的硅基员工"
                    description="试试调整搜索条件"
                  />
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredEmployees.map((emp) => (
                  <EmployeeCard
                    key={emp.subscriptionId}
                    employee={emp}
                    isAdmin={isAdmin}
                    download={download}
                    status={employeeStatuses[emp.subscriptionId] || 'offline'}
                  />
                ))}
              </div>
            )}
          </>
        )}
    </div>
  );
}
