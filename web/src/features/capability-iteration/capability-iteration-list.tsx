'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Inbox, LayoutList, Library, Search, Users } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { EMPLOYEE_CATEGORIES } from '@/lib/employee-categories';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useIterableCapabilities, type IterableCapability } from './use-capability-iteration';

/**
 * 技能库列表。
 *
 * 三段结构：汇总条 → 待办区（有待采纳才出现）→ 按硅基员工分组的技能行。
 *
 * 两个刻意的设计选择：
 *
 * 1. **分组头是一个人，不是一个标签**。整个产品的隐喻是「雇佣硅基员工」，
 *    分组头放头像 + 岗位，用户看到的就是「这位员工掌握这些技能」。顺带也解决了
 *    技能名多为英文的问题 —— 中文的员工名做分组头，英文技能名降为行内文字。
 *
 * 2. **列宽用 Grid 写死，不用 flex**。上一版最后一列是 `max-w`（可变宽）、
 *    第一列是 `flex-1`（吃掉剩余），于是员工名越长的行、中间所有列越往左移，
 *    平铺视图看起来完全没对齐。Grid 保证同列必然对齐。
 */

type Filter = 'all' | 'customized' | 'pending';
type ViewMode = 'grouped' | 'flat';

/** 分组视图与平铺视图共用同一套栅格，两个视图的列位才一致 */
const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_104px_136px_88px] items-center gap-3';
const ROW_GRID_FLAT = 'grid grid-cols-[minmax(0,1fr)_104px_136px_88px_150px] items-center gap-3';

export function CapabilityIterationList() {
  const { data, isLoading, isError } = useIterableCapabilities();
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<ViewMode>('grouped');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const items = data?.items ?? [];

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === 'customized' && item.currentVersion?.scope !== 'ENTERPRISE') return false;
      if (filter === 'pending' && item.pendingAdoptionCount === 0) return false;
      if (!kw) return true;
      // 员工名也参与搜索：技能名多是英文，用户更可能记得中文员工名
      return (
        item.capability.name.toLowerCase().includes(kw) ||
        item.employees.some((employee) => employee.employeeName.toLowerCase().includes(kw))
      );
    });
  }, [items, keyword, filter]);

  if (isLoading) return <ListSkeleton />;

  if (isError) {
    return (
      <div className="rounded-glass-lg border border-gdanger/25 bg-gdanger/[0.06] px-4 py-8 text-center text-sm text-gdanger">
        技能库加载失败，请稍后重试
      </div>
    );
  }

  if (items.length === 0) return <EmptyState />;

  const summary = data?.summary;
  const canManage = data?.canManage ?? false;
  const pendingItems = items.filter((item) => item.pendingAdoptionCount > 0);

  return (
    <div className="space-y-4">
      {summary && <SummaryBar summary={summary} canManage={canManage} />}

      {pendingItems.length > 0 && <PendingBoard items={pendingItems} canManage={canManage} />}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gtext-disabled" />
          <Input
            glass
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索技能或硅基员工"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: '全部' },
            { value: 'customized', label: '已调整' },
            { value: 'pending', label: '有待办' },
          ]}
        />
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'grouped', label: '按员工', icon: Users },
            { value: 'flat', label: '平铺', icon: LayoutList },
          ]}
        />
      </div>

      {visible.length === 0 ? (
        <p className="rounded-glass-lg border border-dashed border-glassline bg-glass-1 px-4 py-8 text-center text-xs text-gtext-muted">
          没有符合条件的技能
        </p>
      ) : view === 'flat' ? (
        <div className="overflow-hidden rounded-glass-lg border border-glassline bg-glass-1">
          <FlatHeader />
          {visible.map((item) => (
            <CapabilityRow key={item.capability.id} item={item} showEmployees />
          ))}
        </div>
      ) : (
        <GroupedList
          items={visible}
          collapsed={collapsed}
          onToggle={(employeeId) =>
            setCollapsed((prev) => {
              const next = new Set(prev);
              if (next.has(employeeId)) next.delete(employeeId);
              else next.add(employeeId);
              return next;
            })
          }
        />
      )}
    </div>
  );
}

