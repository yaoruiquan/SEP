'use client';

import { useEffect, useState } from 'react';
import { FileOutput, GitBranch, ListTree, Play, Plus, Square, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { LiveToolCall } from '@/features/chat/use-chat-stream';
import type { TaskCandidateEmployee, TaskPlan, TaskPlanStep } from '../task-orchestration';
import { narrateRun, participatingEmployees } from '../task-step-state';
import { EmployeeBadge } from './employee-badge';
import { WorkbenchStepRow } from './workbench-step-row';

const RUN_TONE_TEXT = {
  draft: 'text-gtext-muted',
  ready: 'text-gbrand-text',
  active: 'text-gbrand-text',
  done: 'text-gsuccess',
  failed: 'text-gdanger',
  stopped: 'text-gwarning',
} as const;

/** running 时每秒走一下，让「已用 38s」真的在动 */
function useTicker(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

export interface TaskWorkbenchProps {
  plan: TaskPlan;
  running: boolean;
  pausedStepIds: string[];
  selectedStepId?: string;
  liveOutput: string;
  liveReasoning: string;
  toolCalls: LiveToolCall[];
  availableEmployees: TaskCandidateEmployee[];
  view: 'workbench' | 'graph';
  /** 依赖图视图下复用同一条目标栏，只渲染 header */
  headerOnly?: boolean;
  onViewChange: (view: 'workbench' | 'graph') => void;
  onSelectStep: (step: TaskPlanStep) => void;
  onClearSelection: () => void;
  onConfirm: () => void;
  onStop: () => void;
  onTogglePause: (stepId: string) => void;
  onRetry: (step: TaskPlanStep) => void;
  onDeleteStep: (stepId: string) => void;
  onReplaceStep: (stepId: string, employeeId: string) => void;
  onRemoveDependency: (stepId: string, dependencyId: string) => void;
  onAddNode: () => void;
  onViewOutput: () => void;
}

export function TaskWorkbench({
  plan,
  running,
  pausedStepIds,
  selectedStepId,
  liveOutput,
  liveReasoning,
  toolCalls,
  availableEmployees,
  view,
  headerOnly = false,
  onViewChange,
  onSelectStep,
  onClearSelection,
  onConfirm,
  onStop,
  onTogglePause,
  onRetry,
  onDeleteStep,
  onReplaceStep,
  onRemoveDependency,
  onAddNode,
  onViewOutput,
}: TaskWorkbenchProps) {
  const narration = narrateRun(plan);
  const nowMs = useTicker(running);
  const ordered = [...plan.steps].sort((left, right) => left.order - right.order);
  const team = participatingEmployees(plan);
  const canEdit = !running && plan.status !== 'completed';
  const hasOutput = plan.steps.some((step) => Boolean(step.output));

  const objectiveBar = (
    <ObjectiveBar
      plan={plan}
      narration={narration}
      team={team}
      running={running}
      canEdit={canEdit}
      hasOutput={hasOutput}
      view={view}
      onViewChange={onViewChange}
      onConfirm={onConfirm}
      onStop={onStop}
      onAddNode={onAddNode}
      onViewOutput={onViewOutput}
    />
  );

  if (headerOnly) return objectiveBar;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {objectiveBar}

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin px-4 py-4 xl:px-6">
        <ol className="mx-auto max-w-3xl">
          {ordered.map((step, index) => (
            <WorkbenchStepRow
              key={step.id}
              plan={plan}
              step={step}
              last={index === ordered.length - 1}
              selected={selectedStepId === step.id}
              paused={pausedStepIds.includes(step.id)}
              running={running}
              nowMs={nowMs}
              liveOutput={selectedStepId === step.id || step.status === 'running' ? liveOutput : ''}
              liveReasoning={step.status === 'running' ? liveReasoning : ''}
              toolCalls={step.status === 'running' ? toolCalls : []}
              canEdit={canEdit}
              availableEmployees={availableEmployees}
              onSelect={() => (selectedStepId === step.id ? onClearSelection() : onSelectStep(step))}
              onTogglePause={() => onTogglePause(step.id)}
              onRetry={() => onRetry(step)}
              onDelete={() => onDeleteStep(step.id)}
              onReplace={(employeeId) => onReplaceStep(step.id, employeeId)}
              onRemoveDependency={(dependencyId) => onRemoveDependency(step.id, dependencyId)}
            />
          ))}
        </ol>

        {canEdit && (
          <div className="mx-auto mt-2 max-w-3xl pl-[3.375rem]">
            <button
              type="button"
              onClick={onAddNode}
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
    </div>
  );
}

function ObjectiveBar({
  plan,
  narration,
  team,
  running,
  canEdit,
  hasOutput,
  view,
  onViewChange,
  onConfirm,
  onStop,
  onAddNode,
  onViewOutput,
}: {
  plan: TaskPlan;
  narration: ReturnType<typeof narrateRun>;
  team: TaskPlanStep['employee'][];
  running: boolean;
  canEdit: boolean;
  hasOutput: boolean;
  view: 'workbench' | 'graph';
  onViewChange: (view: 'workbench' | 'graph') => void;
  onConfirm: () => void;
  onStop: () => void;
  onAddNode: () => void;
  onViewOutput: () => void;
}) {
  const percent = narration.total > 0 ? Math.round((narration.doneCount / narration.total) * 100) : 0;

  return (
    <header className="shrink-0 border-b border-glassline bg-gbg-deep/35 px-4 py-3.5 backdrop-blur-glass-sm xl:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-6 text-gtext-primary">{plan.objective}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
              <span className={cn('font-medium', RUN_TONE_TEXT[narration.tone])}>{narration.label}</span>
              <span className="text-gtext-muted">{narration.detail}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {plan.status !== 'running' && plan.status !== 'completed' && (
              <Button size="sm" variant="glass-primary" onClick={onConfirm} disabled={running}>
                <Play className="h-3.5 w-3.5" />
                {narration.doneCount > 0 ? '继续执行' : '确认并执行'}
              </Button>
            )}
            {plan.status === 'running' && (
              <Button size="sm" variant="glass" onClick={onStop}>
                <Square className="h-3.5 w-3.5 fill-current" />
                停止
              </Button>
            )}
            {hasOutput && (
              <Button size="sm" variant="glass" onClick={onViewOutput}>
                <FileOutput className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">运行结果</span>
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center -space-x-2">
              {team.slice(0, 5).map((employee) => (
                <EmployeeBadge
                  key={employee.id}
                  name={employee.name}
                  avatar={employee.avatar}
                  tone={narration.focusStep?.employee.id === employee.id && running ? 'active' : 'idle'}
                  size="sm"
                  className="ring-2 ring-gbg-canvas"
                />
              ))}
              {team.length > 5 && (
                <span className="grid h-9 w-9 place-items-center rounded-full border border-glassline bg-glass-2 text-[10px] font-medium text-gtext-muted ring-2 ring-gbg-canvas">
                  +{team.length - 5}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="h-1 w-24 overflow-hidden rounded-glass-pill bg-glass-3">
                  <span
                    className={cn(
                      'block h-full rounded-glass-pill transition-all duration-500 ease-out',
                      narration.tone === 'failed' ? 'bg-gdanger' : narration.tone === 'done' ? 'bg-gsuccess' : 'bg-gbrand',
                    )}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <span className="text-[11px] tabular-nums text-gtext-muted">
                  {narration.doneCount}/{narration.total} 步
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 rounded-glass-md border border-glassline bg-glass-2 p-1">
            <ViewTab active={view === 'workbench'} onClick={() => onViewChange('workbench')} icon={ListTree} label="执行流" />
            <ViewTab active={view === 'graph'} onClick={() => onViewChange('graph')} icon={GitBranch} label="依赖图" />
          </div>
        </div>
      </div>
    </header>
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
        active ? 'bg-gbg-raised text-gtext-primary shadow-glass-sm' : 'text-gtext-muted hover:bg-glass-3 hover:text-gtext-secondary',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
