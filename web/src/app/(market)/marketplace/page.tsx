'use client';

import { useState, useEffect, useMemo } from 'react';
import { Search, Users, SlidersHorizontal } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/auth-store';
import { useMarketEmployees } from '@/features/employee/use-employees';
import { useSubscriptions, useSubscribe } from '@/features/subscription/use-subscriptions';
import type { MarketEmployee } from '@/lib/types';
import { EmployeeCard } from './_components/employee-card';
import { EmployeeDrawer } from './_components/employee-drawer';
import { CategoryTabs } from './_components/category-tabs';
import { PaymentModal } from '@/components/ui/payment-modal';
import {
  FilterPanel,
  INITIAL_FILTERS,
  PRICE_MAX,
  type FilterState,
} from './_components/filter-panel';

/** 左侧面板里的职能关键词 —— 用于算各分类的数量 */
const CATEGORY_KEYS = ['人事', '销售', '财务', '运营', '营销', '技术'];

type SortMode = '' | 'hot' | 'new';

function matchesCategory(emp: MarketEmployee, keyword: string) {
  if (!keyword) return true;
  return `${emp.position ?? ''} ${emp.industry ?? ''}`.includes(keyword);
}

export default function MarketplacePage() {
  const { token, hydrated } = useAuthStore();
  const loggedIn = hydrated && Boolean(token);

  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [sort, setSort] = useState<SortMode>('');
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [payingEmp, setPayingEmp] = useState<MarketEmployee | null>(null);
  const [subscribeSucceeded, setSubscribeSucceeded] = useState(false);

  // 搜索走服务端（后端支持 ?search=），300ms 防抖
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  const {
    data: employees = [],
    isLoading,
    isError,
    error,
  } = useMarketEmployees(debouncedSearch);

  // 订阅列表需登录 —— 访客不请求，否则每次都白跑一轮 401 + refresh
  const { data: subs = [] } = useSubscriptions({ enabled: loggedIn });
  const subscribe = useSubscribe();
  const subscribedIds = useMemo(
    () => new Set(subs.map((s) => s.employee.id)),
    [subs],
  );

  function patchFilters(next: Partial<FilterState>) {
    setFilters((prev) => ({ ...prev, ...next }));
  }

  /**
   * Tab 栏是单选「视图」：热门/新上架 = 排序（并清掉职能筛选），
   * 其余 = 职能筛选（并清掉排序）。
   */
  function handleTab(v: string) {
    if (v === '__hot__') {
      setSort('hot');
      patchFilters({ category: '' });
    } else if (v === '__new__') {
      setSort('new');
      patchFilters({ category: '' });
    } else {
      setSort('');
      patchFilters({ category: v });
    }
  }

  const activeTab =
    filters.category ||
    (sort === 'hot' ? '__hot__' : sort === 'new' ? '__new__' : '');

  // 除「职能分类」外的所有筛选 —— 用它算各分类数量，
  // 这样选中某个分类后其他分类的数字不会全变 0
  const preCategory = useMemo(() => {
    return employees.filter((emp) => {
      if (filters.capTypes.length > 0) {
        const types = new Set<string>(
          emp.bindings?.map((b) => b.capability.type) ?? [],
        );
        if (!filters.capTypes.some((t) => types.has(t))) return false;
      }
      if (filters.maxPrice < PRICE_MAX && (emp.price ?? 0) > filters.maxPrice) {
        return false;
      }
      return true;
    });
  }, [employees, filters.capTypes, filters.maxPrice]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const key of CATEGORY_KEYS) {
      out[key] = preCategory.filter((e) => matchesCategory(e, key)).length;
    }
    return out;
  }, [preCategory]);

  const visible = useMemo(() => {
    const list = preCategory.filter((e) => matchesCategory(e, filters.category));
    if (sort === 'hot') {
      return [...list].sort(
        (a, b) => (b._count?.subscriptions ?? 0) - (a._count?.subscriptions ?? 0),
      );
    }
    if (sort === 'new') {
      return [...list].sort(
        (a, b) =>
          new Date(b.publishedAt ?? 0).getTime() -
          new Date(a.publishedAt ?? 0).getTime(),
      );
    }
    return list;
  }, [preCategory, filters.category, sort]);

  const drawerEmp = drawerId
    ? employees.find((e) => e.id === drawerId) ?? null
    : null;

  /**
   * 点「订阅」不直接下单 —— 先弹支付确认，让用户看清价格再掏钱。
   * 免费员工也走这一步：确认页同时承担「订阅是企业级操作」的告知作用。
   */
  function doSubscribe(emp: MarketEmployee) {
    setPayingEmp(emp);
  }

  /** 支付确认后才真正调订阅接口。成功则切换到引导界面，失败留在弹窗里让用户重试。 */
  function confirmPayment() {
    const emp = payingEmp;
    if (!emp) return;
    subscribe.mutate(emp.id, {
      onSuccess: () => {
        setSubscribeSucceeded(true);
      },
      onError: (e) =>
        toast.error(e instanceof ApiError ? e.message : '订阅失败'),
    });
  }

  function closePaymentModal() {
    setPayingEmp(null);
    setSubscribeSucceeded(false);
  }

  return (
    <div className="space-y-8">
      {/* ── page header ──────────────────────────────────────────────── */}
      <header className="space-y-5 pt-4 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          <span className="gradient-text-glass inline-block">员工市场</span>
        </h1>
        <p className="mx-auto max-w-xl text-[15px] text-gtext-secondary">
          按职能、能力类型和预算挑选硅基员工，订阅后即可为部门创建实例。
        </p>

        <div className="relative mx-auto max-w-xl">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gtext-muted" />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => patchFilters({ search: e.target.value })}
            placeholder="搜索员工名称、岗位、行业…"
            aria-label="搜索员工"
            className={cn(
              'w-full rounded-glass-pill border border-glassline bg-glass-2 py-3 pl-11 pr-4',
              'text-[14px] text-gtext-primary placeholder:text-gtext-muted',
              'shadow-glass-sm backdrop-blur-glass-md transition-colors duration-200',
              'focus:border-glassline-brand focus:outline-none focus:ring-2 focus:ring-gbrand/40',
            )}
          />
        </div>
      </header>

      {/* ── tabs ─────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-4 border-b border-glassline">
        <CategoryTabs active={activeTab} onChange={handleTab} />
        <button
          onClick={() => setMobileFilterOpen((v) => !v)}
          className="mb-2 flex shrink-0 items-center gap-1.5 rounded-glass-md border border-glassline bg-glass-2 px-3 py-1.5 text-[12px] text-gtext-secondary transition-colors hover:text-gtext-primary lg:hidden"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          筛选
        </button>
      </div>

      {/* ── body: filter + grid ──────────────────────────────────────── */}
      <div className="flex gap-6">
        {/* 桌面常驻，移动端按需展开 */}
        <div className={cn('lg:block', mobileFilterOpen ? 'block' : 'hidden')}>
          <FilterPanel
            filters={filters}
            onChange={patchFilters}
            counts={counts}
            total={preCategory.length}
          />
        </div>

        <div className="min-w-0 flex-1">
          {isLoading ? (
            <CardGridSkeleton />
          ) : isError ? (
            <GlassEmpty
              title="加载失败"
              desc={error?.message || '无法加载员工列表，请稍后重试。'}
              action={
                <Button
                  variant="glass"
                  size="sm"
                  onClick={() => window.location.reload()}
                >
                  刷新页面
                </Button>
              }
            />
          ) : visible.length === 0 ? (
            <GlassEmpty
              title={
                debouncedSearch || filters.category || filters.capTypes.length
                  ? '没有匹配的员工'
                  : '暂无已上架的员工'
              }
              desc={
                debouncedSearch || filters.category || filters.capTypes.length
                  ? '试试放宽筛选条件或换个关键词。'
                  : '员工上架后会出现在这里。'
              }
              action={
                debouncedSearch || filters.category || filters.capTypes.length ? (
                  <Button
                    variant="glass"
                    size="sm"
                    onClick={() =>
                      patchFilters({
                        search: '',
                        category: '',
                        capTypes: [],
                        maxPrice: PRICE_MAX,
                      })
                    }
                  >
                    清除筛选
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <p className="mb-4 text-[12px] text-gtext-muted">
                共 {visible.length} 位员工
                {sort === 'hot' && ' · 按热门排序'}
                {sort === 'new' && ' · 按上架时间排序'}
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {visible.map((emp) => (
                  <EmployeeCard
                    key={emp.id}
                    emp={emp}
                    subscribed={subscribedIds.has(emp.id)}
                    loggedIn={loggedIn}
                    subscribing={subscribe.isPending}
                    onSubscribe={() => doSubscribe(emp)}
                    onClick={() => setDrawerId(emp.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── drawer ───────────────────────────────────────────────────── */}
      <EmployeeDrawer
        emp={drawerEmp}
        subscribed={drawerEmp ? subscribedIds.has(drawerEmp.id) : false}
        loggedIn={loggedIn}
        subscribing={subscribe.isPending}
        onSubscribe={() => drawerEmp && doSubscribe(drawerEmp)}
        onClose={() => setDrawerId(null)}
      />

      {/* ── 支付确认 ─────────────────────────────────────────────────── */}
      {payingEmp && (
        <PaymentModal
          open
          emp={payingEmp}
          subscribing={subscribe.isPending}
          succeeded={subscribeSucceeded}
          onConfirm={confirmPayment}
          onClose={closePaymentModal}
        />
      )}
    </div>
  );
}

// ─── local glass states ───────────────────────────────────────────────────────

function CardGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="glass-card animate-pulse space-y-4 p-5"
          aria-hidden="true"
        >
          <div className="flex gap-4">
            <div className="h-[72px] w-[72px] shrink-0 rounded-full bg-glass-3" />
            <div className="flex-1 space-y-2 pt-2">
              <div className="h-3.5 w-2/3 rounded bg-glass-3" />
              <div className="h-3 w-1/2 rounded bg-glass-2" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-3 w-full rounded bg-glass-2" />
            <div className="h-3 w-4/5 rounded bg-glass-2" />
          </div>
          <div className="h-px bg-glassline" />
          <div className="flex justify-between">
            <div className="h-4 w-16 rounded bg-glass-3" />
            <div className="h-7 w-16 rounded-glass-md bg-glass-3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function GlassEmpty({
  title,
  desc,
  action,
}: {
  title: string;
  desc: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="glass-card flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-glassline bg-glass-2">
        <Users className="h-5 w-5 text-gtext-muted" />
      </div>
      <h3 className="text-[15px] font-semibold text-gtext-primary">{title}</h3>
      <p className="max-w-sm text-[13px] text-gtext-secondary">{desc}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
