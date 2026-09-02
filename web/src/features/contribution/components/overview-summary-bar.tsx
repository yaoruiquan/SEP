'use client';

import { ArrowRight, Coins, Layers3, Store, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ContributionOverview } from '@/lib/types';

interface SummaryFact {
  icon: React.ElementType;
  value: number;
  label: string;
  tone: 'muted' | 'brand' | 'success' | 'warning';
}

/**
 * 态势条。
 *
 * 重构前是 4 个等宽格子，其中「发布处理中 0」「市场可见 0」在早期状态恒为零，
 * 占掉半条宽度却不传递信息。改为只渲染有值的指标，并把「N 项等待你处理」
 * 提升为全页最高优先级的一行。
 */
export function OverviewSummaryBar({
  overview,
  actionableCount,
  onFocusActionable,
}: {
  overview: ContributionOverview;
  actionableCount: number;
  onFocusActionable: () => void;
}) {
  const pending = overview.pendingEnterpriseReview + overview.pendingPlatformAuthorization;
  const facts: SummaryFact[] = [
    { icon: Layers3, value: overview.capabilityCount, label: '项能力资产', tone: 'muted' },
    { icon: Timer, value: pending, label: '项流程处理中', tone: 'warning' },
    { icon: Store, value: overview.publicCapabilityCount, label: '项已收录为公共能力', tone: 'success' },
    { icon: Coins, value: overview.pendingRewardPoints, label: '积分待结算', tone: 'brand' },
  ];
  // 能力总数恒显示（哪怕是 0，它是"还没开始"的有效信息）；其余零值不占位
  const visible = facts.filter((fact, index) => index === 0 || fact.value > 0);

  const toneClass = {
    muted: 'text-gtext-secondary',
    brand: 'text-gbrand-text',
    success: 'text-gsuccess',
    warning: 'text-gwarning',
  } as const;

  return (
    <div className="rounded-glass-lg border border-glassline bg-glass-1 px-4 py-3 shadow-glass-sm">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {visible.map((fact) => {
          const Icon = fact.icon;
          return (
            <span key={fact.label} className="inline-flex items-baseline gap-1.5 text-xs">
              <Icon className={cn('h-3.5 w-3.5 shrink-0 translate-y-0.5', toneClass[fact.tone])} />
              <span className="text-sm font-semibold leading-none text-gtext-primary">{fact.value}</span>
              <span className="text-gtext-muted">{fact.label}</span>
            </span>
          );
        })}
        {overview.usageCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs text-gtext-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-gsuccess" />
            已接入 {overview.usageCount} 次调用
          </span>
        )}
      </div>

      {actionableCount > 0 && (
        <button
          type="button"
          onClick={onFocusActionable}
          className="mt-3 flex w-full items-center justify-between gap-3 rounded-glass-md border border-glassline-brand bg-gbrand/10 px-3 py-2 text-left transition-colors duration-200 hover:bg-gbrand/15"
        >
          <span className="min-w-0 text-xs text-gtext-primary">
            <span className="font-semibold text-gbrand-text">{actionableCount} 项能力</span> 正在等待你处理
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-gbrand-text">
            只看这些
            <ArrowRight className="h-3 w-3" />
          </span>
        </button>
      )}
    </div>
  );
}
