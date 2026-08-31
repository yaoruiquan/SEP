'use client';

import { Check, Loader2, Pause, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskRunStepStatus } from '../task-execution';

export interface StepperNode {
  stepKey: string;
  order: number;
  employeeName: string;
  status: TaskRunStepStatus;
}

const DOT: Record<TaskRunStepStatus, string> = {
  queued: 'border-glassline bg-glass-2 text-gtext-muted',
  running: 'border-gbrand bg-gbrand text-white',
  completed: 'border-gsuccess bg-gsuccess text-white',
  failed: 'border-gdanger bg-gdanger text-white',
  skipped: 'border-glassline bg-glass-1 text-gtext-disabled',
  paused: 'border-gwarning bg-gwarning text-white',
};

/** 连线颜色由**左侧那一步**决定：它交付了，这段路才算走过 */
const LINE: Record<TaskRunStepStatus, string> = {
  queued: 'bg-glassline',
  running: 'bg-gbrand/40',
  completed: 'bg-gsuccess/60',
  failed: 'bg-gdanger/40',
  skipped: 'bg-glassline',
  paused: 'bg-gwarning/40',
};

/**
 * 顶部横向进度条：①━━━●━━━○
 *
 * 会议要求「一眼看到流程走到哪」。竖向时间线滚动起来就失去了全局感 ——
 * 这一条常驻在顶栏，无论滚到哪一步都能回答「总共几步、现在第几步」。
 */
export function TaskFlowStepper({
  nodes,
  activeStepKey,
  onSelect,
  className,
}: {
  nodes: StepperNode[];
  activeStepKey?: string;
  onSelect?: (stepKey: string) => void;
  className?: string;
}) {
  if (nodes.length === 0) return null;

  return (
    <ol className={cn('flex min-w-0 items-center', className)} aria-label="工作流程进度">
      {nodes.map((node, index) => {
        const Glyph =
          node.status === 'completed'
            ? Check
            : node.status === 'running'
              ? Loader2
              : node.status === 'failed'
                ? TriangleAlert
                : node.status === 'paused'
                  ? Pause
                  : null;
        const active = node.stepKey === activeStepKey;

        return (
          <li key={node.stepKey} className={cn('flex min-w-0 items-center', index > 0 && 'flex-1')}>
            {index > 0 && (
              <span
                className={cn('mx-1 h-[2px] min-w-3 flex-1 rounded-full transition-colors duration-500', LINE[nodes[index - 1].status])}
                aria-hidden
              />
            )}
            <button
              type="button"
              onClick={() => onSelect?.(node.stepKey)}
              title={`第 ${node.order} 步 · ${node.employeeName}`}
              className={cn(
                'group relative grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[10px] font-bold tabular-nums transition-all duration-300',
                DOT[node.status],
                active && 'ring-2 ring-gbrand-ring ring-offset-2 ring-offset-gbg-canvas',
                onSelect && 'cursor-pointer hover:scale-110',
              )}
            >
              {node.status === 'running' && (
                <span className="absolute -inset-1 rounded-full bg-gbrand/25 motion-safe:animate-ping" aria-hidden />
              )}
              {Glyph ? (
                <Glyph className={cn('relative h-3 w-3', node.status === 'running' && 'animate-spin')} strokeWidth={3} />
              ) : (
                <span className="relative">{node.order}</span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
