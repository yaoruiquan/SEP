'use client';

import {
  ArrowRight,
  CheckCircle2,
  CirclePlay,
  CircleStop,
  FileCheck2,
  Handshake,
  Pause,
  PencilLine,
  Play,
  SkipForward,
  TriangleAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskEventType, TaskExecutionEvent } from '../task-execution';

interface Style {
  icon: React.ElementType;
  dot: string;
  text: string;
  label: string;
}

/**
 * 事件类型 → 视觉与中文标签。
 *
 * 会议要求「展示完整过程」，流水就是那个过程的文字记录。此前 TaskRunEvent 只落库，
 * 界面上从来没有任何地方读它 —— 有数据没展示，等于没有。
 */
const STYLES: Record<TaskEventType, Style> = {
  RUN_CREATED: { icon: PencilLine, dot: 'bg-gtext-muted', text: 'text-gtext-muted', label: '计划已生成' },
  RUN_STARTED: { icon: CirclePlay, dot: 'bg-gbrand', text: 'text-gbrand-text', label: '开始执行' },
  RUN_COMPLETED: { icon: CheckCircle2, dot: 'bg-gsuccess', text: 'text-gsuccess', label: '全部完成' },
  RUN_FAILED: { icon: TriangleAlert, dot: 'bg-gdanger', text: 'text-gdanger', label: '执行中断' },
  RUN_STOPPED: { icon: CircleStop, dot: 'bg-gwarning', text: 'text-gwarning', label: '已停止' },
  STEP_STARTED: { icon: Play, dot: 'bg-gbrand', text: 'text-gtext-primary', label: '开始工作' },
  STEP_COMPLETED: { icon: CheckCircle2, dot: 'bg-gsuccess', text: 'text-gtext-primary', label: '交付' },
  STEP_FAILED: { icon: TriangleAlert, dot: 'bg-gdanger', text: 'text-gdanger', label: '卡住' },
  STEP_SKIPPED: { icon: SkipForward, dot: 'bg-gtext-disabled', text: 'text-gtext-muted', label: '跳过' },
  STEP_PAUSED: { icon: Pause, dot: 'bg-gwarning', text: 'text-gwarning', label: '暂停' },
  STEP_RESUMED: { icon: Play, dot: 'bg-gbrand', text: 'text-gbrand-text', label: '恢复' },
  PLAN_EDITED: { icon: PencilLine, dot: 'bg-gtext-muted', text: 'text-gtext-muted', label: '计划调整' },
  STEP_HANDOFF: { icon: Handshake, dot: 'bg-gbrand', text: 'text-gbrand-text', label: '交接' },
  DELIVERABLE_READY: { icon: FileCheck2, dot: 'bg-gsuccess', text: 'text-gsuccess', label: '交付物就绪' },
};

const FALLBACK: Style = {
  icon: PencilLine,
  dot: 'bg-gtext-muted',
  text: 'text-gtext-muted',
  label: '事件',
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(
    date.getSeconds(),
  ).padStart(2, '0')}`;
}

export interface TaskProcessTimelineProps {
  events: TaskExecutionEvent[];
  onJumpToStep?: (stepKey: string) => void;
  className?: string;
}

/**
 * 过程流水。
 *
 * 倒序（最新在上）—— 任务跑起来后用户看的是「现在怎么样了」，把最新事件放在
 * 需要滚动才能到的底部是反直觉的。
 */
export function TaskProcessTimeline({ events, onJumpToStep, className }: TaskProcessTimelineProps) {
  if (events.length === 0) {
    return (
      <div className={cn('px-4 py-6 text-center text-xs text-gtext-muted', className)}>
        还没有执行记录。确认计划后，每一步的开始、交接和交付都会记在这里。
      </div>
    );
  }

  const ordered = [...events].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );

  return (
    <ol className={cn('space-y-0', className)}>
      {ordered.map((event, index) => {
        const style = STYLES[event.type] ?? FALLBACK;
        const Icon = style.icon;
        const jumpable = Boolean(event.stepId && onJumpToStep);

        return (
          <li key={event.id} className="relative flex gap-2.5 pl-1">
            {index !== ordered.length - 1 && (
              <span className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px bg-glassline" aria-hidden />
            )}
            <span
              className={cn(
                'relative z-10 mt-1.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-white',
                style.dot,
              )}
            >
              <Icon className="h-3 w-3" strokeWidth={2.5} />
            </span>

            <div className="min-w-0 flex-1 pb-3">
              <div className="flex items-baseline gap-2">
                <span className={cn('text-[11px] font-semibold', style.text)}>{style.label}</span>
                {event.employeeName && (
                  <span className="truncate text-[11px] text-gtext-secondary">{event.employeeName}</span>
                )}
                <span className="ml-auto shrink-0 text-[10px] tabular-nums text-gtext-muted">
                  {formatTime(event.createdAt)}
                </span>
              </div>
              {event.message && (
                <p className="mt-0.5 text-[11px] leading-5 text-gtext-muted">{event.message}</p>
              )}
              {jumpable && (
                <button
                  type="button"
                  onClick={() => onJumpToStep?.(event.stepId as string)}
                  className="mt-1 inline-flex items-center gap-1 text-[10px] text-gbrand-text transition-colors hover:text-gbrand-text-hover"
                >
                  {event.stepTitle ?? '这一步'}
                  <ArrowRight className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
