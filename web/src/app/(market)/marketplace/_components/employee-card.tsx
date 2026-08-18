'use client';

import Link from 'next/link';
import { Zap, ShoppingCart } from 'lucide-react';
import { cn, CAPABILITY_TYPE_META } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import { Avatar } from '@/components/ui/avatar';
import { employee as employeeCopy } from '@/locales/zh-CN';
import type { MarketEmployee } from '@/lib/types';

// ─── props ────────────────────────────────────────────────────────────────────

interface EmployeeCardProps {
  emp: MarketEmployee;
  subscribed: boolean;
  loggedIn: boolean;
  /** 当前成员是否已被授权使用（仅普通成员视角有意义） */
  grantedToMe?: boolean;
  /** 企业管理员直接订阅；普通成员提交申请 */
  isAdmin?: boolean;
  subscribing: boolean;
  onSubscribe: () => void;
  onClick: () => void;
  onAddToCart?: () => void;
  addingToCart?: boolean;
}

// ─── component ───────────────────────────────────────────────────────────────

export function EmployeeCard({
  emp,
  subscribed,
  loggedIn,
  grantedToMe = false,
  isAdmin = true,
  subscribing,
  onSubscribe,
  onClick,
  onAddToCart,
  addingToCart = false,
}: EmployeeCardProps) {
  const capTypes = Array.from(new Set(emp.bindings?.map((b) => b.capability.type) ?? []));
  const visibleTypes = capTypes.slice(0, 3);
  const extra = capTypes.length - visibleTypes.length;

  return (
    <article
      onClick={onClick}
      className={cn(
        'glass-card group relative flex cursor-pointer flex-col gap-4 p-5',
        'transition-all duration-300',
        'hover:-translate-y-1 hover:shadow-glass-xl hover:border-glassline-hover',
        subscribed && 'border-emerald-500/40 shadow-[0_0_0_1px_rgb(16_185_129_/_0.2)]',
      )}
    >
      {/* ── avatar + status ─────────────────────────────────────────── */}
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <Avatar
            name={emp.name}
            src={emp.avatar}
            className="h-[72px] w-[72px] shadow-glass-sm"
          />
          {/* online dot */}
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#0f0f2d] ring-2 ring-[#0f0f2d]">
            <PulsingDot className="h-2 w-2" />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold text-gtext-primary">
            {emp.name}
          </h3>
          <p className="mt-0.5 truncate text-[13px] text-gtext-secondary">
            {emp.position}
            {emp.industry ? ` · ${emp.industry}` : ''}
          </p>

          <div className="mt-1.5 flex flex-wrap gap-1">
            {subscribed && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                ✓ 已入职
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── description ─────────────────────────────────────────────── */}
      <p className="line-clamp-2 text-[13px] leading-relaxed text-gtext-secondary">
        {emp.description || '暂无描述'}
      </p>

      {/* ── capability tags ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-gtext-muted">能力</span>
        {visibleTypes.map((t) => {
          const meta = CAPABILITY_TYPE_META[t];
          if (!meta) return null;
          return (
            <span
              key={t}
              className={cn(
                'rounded-full border border-glassline bg-glass-2 px-2 py-0.5 text-[11px] text-gtext-secondary',
                'transition-all duration-150',
                'hover:scale-105 hover:border-gbrand/40 hover:bg-gbrand/10 hover:text-gbrand-text',
              )}
            >
              {meta.label}
            </span>
          );
        })}
        {extra > 0 && (
          <span className="text-[11px] text-gtext-muted">+{extra}</span>
        )}
      </div>

      {/* ── divider ─────────────────────────────────────────────────── */}
      <div className="h-px w-full bg-glassline" />

      {/* ── price + subscribe ───────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          {emp.annualPriceCNY && Number(emp.annualPriceCNY) > 0 ? (
            <span className="text-[15px] font-semibold text-gtext-primary">
              ¥{Number(emp.annualPriceCNY).toLocaleString()}
              <span className="text-[12px] font-normal text-gtext-muted">/年</span>
            </span>
          ) : (
            <span className="text-[13px] font-medium text-emerald-400">免费</span>
          )}
          <p className="text-[11px] text-gtext-muted">
            {emp._count?.subscriptions ?? 0} 家企业在用
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin ? (
            subscribed ? (
              <Link href="/subscriptions" onClick={(e) => e.stopPropagation()}>
                <Button variant="glass" size="sm" className="shrink-0">
                  管理
                </Button>
              </Link>
            ) : (
              <>
                {onAddToCart && (
                  <Button
                    variant="glass"
                    size="sm"
                    className="shrink-0"
                    disabled={addingToCart}
                    onClick={(e) => { e.stopPropagation(); onAddToCart(); }}
                    title="加入购物车"
                  >
                    <ShoppingCart className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="glass-primary"
                  size="sm"
                  className="shrink-0"
                  disabled={subscribing}
                  onClick={(e) => { e.stopPropagation(); onSubscribe(); }}
                >
                  订阅
                </Button>
              </>
            )
          ) : grantedToMe ? (
            <Link href="/my-employees" onClick={(e) => e.stopPropagation()}>
              <Button variant="glass" size="sm" className="shrink-0">
                使用
              </Button>
            </Link>
          ) : loggedIn ? (
            <Button
              variant="glass-primary"
              size="sm"
              className="shrink-0"
              disabled={subscribing}
              onClick={(e) => { e.stopPropagation(); onSubscribe(); }}
            >
              申请使用
            </Button>
          ) : (
            <Link
              href={`/login?redirect=${encodeURIComponent(`/marketplace/${emp.id}`)}`}
              onClick={(e) => e.stopPropagation()}
            >
              <Button variant="glass" size="sm" className="shrink-0">
                登录
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* ── stats row ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 text-[11px] text-gtext-muted">
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3 text-gbrand" />
          {emp.bindings?.length ?? 0} 项技能
        </span>
        <span className="flex items-center gap-1.5">
          <PulsingDot className="h-1.5 w-1.5" />
          {/* 固定装饰文案：这位员工在市场上可招，与本企业的雇佣关系状态无关 */}
          <span className="text-emerald-400">{employeeCopy.hireable}</span>
        </span>
        <span>v{emp.version ?? '1.0'}</span>
      </div>
    </article>
  );
}
