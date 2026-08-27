'use client';

import { AppWindow, ArrowRight, Bot, Layers3, Sparkles, Workflow } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ContributionCapability } from '@/lib/types';
import { TYPE_META, toneClasses, currentContributionState } from '../contribution-status';
import { pipelineStepLabel, pipelineWaitLabel, type PipelineModel } from '../pipeline-model';
import { PipelineMiniTrack } from './pipeline-mini-track';

const TYPE_ICON: Record<string, { Icon: React.ElementType; className: string }> = {
  AGENT: { Icon: Bot, className: 'border-ginfo/28 bg-ginfo/10 text-ginfo' },
  SKILL: { Icon: Sparkles, className: 'border-glassline-brand bg-gbrand/10 text-gbrand-text' },
  RPA: { Icon: Workflow, className: 'border-gwarning/28 bg-gwarning/10 text-gwarning' },
  AI_APP: { Icon: AppWindow, className: 'border-gsuccess/28 bg-gsuccess/10 text-gsuccess' },
};

export function CapabilityTypeIcon({ type, size = 'md' }: { type: string; size?: 'sm' | 'md' }) {
  const meta = TYPE_ICON[type] ?? { Icon: Layers3, className: 'border-glassline bg-glass-2 text-gtext-muted' };
  const Icon = meta.Icon;
  const box = size === 'sm' ? 'h-8 w-8' : 'h-10 w-10';
  const glyph = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-glass-md border', box, meta.className)}>
      <Icon className={glyph} />
    </span>
  );
}

export function CapabilityTypeBadge({ type }: { type: string }) {
  const label = TYPE_META[type as keyof typeof TYPE_META]?.label ?? type;
  return (
    <span className="rounded-glass-pill border border-glassline bg-glass-2 px-2 py-0.5 text-[10px] font-medium text-gtext-muted">
      {label}
    </span>
  );
}

/**
 * 焦点列表卡片。
 *
 * 右侧不再是编造的百分比进度条，而是真实节点数的迷你轨道 + 「第 N/M 步 · 谁在处理」。
 * 轮到当前用户时整张卡片换成品牌色描边，让「该我了」在长列表里可扫读。
 */
export function ContributionAssetCard({
  item,
  model,
  onOpen,
}: {
  item: ContributionCapability;
  model: PipelineModel;
  onOpen: () => void;
}) {
  const state = currentContributionState(item);
  const wait = pipelineWaitLabel(model);
  const tags = [item.industry?.[0], item.position?.[0]].filter(Boolean);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group grid w-full gap-4 rounded-glass-lg border bg-glass-1 px-4 py-4 text-left shadow-glass-sm transition-all duration-200 ease-out',
        'hover:-translate-y-px hover:border-glassline-hover hover:bg-glass-2 hover:shadow-glass-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gbrand-ring',
        'lg:grid-cols-[minmax(0,1fr)_260px]',
        model.ballInCourt ? 'border-glassline-brand' : 'border-glassline',
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <CapabilityTypeIcon type={item.type} />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-gtext-primary">{item.name}</p>
            <CapabilityTypeBadge type={item.type} />
            <span className={cn('rounded-glass-pill border px-2 py-0.5 text-[10px]', toneClasses[state.tone])}>
              {state.label}
            </span>
          </div>
          <p className="mt-1.5 line-clamp-1 text-xs leading-5 text-gtext-muted">{item.description}</p>
          <p className="mt-2 text-[11px] text-gtext-muted">
            {[...tags, `v${item._count.skillVersions || 1}`, item.enterprise?.name ?? '个人贡献']
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-col justify-between gap-3 lg:items-end">
        <PipelineMiniTrack model={model} className="w-full lg:max-w-[240px]" />
        <div className="flex w-full items-center justify-between gap-3 lg:justify-end">
          <div className="min-w-0 lg:text-right">
            <p className="truncate text-[11px] text-gtext-secondary">{pipelineStepLabel(model)}</p>
            {wait && (
              <p className={cn('mt-0.5 truncate text-[11px]', model.ballInCourt ? 'text-gbrand-text' : 'text-gtext-muted')}>
                {wait}
              </p>
            )}
          </div>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gtext-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-gbrand-text" />
        </div>
      </div>
    </button>
  );
}

/** 轨道看板列里的紧凑形态 —— 阶段已由所在列表达，不再重复画轨道 */
export function ContributionLaneCard({
  item,
  model,
  onOpen,
}: {
  item: ContributionCapability;
  model: PipelineModel;
  onOpen: () => void;
}) {
  const wait = pipelineWaitLabel(model);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group w-full rounded-glass-md border bg-glass-1 p-3 text-left shadow-glass-sm transition-all duration-200 ease-out',
        'hover:-translate-y-px hover:bg-glass-2 hover:shadow-glass-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gbrand-ring',
        model.ballInCourt ? 'border-glassline-brand' : 'border-glassline',
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <CapabilityTypeIcon type={item.type} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-gtext-primary">{item.name}</p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-gtext-muted">{item.description}</p>
        </div>
      </div>
      {wait && (
        <p className={cn('mt-2.5 truncate text-[11px]', model.ballInCourt ? 'text-gbrand-text' : 'text-gtext-muted')}>
          {wait}
        </p>
      )}
    </button>
  );
}
