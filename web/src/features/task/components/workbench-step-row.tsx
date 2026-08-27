'use client';

import { useState } from 'react';
import { ChevronDown, Link2Off, Pause, Play, RotateCcw, Trash2, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/features/chat/markdown';
import type { LiveToolCall } from '@/features/chat/use-chat-stream';
import { cn } from '@/lib/utils';
import type { TaskCandidateEmployee, TaskPlan, TaskPlanStep } from '../task-orchestration';
import { narrateStep, type StepTone } from '../task-step-state';
import { CapabilityTag, EmployeeBadge, TONE_CHIP, TONE_TEXT } from './employee-badge';

const RAIL: Record<StepTone, string> = {
  idle: 'border-l border-dashed border-glassline',
  active: 'w-px bg-gbrand/35',
  done: 'w-px bg-gsuccess/35',
  failed: 'w-px bg-gdanger/35',
  paused: 'w-px bg-gwarning/35',
  skipped: 'border-l border-dashed border-glassline',
};

export interface WorkbenchStepRowProps {
  plan: TaskPlan;
  step: TaskPlanStep;
  last: boolean;
  selected: boolean;
  paused: boolean;
  running: boolean;
  nowMs: number;
  liveOutput: string;
  liveReasoning: string;
  toolCalls: LiveToolCall[];
  canEdit: boolean;
  availableEmployees: TaskCandidateEmployee[];
  onSelect: () => void;
  onTogglePause: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onReplace: (employeeId: string) => void;
  onRemoveDependency: (dependencyId: string) => void;
}

export function WorkbenchStepRow({
  plan,
  step,
  last,
  selected,
  paused,
  running,
  nowMs,
  liveOutput,
  liveReasoning,
  toolCalls,
  canEdit,
  availableEmployees,
  onSelect,
  onTogglePause,
  onRetry,
  onDelete,
  onReplace,
  onRemoveDependency,
}: WorkbenchStepRowProps) {
  const [outputOpen, setOutputOpen] = useState(false);
  const narration = narrateStep(step, { plan, paused, nowMs });
  const tone = narration.tone;
  const isLive = step.status === 'running';
  const output = isLive ? liveOutput : step.output ?? '';
  const showOutput = isLive || (Boolean(output) && (outputOpen || selected));
  const dependencies = step.dependsOn
    .map((id) => plan.steps.find((candidate) => candidate.id === id))
    .filter((dependency): dependency is TaskPlanStep => Boolean(dependency));

  return (
    <li className="group/row relative flex gap-3.5 pb-3 last:pb-0">
      {!last && (
        <span className={cn('absolute left-[21px] top-16 h-[calc(100%-3.5rem)]', RAIL[tone])} aria-hidden />
      )}
      <div className="relative z-10 pt-3">
        <EmployeeBadge name={step.employee.name} avatar={step.employee.avatar} tone={tone} size="lg" />
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect();
          }
        }}
        className={cn(
          'min-w-0 flex-1 cursor-pointer rounded-glass-lg border px-4 py-3 text-left transition-all duration-200 ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gbrand-ring',
          selected || isLive
            ? 'border-glassline-brand bg-glass-2 shadow-glass-sm'
            : tone === 'failed'
              ? 'border-gdanger/25 bg-gdanger/[0.05] hover:bg-gdanger/[0.08]'
              : 'border-glassline bg-glass-1 hover:border-glassline-hover hover:bg-glass-2',
        )}
      >
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="text-[11px] tabular-nums text-gtext-muted">{String(step.order).padStart(2, '0')}</span>
          <p className="text-sm font-semibold text-gtext-primary">{step.employee.name}</p>
          {/* 岗位常常和员工名一字不差（"变革管理顾问"），重复一遍只是噪音 */}
          {step.employee.position && step.employee.position !== step.employee.name && (
            <span className="truncate text-[11px] text-gtext-muted">{step.employee.position}</span>
          )}
          <CapabilityTag name={step.capability.name} tone={tone} />
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <span className={cn('rounded-glass-pill border px-2 py-0.5 text-[10px] font-medium', TONE_CHIP[tone])}>
              {narration.label}
            </span>
            {narration.timing && <span className="text-[10px] tabular-nums text-gtext-muted">{narration.timing}</span>}
            {canEdit && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
                className="grid h-6 w-6 place-items-center rounded-glass-md text-gtext-muted opacity-0 transition-all duration-200 hover:bg-gdanger/12 hover:text-gdanger focus-visible:opacity-100 group-hover/row:opacity-100"
                aria-label={`把 ${step.employee.name} 从计划里移除`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
        </div>

        <p className={cn('mt-1.5 text-xs leading-5', tone === 'failed' ? TONE_TEXT.failed : 'text-gtext-secondary')}>
          {narration.detail}
        </p>

        <p className="mt-1 line-clamp-1 text-[11px] text-gtext-muted">{step.title}</p>

        {isLive && toolCalls.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {toolCalls.slice(-3).map((tool, index) => (
              <span
                key={`${tool.name}-${index}`}
                className={cn(
                  'inline-flex items-center gap-1 rounded-glass-pill border px-2 py-0.5 text-[10px]',
                  tool.status === 'running' ? TONE_CHIP.active : TONE_CHIP.done,
                )}
              >
                <Wrench className="h-2.5 w-2.5" />
                {tool.status === 'running' ? '正在调用' : '已调用'} {tool.name}
              </span>
            ))}
          </div>
        )}

        {isLive && !output && liveReasoning.trim() && (
          <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-gtext-muted">
            正在思考：{liveReasoning.trim().slice(-140)}
          </p>
        )}

        {showOutput && output && (
          <div
            className={cn(
              'markdown-body mt-2.5 overflow-y-auto rounded-glass-md border border-glassline bg-gbg-deep/30 px-3 py-2.5 text-xs leading-5 scroll-thin',
              isLive ? 'max-h-56' : 'max-h-72',
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <Markdown content={output} />
          </div>
        )}

        {!isLive && output && !selected && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setOutputOpen((current) => !current);
            }}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-gbrand-text transition-colors hover:text-gbrand-text-hover"
          >
            <ChevronDown className={cn('h-3 w-3 transition-transform duration-200', outputOpen && 'rotate-180')} />
            {outputOpen ? '收起交付内容' : '查看交付内容'}
          </button>
        )}

        {selected && (
          <div className="mt-3 space-y-2.5 border-t border-glassline pt-3" onClick={(event) => event.stopPropagation()}>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gtext-muted">这一步要做什么</p>
              <p className="mt-1 text-[11px] leading-5 text-gtext-secondary">{step.description}</p>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gtext-muted">
                上游依赖 · {dependencies.length} 条
              </p>
              {dependencies.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {dependencies.map((dependency) => (
                    <span
                      key={dependency.id}
                      className="inline-flex items-center gap-1.5 rounded-glass-pill border border-glassline bg-glass-2 py-0.5 pl-2 pr-1 text-[10px] text-gtext-secondary"
                    >
                      {dependency.employee.name}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => onRemoveDependency(dependency.id)}
                          className="grid h-4 w-4 place-items-center rounded-glass-pill text-gtext-muted transition-colors hover:bg-gdanger/15 hover:text-gdanger"
                          aria-label={`移除对 ${dependency.employee.name} 的依赖`}
                        >
                          <Link2Off className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-gtext-muted">直接从你的目标开始，不等其他人。</p>
              )}
            </div>

            {canEdit && availableEmployees.length > 1 && (
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gtext-muted">
                  换人做这一步
                </label>
                <select
                  value={step.employee.id}
                  onChange={(event) => onReplace(event.target.value)}
                  className="mt-1.5 h-8 w-full rounded-glass-md border border-glassline bg-glass-2 px-2 text-xs text-gtext-primary outline-none focus:border-glassline-brand"
                >
                  {availableEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {step.rationale && (
              <div className="rounded-glass-md border-l-2 border-glassline-brand bg-gbrand/[0.06] px-2.5 py-2">
                <p className="text-[10px] font-semibold text-gtext-secondary">为什么派 {step.employee.name}</p>
                <p className="mt-1 text-[11px] leading-5 text-gtext-muted">{step.rationale}</p>
              </div>
            )}
          </div>
        )}

        {(tone === 'failed' || (running && (step.status === 'queued' || step.status === 'running'))) && (
          <div className="mt-2.5 flex items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
            {tone === 'failed' && (
              <Button size="sm" variant="glass-primary" className="h-7 px-2.5 text-[11px]" onClick={onRetry} disabled={running}>
                <RotateCcw className="h-3 w-3" />
                从这一步重试
              </Button>
            )}
            {running && (step.status === 'queued' || step.status === 'running') && (
              <Button size="sm" variant="glass" className="h-7 px-2.5 text-[11px]" onClick={onTogglePause}>
                {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                {paused ? '恢复' : '暂停'}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