function SummaryBar({
  summary,
  canManage,
}: {
  summary: NonNullable<ReturnType<typeof useIterableCapabilities>['data']>['summary'];
  canManage: boolean;
}) {
  // 新租户下四个数全是 0，铺开来像页面坏了。零值时换成一句人话。
  const untouched =
    summary.customizedCount === 0 &&
    summary.pendingAdoptionTotal === 0 &&
    summary.totalRounds === 0;

  if (untouched) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-glass-lg border border-glassline bg-glass-1 px-4 py-2.5 text-xs text-gtext-muted">
        <Library className="h-3.5 w-3.5" />
        <span>
          共
          <span className="mx-1 text-base font-semibold tabular-nums text-gtext-primary">
            {summary.capabilityCount}
          </span>
          个技能，还没有人调整过
        </span>
        <span className="text-gtext-disabled">
          · {canManage ? '成员改完会自动出现在这里，等你采纳' : '你可以创建自己的副本随时调整'}
        </span>
      </div>
    );
  }

  const stats = [
    { label: '个技能', value: summary.capabilityCount },
    { label: '个已调整', value: summary.customizedCount },
    {
      label: canManage ? '条改动待采纳' : '条我的改动待采纳',
      value: summary.pendingAdoptionTotal,
      highlight: summary.pendingAdoptionTotal > 0,
    },
    { label: '次调用', value: summary.totalRounds },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-glass-lg border border-glassline bg-glass-1 px-4 py-2.5 text-xs text-gtext-muted">
      {stats.map((stat) => (
        <span key={stat.label} className="inline-flex items-baseline gap-1">
          <span
            className={cn(
              'text-base font-semibold tabular-nums',
              stat.highlight ? 'text-gbrand-text' : 'text-gtext-primary',
            )}
          >
            {stat.value}
          </span>
          {stat.label}
        </span>
      ))}
    </div>
  );
}

/**
 * 待办区。
 *
 * 这一页的核心动作是「看到成员改动并采纳」，它必须是打开页面第一眼看到的东西 ——
 * 埋在列表里等于没做。
 */
