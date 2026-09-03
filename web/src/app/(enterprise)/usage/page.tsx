'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  ArrowRight, Bot, Building2, Cpu, Gauge, Receipt, TrendingDown, TrendingUp, Users,
} from 'lucide-react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  formatCnyPrecise,
  useUsageBreakdown,
  type UsageRange,
} from '@/lib/api/use-compute-credit';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import { BreakdownList } from './breakdown-list';

const RANGES: Array<{ value: UsageRange; label: string }> = [
  { value: 7, label: '近 7 天' },
  { value: 30, label: '近 30 天' },
  { value: 90, label: '近 90 天' },
];

function RangeTabs({
  value,
  onChange,
}: {
  value: UsageRange;
  onChange: (next: UsageRange) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          onClick={() => onChange(r.value)}
          aria-pressed={value === r.value}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-medium transition-colors',
            value === r.value
              ? 'bg-foreground text-background'
              : 'bg-muted text-fg-muted hover:bg-muted/70',
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

/** 环比。上期为 0 时不显示倍数 —— 「增长 ∞%」没有信息量。 */
function DeltaBadge({ deltaPct }: { deltaPct: number | null }) {
  if (deltaPct === null) return <span className="text-xs text-fg-muted">上期无消费</span>;

  const up = deltaPct > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        // 花钱变多不是「好」，所以不用绿色表示上涨
        up ? 'text-amber-600' : 'text-emerald-600',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      较上一个同长度区间 {up ? '+' : ''}
      {deltaPct}%
    </span>
  );
}

/**
 * 用量分析。
 *
 * 只回答一个问题：**已经花掉的钱，怎么分布**。谁的钱取决于是谁在看：
 *   · 企业管理员 —— 全企业，四个维度（模型 / 部门 / 碳基员工 / 硅基员工）
 *   · 普通成员   —— 只有自己的花费，且没有「按部门 / 按碳基员工」
 *
 * 后端 `usage-breakdown` 已按调用者身份定死作用域（非管理员一律只算他自己，
 * 那两个维度返回空数组），这里的 `isAdmin` 只决定**画不画**这两块 ——
 * 空数组照渲染出来会是两张「这个区间还没有产生花费」的空卡片，
 * 让成员误以为公司没人花钱。真正的隔离在后端，不在这一行。
 *
 * 三处刻意不在这里：
 *   · 还剩多少算力、怎么分配给成员 → `/compute-quota`
 *   · 钱包余额与资金流水 → `/wallet`
 *   · 逐笔账单 → `/compute-quota#usage-records`（全站只有一处，管理员专属）
 */
export default function UsagePage() {
  const [range, setRange] = useState<UsageRange>(30);
  const { data, isLoading } = useUsageBreakdown(range);
  const roleInEnterprise = useAuthStore((s) => s.roleInEnterprise);
  const isAdmin = roleInEnterprise === 'ENTERPRISE_ADMIN';

  const trend = data?.trend ?? [];

  return (
    <div className="space-y-6 p-6">
      <section className="border-b border-border/70 pb-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground">用量分析</h1>
            <p className="mt-1 text-sm text-fg-muted">
              {isAdmin
                ? '按模型 / 部门 / 员工看全公司的花费分布'
                : '按模型 / 硅基员工看我自己的花费分布'}
            </p>
          </div>
          <RangeTabs value={range} onChange={setRange} />
        </div>
      </section>

      {isLoading || !data ? (
        <div className="py-16 text-center text-sm text-fg-muted">加载中...</div>
      ) : (
        <>
          {/* 汇总条：这个区间一共花了多少、比上期多还是少 */}
          <section className="flex flex-wrap items-end justify-between gap-4 border border-border/70 bg-card p-5">
            <div>
              {/* 同一个数字，管理员看到的是全公司、成员看到的是自己 —— 标签必须说清 */}
              <p className="text-xs font-medium text-fg-muted">
                {isAdmin ? '' : '我'}近 {data.rangeDays} 天算力花费
              </p>
              <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">
                {formatCnyPrecise(data.totalCNY)}
              </p>
              <div className="mt-1.5">
                <DeltaBadge deltaPct={data.deltaPct} />
              </div>
            </div>
            <dl className="flex flex-wrap gap-x-8 gap-y-2 text-xs">
              <div>
                <dt className="text-fg-muted">模型调用</dt>
                <dd className="mt-1 text-base font-semibold tabular-nums text-foreground">
                  {data.callCount.toLocaleString('zh-CN')} 次
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">输入 / 输出 tokens</dt>
                <dd className="mt-1 text-base font-semibold tabular-nums text-foreground">
                  {data.inputTokens.toLocaleString('zh-CN')} /{' '}
                  {data.outputTokens.toLocaleString('zh-CN')}
                </dd>
              </div>
            </dl>
          </section>

          {trend.length > 0 && (
            <section className="border border-border/70 bg-card p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                <TrendingDown className="h-4 w-4 text-sky-600" />
                每日花费趋势
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trend}>
                  <defs>
                    <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => format(new Date(v), 'MM/dd')}
                  />
                  <YAxis tick={{ fontSize: 12 }} width={64} />
                  <Tooltip
                    formatter={(v) => [formatCnyPrecise(Number(v ?? 0)), '算力花费']}
                    labelFormatter={(l) =>
                      format(new Date(String(l)), 'yyyy-MM-dd', { locale: zhCN })
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="costCNY"
                    stroke="#0ea5e9"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#usageFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </section>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <BreakdownList
              title="按模型"
              subtitle="哪个模型在烧钱 —— 贵的模型换掉能直接省钱"
              icon={<Cpu className="h-4 w-4 text-violet-600" />}
              rows={data.byModel}
              emptyHint="这个区间还没有模型调用"
            />
            {/*
              「按部门 / 按碳基员工」是管理信息：谁花得多、哪个部门超支。
              普通成员看不得，也确实拿不到 —— 后端给他的这两个维度是空数组。
            */}
            {isAdmin && (
              <>
                <BreakdownList
                  title="按部门"
                  subtitle="由成员上卷得出。成员换部门后历史花费归入新部门"
                  icon={<Building2 className="h-4 w-4 text-amber-600" />}
                  rows={data.byDepartment}
                  emptyHint="这个区间还没有部门产生花费"
                />
                <BreakdownList
                  title="按碳基员工"
                  subtitle="谁花得多 —— 对照「算力余额」页的分配额度看"
                  icon={<Users className="h-4 w-4 text-sky-600" />}
                  rows={data.byMember}
                  emptyHint="这个区间还没有成员产生花费"
                />
              </>
            )}
            <BreakdownList
              title="按硅基员工"
              subtitle="哪位数字员工最费钱，也是「谁最被用」的口碑指标"
              icon={<Bot className="h-4 w-4 text-emerald-600" />}
              rows={data.byEmployee}
              emptyHint="这个区间还没有硅基员工产生花费"
            />
          </div>
        </>
      )}

      {/*
        底部入口两种角色去的是同一页的两块内容：
          · 管理员 → 逐笔账单（全站只有一处，在算力余额页）
          · 成员   → 他自己的额度与个人余额

        成员不能给逐笔账单的入口：那张表读的接口后端对非管理员 403，
        点过去只会看到一屏加载失败。
      */}
      <Link
        href={isAdmin ? '/compute-quota#usage-records' : '/compute-quota#my-compute'}
        className="flex flex-wrap items-center justify-between gap-3 border border-border/70 bg-card px-4 py-3 transition-colors hover:bg-muted/40"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          {isAdmin ? (
            <Receipt className="h-4 w-4 text-fg-muted" />
          ) : (
            <Gauge className="h-4 w-4 text-emerald-600" />
          )}
          {isAdmin ? '查看逐笔算力消费明细' : '看公司给我的额度还剩多少'}
        </span>
        <span className="flex items-center gap-1 text-xs text-fg-muted">
          {isAdmin
            ? '在「算力余额」页，可按员工 / 成员 / 日期筛选并导出 CSV'
            : '在「算力余额」页，含我的个人余额与额度重置时间'}
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </Link>
    </div>
  );
}
