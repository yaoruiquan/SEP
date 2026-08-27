'use client';

import { Check, CircleDashed, Clock3, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { stageStateLabel, stageToneClasses } from '../contribution-status';
import type { PipelineModel, PipelineStage, StageAction, StageState } from '../pipeline-model';

import { StageActorBadge } from './stage-actor-badge';

const NODE_ICON: Record<StageState, React.ElementType> = {
  done: Check,
  active: Clock3,
  waiting: CircleDashed,
  blocked: X,
};

// 轨道段落：已完成实色、进行中品牌色、未开始虚线。
// waiting 用 border-l 画虚线而不是 w-px + 背景色，所以宽度写在各自的值里。
const RAIL: Record<StageState, string> = {
  done: 'w-px bg-gsuccess/35',
  active: 'w-px bg-gbrand/30',
  waiting: 'border-l border-dashed border-glassline',
  blocked: 'w-px bg-gdanger/35',
};

/**
 * 详情页发布流程时间轴。
 *
 * 重构前用 grid-cols-2/3 铺卡片，把单链流程排成 Z 字，第 5 步在左下、第 6 步在右下。
 * 线性流程只能用单列表达。CTA 也从 header 的 ActionBar 下沉到当前节点内——
 * 「卡在哪一步」和「该点什么」必须在同一个视觉容器里。
 */
export function PipelineTimeline({
  model,
  loading,
  onAction,
}: {
  model: PipelineModel;
  loading?: boolean;
  onAction: (action: StageAction) => void;
}) {
  return (
    <ol className="mt-6">
      {model.stages.map((stage, index) => (
        <TimelineNode
          key={stage.key}
          stage={stage}
          last={index === model.total - 1}
          loading={loading}
          onAction={onAction}
        />
      ))}
    </ol>
  );
}

function TimelineNode({
  stage,
  last,
  loading,
  onAction,
}: {
  stage: PipelineStage;
  last: boolean;
  loading?: boolean;
  onAction: (action: StageAction) => void;
}) {
  const Icon = NODE_ICON[stage.state];
  // 带 CTA 的节点也算焦点：球在用户手里时，这一步就是他该看的地方，
  // 哪怕流程状态还是「未开始」（例如已校验但还没提交企业审核）。
  const focused = stage.state === 'active' || stage.state === 'blocked' || stage.ctas.length > 0;

  return (
    <li className="relative flex gap-4 pb-5 last:pb-0">
      {!last && (
        <span
          className={cn('absolute left-[13px] top-8 h-[calc(100%-2rem)]', RAIL[stage.state])}
          aria-hidden
        />
      )}
      <span
        className={cn(
          'relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-glass-pill border transition-colors duration-200',
          stageToneClasses[stage.state],
        )}
      >
        {stage.state === 'active' && (
          <span className="absolute inset-0 animate-pulse-slow rounded-glass-pill bg-gbrand/20" aria-hidden />
        )}
        <Icon className="relative h-3.5 w-3.5" />
      </span>

      <div
        className={cn(
          'min-w-0 flex-1 transition-all duration-200',
          focused
            ? cn(
                'rounded-glass-lg border px-4 py-3.5 shadow-glass-sm',
                stage.state === 'blocked'
                  ? 'border-gdanger/25 bg-gdanger/[0.06]'
                  : 'border-glassline-brand bg-glass-2',
              )
            : 'pt-1',
        )}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className={cn('text-sm', focused ? 'font-semibold text-gtext-primary' : 'font-medium text-gtext-primary')}>
            {stage.title}
          </p>
          <span className="flex items-center gap-2 text-[11px] text-gtext-muted">
            {/* 未开始的节点不显示时间戳：后端残留的旧时间会让人误以为这步已经发生过 */}
            {stage.at && stage.state !== 'waiting' && <span>{new Date(stage.at).toLocaleString('zh-CN')}</span>}
            <span
              className={cn(
                stage.state === 'done' && 'text-gsuccess',
                stage.state === 'active' && 'text-gbrand-text',
                stage.state === 'blocked' && 'text-gdanger',
              )}
            >
              {stageStateLabel[stage.state]}
              {stage.waitingDays !== null && stage.waitingDays > 0 && ` · 已等 ${stage.waitingDays} 天`}
            </span>
          </span>
        </div>

        <div className="mt-2 flex min-w-0 items-center gap-2">
          <StageActorBadge actor={stage.actor} />
          <p className="min-w-0 text-xs leading-5 text-gtext-secondary">{stage.fact}</p>
        </div>

        {stage.rejection && (
          <div className="mt-3 rounded-glass-md border border-gdanger/25 bg-gdanger/[0.08] px-3 py-2">
            <p className="text-[11px] font-medium text-gdanger">驳回原因</p>
            <p className="mt-1 text-xs leading-5 text-gtext-secondary">{stage.rejection}</p>
          </div>
        )}

        {stage.ctas.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[11px] font-medium text-gbrand-text">轮到你处理</span>
            {stage.ctas.map((cta) => (
              <Button
                key={cta.action}
                size="sm"
                variant={cta.tone === 'primary' ? 'glass-primary' : cta.tone === 'danger' ? 'glass-danger' : 'glass'}
                loading={loading}
                onClick={() => onAction(cta.action)}
              >
                {cta.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
