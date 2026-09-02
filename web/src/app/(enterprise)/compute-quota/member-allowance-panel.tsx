'use client';

import { Loader2, SlidersHorizontal, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  formatCny,
  formatCnyPrecise,
  useMemberAllowances,
  type MemberAllowanceItem,
} from '@/lib/api/use-compute-credit';
import { AllocateComputeDialog } from './allocate-compute-dialog';

/**
 * 进度条画的是**剩余**额度，不是已用 —— 满格绿色 = 这个月还没怎么花。
 *
 * 与赠送额度那套三色预警同一口径（剩余 ≤20% 红、≤40% 黄），
 * 管理员扫一眼颜色就知道谁快没额度了；画已用的话新分配的额度是空条，
 * 看起来像「没生效」。
 */
function remainingBarColor(remainingPct: number) {
  if (remainingPct <= 20) return 'bg-red-500';
  if (remainingPct <= 40) return 'bg-yellow-400';
  return 'bg-emerald-500';
}

function remainingPctTextColor(remainingPct: number) {
  if (remainingPct <= 20) return 'text-red-500';
  if (remainingPct <= 40) return 'text-yellow-600';
  return 'text-emerald-600';
}

function MemberRow({ member }: { member: MemberAllowanceItem }) {
  const pct = member.usedPct;
  const capped = pct !== null && pct >= 100;
  const leftPct = pct === null ? null : Math.max(0, Math.min(100, 100 - pct));

  return (
    <div className="flex items-center gap-4 border-b border-border/40 px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">{member.name}</span>
          {member.departmentName && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-fg-muted">
              {member.departmentName}
            </span>
          )}
          {capped && (
            <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
              额度已用完
            </span>
          )}
        </div>

        {member.limitCNY === null ? (
          <p className="mt-1 text-xs text-fg-muted">
            不限额 · 本月已用 {formatCnyPrecise(member.usedCNY)}
          </p>
        ) : (
          <div className="mt-1.5 max-w-md">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-fg-muted">
                本月已用 {formatCnyPrecise(member.usedCNY)} / {formatCny(member.limitCNY)}
              </span>
              <span
                className={`font-medium tabular-nums ${remainingPctTextColor(leftPct ?? 0)}`}
              >
                剩余 {formatCnyPrecise(member.remainingCNY)}（{leftPct ?? 0}%）
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-1.5 rounded-full transition-all duration-500 ${remainingBarColor(
                  leftPct ?? 0,
                )}`}
                style={{ width: `${leftPct ?? 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <AllocateComputeDialog
        member={member}
        trigger={
          <Button size="sm" variant="glass" className="shrink-0">
            {member.limitCNY === null ? '分配算力' : '改额度'}
          </Button>
        }
      />
    </div>
  );
}

/**
 * 算力分配 —— 给碳基员工设本周期能花多少算力。
 *
 * 是「闸门」不是「钱包」：分配不会从上方的算力余额里预先划走钱，
 * 所以给 10 个人各分 ¥500 并不需要企业先有 ¥5000。成员花到上限时下一次对话被拦下，
 * 提示里带重置时间和「联系管理员」的出路。
 *
 * 本版只有「每月上限」一种周期。按天/季/年、结转、一次性额度等规则待当面对齐后再加 ——
 * 放一个选得到但不生效的周期选项，比暂时只支持一种更糟。
 */
export function MemberAllowancePanel() {
  const { data: members, isLoading } = useMemberAllowances();

  const list = members ?? [];
  const allocated = list.filter((m) => m.limitCNY !== null).length;
  const capped = list.filter((m) => m.usedPct !== null && m.usedPct >= 100).length;

  return (
    <section id="allowances" className="scroll-mt-8">
      <div className="mb-4">
        <div className="flex items-center gap-2 text-base font-semibold text-foreground">
          <SlidersHorizontal className="h-4 w-4 text-violet-600" />
          算力分配 · 按碳基员工
        </div>
        <p className="mt-1 text-sm text-fg-muted">
          给每位成员设定每月最多能花多少算力。这是上限而不是划款 ——
          不会从上方的算力余额里预先扣走，也不限定他用在哪位硅基员工上。
        </p>
      </div>

      <div className="border border-border/70 bg-card">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-fg-muted" />
          </div>
        ) : list.length === 0 ? (
          <div className="py-12 text-center text-fg-muted">
            <Users className="mx-auto mb-3 h-10 w-10 opacity-40" />
            <p className="font-medium">还没有碳基员工</p>
            <p className="mt-1 text-sm">在「碳基员工」页添加成员后即可分配算力</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/70 px-4 py-3 text-xs text-fg-muted">
              <span>
                共 <strong className="tabular-nums text-foreground">{list.length}</strong> 位成员
              </span>
              <span>
                已分配额度 <strong className="tabular-nums text-foreground">{allocated}</strong> 位
              </span>
              <span>
                不限额{' '}
                <strong className="tabular-nums text-foreground">
                  {list.length - allocated}
                </strong>{' '}
                位
              </span>
              {capped > 0 && (
                <span className="text-red-600">
                  额度已用完 <strong className="tabular-nums">{capped}</strong> 位
                </span>
              )}
            </div>
            {list.map((m) => (
              <MemberRow key={m.userId} member={m} />
            ))}
          </>
        )}
      </div>
    </section>
  );
}
