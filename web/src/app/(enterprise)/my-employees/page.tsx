'use client';

import { useState, useMemo } from 'react';
import { MonitorPlay, Search, SlidersHorizontal } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/feedback';
import { useAuthStore } from '@/lib/auth-store';
import { useMyEmployees } from '@/features/enterprise/use-enterprise';
import { MyEmployeeListSkeleton } from '@/features/employee/employee-skeleton';
import { EMPLOYEE_CATEGORIES } from '@/lib/employee-categories';
import { summarizeEmployees } from '@/features/employee/usage-summary';
import { EmployeeCard3D } from './EmployeeCard3D';
import { Spotlight } from '@/components/aceternity/spotlight';
import { PageFrame } from '@/components/page/page-frame';
import { PageHero } from '@/components/page/page-hero';
import styles from './employee-list.module.css';

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

  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [category, setCategory] = useState('');
  const categories = useMemo(
    () =>
      EMPLOYEE_CATEGORIES.map((item) => ({
        ...item,
        count: mine.filter(
          (employee) => employee.employee.functionalCategory === item.value,
        ).length,
      })).filter((item) => item.count > 0),
    [mine],
  );

  // 筛选 + 排序
  const filteredEmployees = useMemo(() => {
    let result = [...mine];

    if (category)
      result = result.filter(
        (employee) => employee.employee.functionalCategory === category,
      );
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter((emp) =>
        [
          emp.name,
          emp.employee.name,
          emp.employee.position,
          emp.employee.description,
          ...(emp.employee.bindings ?? []).map(
            ({ capability }) => capability.name,
          ),
        ].some((value) => value?.toLowerCase().includes(query)),
      );
    }

    // 排序
    if (sortBy === 'name') {
      result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    }
    // 'recent' 保持后端顺序 —— 后端已按「本企业最后一次调用时间」倒序返回
    // （从未用过的排最后）。口径只在一处，前端不重算。

    return result;
  }, [mine, searchQuery, sortBy, category]);

  // 汇总条的分母是「我可用的」，与页头的徽章一致；不随搜索变化
  const summary = useMemo(() => summarizeEmployees(mine), [mine]);

  return (
    <PageFrame className="relative space-y-5">
      {/* Spotlight 背景效果 */}
      <Spotlight
        className="-top-40 left-0 md:-top-20 md:left-60"
        fill="rgb(var(--color-brand-text))"
      />

      <PageHero
        title="硅基员工"
        description="你的专业 AI 同事，随时接手下一项工作。"
      />

      {isLoading ? (
        <div className={styles.container}>
          <MyEmployeeListSkeleton count={6} className={styles.grid} />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={<MonitorPlay className="h-12 w-12" />}
              title="加载失败"
              description={
                error?.message || '无法加载硅基员工列表，请稍后重试。'
              }
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
          <section aria-label="筛选硅基员工" className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-0 basis-64 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
                <Input
                  aria-label="搜索硅基员工"
                  placeholder="搜索名称、岗位、技能或关键词..."
                  className="h-11 bg-card pl-10"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>
              <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm text-fg-muted">
                <SlidersHorizontal className="h-4 w-4" />
                <span>排序</span>
                <select
                  aria-label="排序"
                  value={sortBy}
                  onChange={(event) =>
                    setSortBy(event.target.value as SortOption)
                  }
                  className="bg-transparent py-2 pr-2 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <option value="recent">最近使用</option>
                  <option value="name">按名称</option>
                </select>
              </label>
            </div>
            <div
              role="group"
              aria-label="员工分类"
              className="flex flex-wrap gap-2"
            >
              {[
                { value: '', label: '全部', count: mine.length },
                ...categories,
              ].map((item) => (
                <button
                  key={item.value}
                  aria-pressed={category === item.value}
                  onClick={() => setCategory(item.value)}
                  className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors focus-visible:outline-primary ${category === item.value ? 'border-primary bg-primary text-white' : 'border-border bg-card text-fg-muted hover:text-foreground'}`}
                >
                  <span>{item.label}</span>
                  <span
                    className={`text-xs tabular-nums ${category === item.value ? 'text-white/80' : 'text-fg-muted'}`}
                  >
                    {item.count}
                  </span>
                </button>
              ))}
            </div>
          </section>

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
              这些员工本月企业消费{' '}
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
                  action={{
                    label: '清除筛选',
                    onClick: () => {
                      setSearchQuery('');
                      setCategory('');
                    },
                  }}
                />
              </CardContent>
            </Card>
          ) : (
            <div className={styles.container}>
              <div className={styles.grid}>
                {filteredEmployees.map((emp) => (
                  <EmployeeCard3D key={emp.subscriptionId} employee={emp} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </PageFrame>
  );
}
