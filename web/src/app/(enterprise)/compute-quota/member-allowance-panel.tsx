'use client';

import { AlertTriangle, Loader2, PlusCircle, SlidersHorizontal, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  formatCny,
  formatCnyPrecise,
  useMemberAllowances,
  type MemberAllowanceItem,
} from '@/lib/api/use-compute-credit';
import { AllocateComputeDialog } from './allocate-compute-dialog';
import { TopUpComputeDialog } from './top-up-compute-dialog';

/**
 * 进度条画的是**剩余**额度，不是已用 —— 满格绿色 = 这个周期还没怎么花。
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

/** 「10月1日」——重置时刻只需要月日，年份对「下次什么时候重置」没有信息量。 */
function shortDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : `${d.getMonth() + 1}月${d.getDate()}日`;
}

function MemberRow({ member }: { member: MemberAllowanceItem }) {
  const pct = member.usedPct;
  const capped = pct !== null && pct >= 100;
  const leftPct = pct === null ? null : Math.max(0, Math.min(100, 100 - pct));
  const carriedIn = Number(member.carriedInCNY) > 0;
  const topUp = Number(member.topUpRemainingCNY) > 0;

  return (
    <div className="flex items-center gap-4 border-b border-border/40 px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-foreground">{member.name}</span>
          {member.departmentName && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-fg-muted">
              {member.departmentName}
            </span>
          )}
          {member.limitCNY !== null && (
            <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700">
              {member.periodLabel}
            </span>
          )}
          {/*
            额度用完是**改道**不是停用：他自己有个人余额就照样对话，
            只是这些消费不再由公司承担。所以标签写「公司已停付」而不是「已停用」——
            后者会让管理员以为自己按下了一个开关。
          */}
          {capped && (
            <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
              额度已用完 · 转自付
            </span>
          )}
        </div>

        {member.limitCNY === null ? (
          <p className="mt-1 text-xs text-fg-muted">
            不限额 · {member.periodLabel}已用 {formatCnyPrecise(member.usedCNY)}
          </p>
        ) : (
          <div className="mt-1.5 max-w-md">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-fg-muted">
                {member.periodLabel}已用 {formatCnyPrecise(member.usedCNY)} /{' '}
                {formatCny(member.limitCNY)}
                {carriedIn && (
                  <span className="text-emerald-600">
                    {' '}
                    + 结转 {formatCny(member.carriedInCNY)}
                  </span>
                )}
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
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-muted">
              <span>{shortDate(member.resetAt)}重置</span>
              {member.carryOver ? <span>未用完可结转</span> : <span>不结转</span>}
              {/*
                追加额度单独一行显示，不并进上面的进度条：它跨周期存活、
                排在常规额度之后消耗，混进「本周期上限」里会让那个百分比说不清是谁。
              */}
              {topUp && (
                <span className="text-sky-600">
                  追加额度剩 {formatCny(member.topUpRemainingCNY)}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {member.limitCNY !== null && (
          <TopUpComputeDialog
            member={member}
            trigger={
              <Button size="sm" variant="ghost" title="追加一次性额度">
                <PlusCircle className="h-4 w-4" />
              </Button>
            }
          />
        )}
        <AllocateComputeDialog
          member={member}
          trigger={
            <Button size="sm" variant="glass">
              {member.limitCNY === null ? '分配算力' : '改额度'}
            </Button>
          }
        />
      </div>
    </div>
  );
}

/**
 * 算力分配 —— 给碳基员工设本周期能花多少算力。
 *
 * 是「闸门」不是「钱包」：分配不会从上方的算力余额里预先划走钱，
 * 所以给 10 个人各分 ¥500 并不需要企业先有 ¥5000。
 *
 * 额度用尽也**不是**不能对话：扣费链上个人钱包排在企业资金之后，
 * 成员自己有余额就自费继续，只有企业资金与个人余额双空时才真的被拦下，
 * 那时的提示里带重置时间和「联系管理员」的出路。
 *
 * 周期支持 日/周/月/季/年，未用完的额度可结转一个周期，另有跨周期存活的
 * 一次性追加额度 —— 三者在这张表上分开显示，混成一个数字就再也解释不了
 * 「他为什么这个月只花了 ¥200 就被改道」。
 */
export function MemberAllowancePanel() {
  const { data: members, isLoading, isError, error, refetch } = useMemberAllowances();

  const list = members ?? [];
  const allocated = list.filter((m) => m.limitCNY !== null).length;
  const capped = list.filter((m) => m.usedPct !== null && m.usedPct >= 100).length;
  const withTopUp = list.filter((m) => Number(m.topUpRemainingCNY) > 0).length;

  return (
    <section id="allowances" className="scroll-mt-8">
      <div className="mb-3">
        <div className="flex items-center gap-2 text-base font-semibold text-foreground">
          <SlidersHorizontal className="h-4 w-4 text-violet-600" />
          算力分配 · 按碳基员工
        </div>
        <p className="mt-1 text-sm text-fg-muted">
          给每位成员设定每个周期最多能花多少算力。这是上限而不是划款 ——
          不会从上方的算力余额里预先扣走，也不限定他用在哪位硅基员工上。
          花到上限后公司停付、成员可用个人余额自费继续。
        </p>
      </div>

      <div className="border border-border/70 bg-card">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-fg-muted" />
          </div>
        ) : isError ? (
          /*
            请求失败必须和「这家企业没有成员」分开说。
            以前两者都落到下面那个空态，于是接口 500/403 时界面照样写着
            「还没有碳基员工」—— 一个明确的、错误的结论。线上真出过这个：
            成员管理页有 5 个人，这里说没有人，因为两处读的是同一张表，
            列表为空在数据上不可能发生，只可能是这个请求挂了。
          */
          <div className="py-10 text-center">
            <AlertTriangle className="mx-auto mb-3 h-9 w-9 text-red-500 opacity-70" />
            <p className="font-medium text-foreground">额度列表加载失败</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
              这不代表企业里没有成员 —— 成员名单请看「碳基员工」页。
              {error instanceof Error && error.message ? `失败原因：${error.message}` : ''}
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => void refetch()}>
              重试
            </Button>
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
              {withTopUp > 0 && (
                <span className="text-sky-600">
                  有追加额度 <strong className="tabular-nums">{withTopUp}</strong> 位
                </span>
              )}
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
