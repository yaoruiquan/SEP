'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, ListTree, Play, Square, TriangleAlert, UserPlus, Waypoints, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type {
  LiveStepTool,
  TaskExecutionEvent,
  TaskExecutionSnapshot,
} from '../task-execution';
import { isWorkerStale } from '../task-execution';
import { narrateRun, toNarratable } from '../task-execution-narration';
import { pendingHandoffs, type TaskCandidateEmployee } from '../task-execution-view-model';
import { DeliverableCard } from './deliverable-card';
import { FlowStepCard } from './flow-step-card';
import { HandoffBridge } from './handoff-bridge';
import { TaskFlowStepper } from './task-flow-stepper';
import { TaskProcessTimeline } from './task-process-timeline';

const RUN_TONE_TEXT = {
  draft: 'text-gtext-muted',
  ready: 'text-gbrand-text',
  active: 'text-gbrand-text',
  done: 'text-gsuccess',
  failed: 'text-gdanger',
  stopped: 'text-gwarning',
} as const;

/** running 时每秒走一下，让「已用 2 分 14 秒」真的在动 */
function useTicker(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

export type FlowView = 'timeline' | 'graph';

export interface TaskFlowTheaterProps {
  snapshot: TaskExecutionSnapshot;
  events: TaskExecutionEvent[];
  liveText: Record<string, string>;
  liveTools: Record<string, LiveStepTool[]>;
  connected: boolean;
  streamError: string | null;
  /** 还没跑过 —— 卡片提供编辑能力；跑过之后提供执行能力 */
  editable: boolean;
  busy: boolean;
  expandedStepKey?: string;
  availableEmployees: TaskCandidateEmployee[];
  view: FlowView;
  /** 依赖图视图的内容。头部（目标 / 进度 / 主行动）两种视图共用 */
  graphSlot?: React.ReactNode;
  onViewChange: (view: FlowView) => void;
  onToggleStep: (stepKey: string) => void;
  onRun: () => void;
  onStop: () => void;
  onRetryStep: (stepKey: string) => void;
  onPauseStep: (stepKey: string) => void;
  onResumeStep: (stepKey: string) => void;
  onOpenConversation: (stepKey: string) => void;
  onReplaceEmployee: (stepKey: string, employeeId: string) => void;
  onRemoveDependency: (stepKey: string, dependencyStepKey: string) => void;
  onDeleteStep: (stepKey: string) => void;
  onAddStep: () => void;
}

/**
 * 接力时间线剧场 —— 规划与执行的同一块舞台。
 *
 * 三条设计决定，都来自「过程要肉眼可见」这一个要求：
 *
 * 1. **规划与执行同屏**。确认执行不切换页面，同一张卡原地亮起来、产出流出来。
 *    此前是两个组件互相替换，确认那一刻整屏跳变，看起来像跳到了另一个功能。
 * 2. **交接是卡片之间的独立一块**，不是卡片里的一枚小胶囊。视线从上一步走到
 *    下一步必须经过它，「接力」才成为看得见的事。
 * 3. **交付物在时间线尽头**，不在需要点 tab 的右栏。滚完所有步骤自然落在结论上。
 *
 * 过程流水改成顶栏抽屉：它是审计视角，常驻会和主时间线抢注意力。
 */
export function TaskFlowTheater({
  snapshot,
  events,
  liveText,
  liveTools,
  connected,
  streamError,
  editable,
  busy,
  expandedStepKey,
  availableEmployees,
  view,
  graphSlot,
  onViewChange,
  onToggleStep,
  onRun,
  onStop,
  onRetryStep,
  onPauseStep,
  onResumeStep,
  onOpenConversation,
  onReplaceEmployee,
  onRemoveDependency,
  onDeleteStep,
  onAddStep,
}: TaskFlowTheaterProps) {
  const [processOpen, setProcessOpen] = useState(false);
  const running = snapshot.status === 'running';
  const nowMs = useTicker(running);
  const narration = narrateRun(snapshot.status, snapshot.steps.map(toNarratable));
  const stale = isWorkerStale(snapshot);

  const runningKey = snapshot.steps.find((step) => step.status === 'running')?.stepKey;
  const scrollRef = useRef<HTMLDivElement>(null);
  const liveCardRef = useRef<HTMLDivElement>(null);

  // 正在跑的那一步滚进视野。演示时最怕的就是「它在动，但动的那块在屏幕外」。
  useEffect(() => {
    if (!runningKey || !liveCardRef.current) return;
    liveCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [runningKey]);

  const stepperNodes = useMemo(
    () =>
      snapshot.steps.map((step) => ({
        stepKey: step.stepKey,
        order: step.order,
        employeeName: step.employee.name,
        status: step.status,
      })),
    [snapshot.steps],
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* ── 目标条：目标 + 一句话状态 + 横向进度 + 主行动 ─────────────────── */}
      <header className="shrink-0 border-b border-glassline bg-gbg-deep/35 px-4 py-4 backdrop-blur-glass-sm xl:px-8">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-bold leading-7 text-gtext-primary">{snapshot.objective}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                <span className={cn('font-semibold', RUN_TONE_TEXT[narration.tone])}>{narration.label}</span>
                <span className="text-gtext-muted">{narration.detail}</span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <div className="flex items-center gap-1 rounded-glass-md border border-glassline bg-glass-2 p-1">
                <ViewTab active={view === 'timeline'} onClick={() => onViewChange('timeline')} icon={ListTree} label="时间线" />
                <ViewTab active={view === 'graph'} onClick={() => onViewChange('graph')} icon={GitBranch} label="依赖图" />
              </div>

              <button
                type="button"
                onClick={() => setProcessOpen(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-glass-md border border-glassline bg-glass-2 px-3 text-xs text-gtext-secondary transition-colors hover:border-glassline-brand hover:text-gbrand-text"
              >
                <Waypoints className="h-3.5 w-3.5" />
                过程
                {events.length > 0 && (
                  <span className="grid h-4 min-w-4 place-items-center rounded-glass-pill bg-glass-3 px-1 text-[9px] tabular-nums">
                    {events.length}
                  </span>
                )}
              </button>

              {!running && snapshot.status !== 'completed' && (
                <Button variant="glass-primary" onClick={onRun} disabled={busy}>
                  <Play className="h-4 w-4" />
                  {narration.doneCount > 0 ? '继续执行' : '确认并执行'}
                </Button>
              )}
              {running && (
                <Button variant="glass" onClick={onStop} disabled={busy || snapshot.stopRequested}>
                  <Square className="h-4 w-4 fill-current" />
                  {snapshot.stopRequested ? '正在收尾' : '停止'}
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <TaskFlowStepper
              nodes={stepperNodes}
              activeStepKey={runningKey ?? expandedStepKey}
              onSelect={onToggleStep}
              className="min-w-[10rem] max-w-md flex-1"
            />
            <span className="shrink-0 text-xs tabular-nums text-gtext-muted">
              {narration.doneCount}/{narration.total} 步
            </span>
            {running && (
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 text-[11px]',
                  connected ? 'text-gsuccess' : 'text-gwarning',
                )}
                title={connected ? '实时连接正常' : '实时连接已断开，任务仍在服务端继续 —— 正在自动重连'}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    connected ? 'bg-gsuccess motion-safe:animate-pulse' : 'bg-gwarning',
                  )}
                />
                {connected ? '实时' : '重连中'}
              </span>
            )}
          </div>

          {/* 服务端执行的代价是「页面关了也在跑」，好处也是它。连接状态与心跳
              必须如实告知，不能让用户以为界面卡住了。 */}
          {stale && (
            <p className="flex items-start gap-1.5 rounded-glass-md border border-gwarning/25 bg-gwarning/[0.07] px-2.5 py-1.5 text-[11px] leading-5 text-gwarning">
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
              执行进程超过 1 分钟没有心跳。系统会自动接回并继续，无需重新发起。
            </p>
          )}
          {streamError && !connected && running && (
            <p className="flex items-start gap-1.5 rounded-glass-md border border-glassline bg-glass-2 px-2.5 py-1.5 text-[11px] leading-5 text-gtext-muted">
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
              实时连接中断（{streamError}）。任务在服务端继续执行，正在自动重连。
            </p>
          )}
        </div>
      </header>

      {/* ── 时间线 / 依赖图（头部共用，只换这块） ─────────────────────────── */}
      {view === 'graph' ? (
        <div className="min-h-0 flex-1">{graphSlot}</div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scroll-thin px-4 py-5 xl:px-8">
        <ol className="mx-auto max-w-4xl">
          {snapshot.steps.map((step, index) => {
            const pending = pendingHandoffs(step, snapshot.steps);
            const isRunning = step.stepKey === runningKey;

            return (
              <div key={step.stepKey} ref={isRunning ? liveCardRef : undefined}>
                {(step.handoff.length > 0 || pending.length > 0) && (
                  <HandoffBridge
                    toEmployeeName={step.employee.name}
                    entries={step.handoff}
                    pending={pending}
                    onJumpToStep={onToggleStep}
                  />
                )}

                <FlowStepCard
                  step={step}
                  allSteps={snapshot.steps}
                  last={index === snapshot.steps.length - 1 && !snapshot.deliverable}
                  expanded={expandedStepKey === step.stepKey}
                  nowMs={nowMs}
                  liveText={liveText[step.stepKey] ?? ''}
                  liveTools={liveTools[step.stepKey] ?? []}
                  editable={editable}
                  runActive={running}
                  busy={busy}
                  availableEmployees={availableEmployees}
                  onToggle={() => onToggleStep(step.stepKey)}
                  onJumpToStep={onToggleStep}
                  onReplaceEmployee={(employeeId) => onReplaceEmployee(step.stepKey, employeeId)}
                  onRemoveDependency={(dependencyKey) => onRemoveDependency(step.stepKey, dependencyKey)}
                  onDelete={() => onDeleteStep(step.stepKey)}
                  onRetry={() => onRetryStep(step.stepKey)}
                  onPause={() => onPauseStep(step.stepKey)}
                  onResume={() => onResumeStep(step.stepKey)}
                  onOpenConversation={() => onOpenConversation(step.stepKey)}
                />
              </div>
            );
          })}

          <DeliverableCard snapshot={snapshot} />
        </ol>

        {editable && (
          <div className="mx-auto mt-1 max-w-4xl pl-[4.25rem]">
            <button
              type="button"
              onClick={onAddStep}
              disabled={availableEmployees.length === 0}
              className={cn(
                'flex w-full items-center justify-center gap-2 rounded-glass-lg border border-dashed border-glassline px-4 py-3 text-xs transition-colors duration-200',
                availableEmployees.length > 0
                  ? 'text-gtext-muted hover:border-glassline-brand hover:bg-gbrand/[0.06] hover:text-gbrand-text'
                  : 'cursor-not-allowed text-gtext-disabled',
              )}
            >
              <UserPlus className="h-3.5 w-3.5" />
              {availableEmployees.length > 0 ? '再加一位员工' : '还没有可调用的员工'}
            </button>
          </div>
        )}
        </div>
      )}

      {/* ── 过程流水抽屉 ───────────────────────────────────────────────────── */}
      {processOpen && (
        <div
          className="absolute inset-0 z-40 flex justify-end bg-gbg-deep/55 backdrop-blur-glass-xs"
          onClick={() => setProcessOpen(false)}
          role="presentation"
        >
          <aside
            className="flex h-full w-[min(24rem,100vw)] flex-col border-l border-glassline bg-gbg-raised shadow-glass-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-glassline px-4 py-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold text-gtext-primary">
                  <Waypoints className="h-4 w-4 text-gbrand-text" />
                  执行过程
                </p>
                <p className="mt-1 text-[11px] text-gtext-muted">每一次开始、交接、交付都记在这里</p>
              </div>
              <button
                type="button"
                onClick={() => setProcessOpen(false)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-glass-md text-gtext-muted transition-colors hover:bg-glass-2 hover:text-gtext-primary"
                aria-label="关闭执行过程"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
              <TaskProcessTimeline
                events={events}
                onJumpToStep={(stepKey) => {
                  onToggleStep(stepKey);
                  setProcessOpen(false);
                }}
                className="px-4 py-3"
              />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function ViewTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-glass-pill px-2.5 text-[11px] transition-all duration-200',
        active
          ? 'bg-gbg-raised text-gtext-primary shadow-glass-sm'
          : 'text-gtext-muted hover:bg-glass-3 hover:text-gtext-secondary',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
