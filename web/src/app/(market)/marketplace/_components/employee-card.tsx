'use client';

import Link from 'next/link';
import { Zap } from 'lucide-react';
import { cn, CAPABILITY_TYPE_META } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import type { MarketEmployee } from '@/lib/types';

// ─── avatar gradient by function keyword ─────────────────────────────────────

const GRAD_MAP: [string, string][] = [
  ['人事', 'linear-gradient(135deg,#7c3aed,#a855f7)'],
  ['HR',   'linear-gradient(135deg,#7c3aed,#a855f7)'],
  ['销售', 'linear-gradient(135deg,#2563eb,#3b82f6)'],
  ['CRM',  'linear-gradient(135deg,#2563eb,#3b82f6)'],
  ['财务', 'linear-gradient(135deg,#0891b2,#06b6d4)'],
  ['运营', 'linear-gradient(135deg,#059669,#10b981)'],
  ['营销', 'linear-gradient(135deg,#db2777,#f43f5e)'],
  ['技术', 'linear-gradient(135deg,#d97706,#f59e0b)'],
];

function avatarGradient(position: string, industry: string): string {
  const text = `${position} ${industry}`;
  for (const [key, grad] of GRAD_MAP) {
    if (text.includes(key)) return grad;
  }
  return 'linear-gradient(135deg,#4f46e5,#818cf8)';
}

// ─── props ────────────────────────────────────────────────────────────────────

interface EmployeeCardProps {
  emp: MarketEmployee;
  subscribed: boolean;
  loggedIn: boolean;
  subscribing: boolean;
  onSubscribe: () => void;
  onClick: () => void;
}

// ─── component ───────────────────────────────────────────────────────────────

export function EmployeeCard({
  emp,
  subscribed,
  loggedIn,
  subscribing,
  onSubscribe,
  onClick,
}: EmployeeCardProps) {
  const capTypes = Array.from(new Set(emp.bindings?.map((b) => b.capability.type) ?? []));
  const visibleTypes = capTypes.slice(0, 3);
  const extra = capTypes.length - visibleTypes.length;
  const grad = avatarGradient(emp.position ?? '', emp.industry ?? '');

  return (
    <article
      onClick={onClick}
      className={cn(
        'glass-card group relative flex cursor-pointer flex-col gap-4 p-5',
        'transition-all duration-300',
        'hover:-translate-y-1 hover:shadow-glass-xl hover:border-glassline-hover',
      )}
    >
      {/* ── avatar + status ─────────────────────────────────────────── */}
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <div
            className="flex h-[72px] w-[72px] items-center justify-center rounded-full text-2xl font-bold text-white shadow-glass-sm"
            style={{ background: grad }}
          >
            {emp.name.slice(0, 2)}
          </div>
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
              className="rounded-full border border-glassline bg-glass-2 px-2 py-0.5 text-[11px] text-gtext-secondary"
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
          {emp.price && emp.price > 0 ? (
            <span className="text-[15px] font-semibold text-gtext-primary">
              ¥{emp.price}
              <span className="text-[12px] font-normal text-gtext-muted">/月</span>
            </span>
          ) : (
            <span className="text-[13px] font-medium text-emerald-400">免费</span>
          )}
          <p className="text-[11px] text-gtext-muted">
            {emp._count?.subscriptions ?? 0} 家企业在用
          </p>
        </div>

        {subscribed ? (
          <Link href="/my-employees" onClick={(e) => e.stopPropagation()}>
            <Button variant="glass" size="sm" className="shrink-0">
              管理
            </Button>
          </Link>
        ) : loggedIn ? (
          <Button
            variant="glass-primary"
            size="sm"
            className="shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            disabled={subscribing}
            onClick={(e) => { e.stopPropagation(); onSubscribe(); }}
          >
            订阅
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

      {/* ── stats row ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 text-[11px] text-gtext-muted">
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3 text-gbrand" />
          {emp.bindings?.length ?? 0} 项技能
        </span>
        <span className="flex items-center gap-1.5">
          <PulsingDot className="h-1.5 w-1.5" />
          <span className="text-emerald-400">运行中</span>
        </span>
        <span>v{emp.version ?? '1.0'}</span>
      </div>
    </article>
  );
}