function PendingBoard({ items, canManage }: { items: IterableCapability[]; canManage: boolean }) {
  return (
    <div className="rounded-glass-lg border border-glassline-brand bg-gbrand/[0.06] p-3">
      <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-gbrand-text">
        <Inbox className="h-3.5 w-3.5" />
        {canManage ? '待你处理' : '我的改动'}
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <Link
            key={item.capability.id}
            href={`/capabilities/${item.capability.id}?tab=changes`}
            className="flex items-center justify-between gap-3 rounded-glass-md px-2 py-1.5 text-xs transition-colors hover:bg-glass-2"
          >
            <span className="min-w-0 truncate font-medium text-gtext-primary">
              {item.capability.name}
            </span>
            <span className="shrink-0 text-gbrand-text">
              {canManage
                ? `${item.pendingAdoptionCount} 位成员调整过 · 去采纳`
                : '我的副本已生效 · 等待企业采纳'}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** 平铺视图的列头。分组视图不需要 —— 那里每组都有自己的头，再加列头就太吵。 */
function FlatHeader() {
  return (
    <div
      className={cn(
        ROW_GRID_FLAT,
        'border-b border-glassline bg-glass-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-gtext-muted',
      )}
    >
      <span>技能</span>
      <span className="text-center">当前生效</span>
      <span className="text-right">使用情况</span>
      <span className="text-right">待办</span>
      <span className="text-right">所属员工</span>
    </div>
  );
}

/** 按硅基员工分组。一个技能被多位员工带着时会在各组重复出现 —— 那是事实，不是 bug。 */
function GroupedList({
  items,
  collapsed,
  onToggle,
}: {
  items: IterableCapability[];
  collapsed: Set<string>;
  onToggle: (employeeId: string) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        avatar: string | null;
        subtitle: string;
        items: IterableCapability[];
      }
    >();
    for (const item of items) {
      for (const employee of item.employees) {
        const group = map.get(employee.employeeId) ?? {
          name: employee.employeeName,
          avatar: employee.employeeAvatar,
          subtitle: employeeSubtitle(employee),
          items: [],
        };
        group.items.push(item);
        map.set(employee.employeeId, group);
      }
    }
    return [...map.entries()].sort((a, b) => b[1].items.length - a[1].items.length);
  }, [items]);

  return (
    <div className="space-y-2.5">
      {groups.map(([employeeId, group]) => {
        const isCollapsed = collapsed.has(employeeId);
        const pending = group.items.reduce((sum, item) => sum + item.pendingAdoptionCount, 0);
        // 调用次数可加；「使用人数」跨技能相加会重复计人，所以这里不用它
        const rounds = group.items.reduce((sum, item) => sum + item.usage.totalRounds, 0);
        return (
          <div
            key={employeeId}
            className="overflow-hidden rounded-glass-lg border border-glassline bg-glass-1"
          >
            <button
              type="button"
              onClick={() => onToggle(employeeId)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-3 bg-glass-2 px-3 py-2.5 text-left transition-colors hover:bg-glass-3"
            >
              <Avatar
                name={group.name}
                src={group.avatar}
                className="h-9 w-9 shrink-0 shadow-glass-sm ring-1 ring-white/15"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-gtext-primary">
                  {group.name}
                </p>
                {group.subtitle && (
                  <p className="mt-0.5 truncate text-[11px] text-gtext-muted">{group.subtitle}</p>
                )}
              </div>
              <span className="shrink-0 text-[11px] text-gtext-muted">
                {group.items.length} 个技能
                {rounds > 0 && ` · ${rounds} 次调用`}
              </span>
              {pending > 0 && (
                <span className="shrink-0 rounded-glass-pill bg-gbrand/15 px-1.5 py-0.5 text-[10px] font-medium text-gbrand-text">
                  {pending} 条待采纳
                </span>
              )}
              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-gtext-secondary transition-transform',
                  isCollapsed && '-rotate-90',
                )}
              />
            </button>
            {!isCollapsed && (
              // 左侧留出与头像同宽的一列，并画一条竖线 ——
              // 技能视觉上「属于」上面那个人，而不是一个平级列表
              <div className="relative pl-[30px]">
                <span
                  aria-hidden
                  className="absolute bottom-2 left-[18px] top-0 w-px bg-glassline"
                />
                {group.items.map((item) => (
                  <CapabilityRow key={item.capability.id} item={item} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 单行。刻意不放能力描述 —— 它们全是英文长句且被截断，六行读起来一模一样。
 * 这个位置留给「生效在哪版、几个人在用、有没有待办」，那才是决定该不该点进去的信息。
 */
function CapabilityRow({
  item,
  showEmployees = false,
}: {
  item: IterableCapability;
  showEmployees?: boolean;
}) {
  const scope = item.currentVersion?.scope;
  return (
    <Link
      href={`/capabilities/${item.capability.id}`}
      className={cn(
        showEmployees ? ROW_GRID_FLAT : ROW_GRID,
        'border-t border-glassline px-3 py-2 transition-colors first:border-t-0 hover:bg-glass-2',
      )}
    >
      <span className="truncate text-[13px] font-medium text-gtext-primary">
        {item.capability.name}
      </span>

      <span className="flex justify-center">
        {item.myPersonalVersionId ? (
          <ScopeTag tone="personal">我的副本</ScopeTag>
        ) : scope === 'ENTERPRISE' ? (
          <ScopeTag tone="enterprise">企业版 {item.currentVersion?.version}</ScopeTag>
        ) : scope === 'PLATFORM' ? (
          <ScopeTag tone="platform">平台版 {item.currentVersion?.version}</ScopeTag>
        ) : (
          // 没有选版记录不等于不能用 —— 执行时兜底到最新平台审核通过版
          <ScopeTag tone="platform">跟随平台版</ScopeTag>
        )}
      </span>

      {/* 没人用时留空而不是写「暂无使用」——重复 18 遍的灰字比空白更吵 */}
      <span className="truncate text-right text-[11px] text-gtext-muted">
        {item.usage.distinctUserCount > 0 ? (
          <>
            <span className="font-semibold tabular-nums text-gtext-secondary">
              {item.usage.distinctUserCount}
            </span>{' '}
            人在用 · {item.usage.totalRounds} 次
          </>
        ) : null}
      </span>

      <span className="truncate text-right text-[11px]">
        {item.pendingAdoptionCount > 0 ? (
          <span className="font-medium text-gbrand-text">{item.pendingAdoptionCount} 条待采纳</span>
        ) : null}
      </span>

      {showEmployees && (
        <span className="truncate text-right text-[11px] text-gtext-muted">
          {item.employees.map((employee) => employee.employeeName).join('、')}
        </span>
      )}
    </Link>
  );
}

/**
 * 分组头的副标题。
 *
 * 优先用职能分类（研发与技术 / 产品与设计 …）：存量数据里 54 个员工有 50 个
 * `position` 与 `name` 完全相同、48 个 `industry` 是「通用」，直接铺 `position · industry`
 * 会得到「性能基准测试专家 · 通用」压在同名标题下面 —— 看起来像渲染错了。
 * 只有当那两个字段确实带信息（与名字不同、不是「通用」）时才补上。
 */
function employeeSubtitle(employee: IterableCapability['employees'][number]): string {
  const parts: string[] = [];
  const category = EMPLOYEE_CATEGORIES.find((item) => item.value === employee.employeeCategory);
  if (category) parts.push(category.label);
  if (employee.employeePosition && employee.employeePosition !== employee.employeeName) {
    parts.push(employee.employeePosition);
  }
  if (employee.employeeIndustry && employee.employeeIndustry !== '通用') {
    parts.push(employee.employeeIndustry);
  }
  return parts.join(' · ');
}

function ScopeTag({
  tone,
  children,
}: {
  tone: 'personal' | 'enterprise' | 'platform';
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'truncate rounded-glass-pill border px-2 py-0.5 text-[10px] font-medium',
        tone === 'personal' && 'border-gsuccess/40 bg-gsuccess/10 text-gsuccess',
        tone === 'enterprise' && 'border-glassline-brand bg-gbrand/10 text-gbrand-text',
        tone === 'platform' && 'border-glassline bg-glass-2 text-gtext-secondary',
      )}
    >
      {children}
    </span>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: React.ElementType }>;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-glass-md border border-glassline bg-glass-2 p-0.5">
      {options.map(({ value: optionValue, label, icon: Icon }) => (
        <button
          key={optionValue}
          type="button"
          onClick={() => onChange(optionValue)}
          aria-pressed={value === optionValue}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-glass-pill px-2.5 text-[11px] transition-all',
            value === optionValue
              ? 'bg-gbg-raised text-gtext-primary shadow-glass-sm'
              : 'text-gtext-muted hover:text-gtext-secondary',
          )}
        >
          {Icon && <Icon className="h-3 w-3" />}
          {label}
        </button>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-10 animate-pulse rounded-glass-lg border border-glassline bg-glass-1" />
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-32 animate-pulse rounded-glass-lg border border-glassline bg-glass-1"
        />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-glass-lg border border-dashed border-glassline bg-glass-1 px-4 py-12 text-center">
      <Library className="mx-auto h-6 w-6 text-gtext-disabled" />
      <p className="mt-3 text-sm font-medium text-gtext-secondary">技能库还是空的</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-gtext-muted">
        企业雇佣硅基员工后，员工带的技能会出现在这里。你可以创建自己的副本立即调整，
        管理员采纳后成为企业统一版本，且不影响平台公共版本。
      </p>
    </div>
  );
}
