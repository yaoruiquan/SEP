'use client';

import { useState } from 'react';
import {
  ChevronDown,
  Ellipsis,
  Link2Off,
  MessageSquareText,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  UserCog,
  Wrench,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Markdown } from '@/features/chat/markdown';
import { cn } from '@/lib/utils';
import type { LiveStepTool, TaskCandidateEmployee } from '../task-execution-view-model';
import type { TaskExecutionStep } from '../task-execution';
import { narrateStep, toNarratable, type StepTone } from '../task-execution-narration';
import { CapabilityTag, EmployeeBadge, TONE_CHIP, TONE_TEXT } from './employee-badge';

const RAIL: Record<StepTone, string> = {
  idle: 'border-l border-dashed border-glassline',
  active: 'w-px bg-gbrand/40',
  done: 'w-px bg-gsuccess/40',
  failed: 'w-px bg-gdanger/40',
  paused: 'w-px bg-gwarning/40',
  skipped: 'border-l border-dashed border-glassline',
};

export interface FlowStepCardProps {
  step: TaskExecutionStep;
  allSteps: TaskExecutionStep[];
  last: boolean;
  expanded: boolean;
  nowMs: number;
  liveText: string;
  liveTools: LiveStepTool[];
  /** 计划还没开始跑 —— 这时卡片提供编辑能力，跑起来之后提供执行能力 */
  editable: boolean;
  runActive: boolean;
  busy: boolean;
  availableEmployees: TaskCandidateEmployee[];
  onToggle: () => void;
  onJumpToStep: (stepKey: string) => void;
  onReplaceEmployee: (employeeId: string) => void;
  onRemoveDependency: (dependencyStepKey: string) => void;
  onDelete: () => void;
  onRetry: () => void;
  onPause: () => void;
  onResume: () => void;
  onOpenConversation: () => void;
}

/**
 * 时间线上的一张工位卡。规划期与执行期共用。
 *
 * 收起态刻意压到一行半：会议要「一眼看到整个流程」，而卡片一高，三步就占满
 * 一屏，用户看到的是「一张表单」不是「一条流水线」。编辑类操作（换人、删步骤、
 * 断依赖）收进「⋯」，因为它们是偶发动作，常驻只会挤掉过程信息。
 */
export function FlowStepCard({
  step,
  allSteps,
  last,
  expanded,
  nowMs,
  liveText,
  liveTools,
  editable,
  runActive,
  busy,
  availableEmployees,
  onToggle,
  onJumpToStep,
  onReplaceEmployee,
  onRemoveDependency,
  onDelete,
  onRetry,
  onPause,
  onResume,
  onOpenConversation,
}: FlowStepCardProps) {
  const [promptOpen, setPromptOpen] = useState(false);

  const narratable = allSteps.map(toNarratable);
  const narration = narrateStep(toNarratable(step), { steps: narratable, nowMs });
  const tone = narration.tone;
  const isLive = step.status === 'running';
  const shownOutput = isLive ? liveText : step.output ?? '';
  const hasOutput = Boolean(shownOutput.trim());
  const dependencies = step.dependsOn
    .map((key) => allSteps.find((candidate) => candidate.stepKey === key))
    .filter((dependency): dependency is TaskExecutionStep => Boolean(dependency));

  const outputChars = (step.output ?? '').trim().length;

  return (
    <li className="group/row relative flex gap-3.5">
      {!last && (
        <span className={cn('absolute left-[27px] top-[3.5rem] h-[calc(100%-3rem)]', RAIL[tone])} aria-hidden />
      )}

      <div className="relative z-10 shrink-0 pt-2">
        <EmployeeBadge name={step.employee.name} avatar={step.employee.avatar} tone={tone} size="lg" />
      </div>

      <div
        className={cn(
          'mb-2 min-w-0 flex-1 rounded-glass-lg border transition-all duration-300 ease-out',
          isLive
            ? 'border-glassline-brand bg-gbrand/[0.05] shadow-glass-md'
            : expanded
              ? 'border-glassline-brand bg-glass-2 shadow-glass-sm'
              : tone === 'failed'
                ? 'border-gdanger/25 bg-gdanger/[0.05]'
                : 'border-glassline bg-glass-1 hover:border-glassline-hover',
        )}
      >
        {/* ── 收起态：一行标题 + 一行摘要，约 72px ─────────────────────────── */}
        <div className="flex items-start gap-2 px-3.5 py-2.5">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gbrand-ring"
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[11px] font-semibold tabular-nums text-gtext-muted">
                {String(step.order).padStart(2, '0')}
              </span>
              <p className="text-[15px] font-semibold leading-6 text-gtext-primary">{step.employee.name}</p>
              <CapabilityTag name={step.capability.name} tone={tone} />
            </div>

            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="text-gtext-secondary">{step.title}</span>
              {outputChars > 0 && !isLive && (
                <span className="tabular-nums text-gtext-muted">· 产出 {outputChars} 字</span>
              )}
              {isLive && liveText.length > 0 && (
                <span className="tabular-nums text-gbrand-text">· 已写 {liveText.length} 字</span>
              )}
            </p>
          </button>

          <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
            {step.attempt > 1 && (
              <span className="text-[10px] tabular-nums text-gtext-muted">第 {step.attempt} 次</span>
            )}
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-glass-pill border px-2 py-0.5 text-[11px] font-medium',
                TONE_CHIP[tone],
              )}
            >
              {narration.label}
            </span>
            {narration.timing && (
              <span
                className={cn(
                  'text-[11px] tabular-nums',
                  isLive ? 'font-medium text-gbrand-text' : 'text-gtext-muted',
                )}
              >
                {narration.timing}
              </span>
            )}

            <StepMenu
              step={step}
              editable={editable}
              runActive={runActive}
              busy={busy}
              availableEmployees={availableEmployees}
              dependencies={dependencies}
              onReplaceEmployee={onReplaceEmployee}
              onRemoveDependency={onRemoveDependency}
              onDelete={onDelete}
              onRetry={onRetry}
              onPause={onPause}
              onResume={onResume}
              onOpenConversation={onOpenConversation}
            />

            <button
              type="button"
              onClick={onToggle}
              aria-label={expanded ? '收起这一步' : '展开这一步'}
              className="grid h-6 w-6 place-items-center rounded-glass-md text-gtext-muted transition-colors hover:bg-glass-3 hover:text-gtext-primary"
            >
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', expanded && 'rotate-180')} />
            </button>
          </div>
        </div>

        {/* ── 一句话工作汇报：只在需要解释「为什么不动 / 出了什么事」时出现 ── */}
        {(tone === 'idle' || tone === 'failed' || tone === 'paused' || isLive) && (
          <p
            className={cn(
              'px-3.5 pb-2.5 text-xs leading-5',
              tone === 'failed' ? TONE_TEXT.failed : isLive ? 'text-gbrand-text' : 'text-gtext-muted',
            )}
          >
            {narration.detail}
          </p>
        )}

        {/* ── 实时输出：打字光标 + 工具调用 ──────────────────────────────── */}
        {isLive && (
          <div className="px-3.5 pb-3">
            {liveTools.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {liveTools.slice(-3).map((tool, index) => (
                  <span
                    key={`${tool.name}-${index}`}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-glass-pill border px-2 py-0.5 text-[10px]',
                      tool.status === 'running'
                        ? TONE_CHIP.active
                        : tool.success === false
                          ? TONE_CHIP.failed
                          : TONE_CHIP.done,
                    )}
                  >
                    <Wrench className={cn('h-2.5 w-2.5', tool.status === 'running' && 'animate-pulse')} />
                    {tool.status === 'running' ? '正在调用' : tool.success === false ? '调用失败' : '已调用'} {tool.name}
                  </span>
                ))}
              </div>
            )}

            {hasOutput ? (
              <div className="markdown-body max-h-64 overflow-y-auto rounded-glass-md border border-glassline-brand bg-gbg-deep/40 px-3 py-2.5 text-xs leading-5 scroll-thin">
                <Markdown content={shownOutput} />
                <span className="ml-0.5 inline-block h-3.5 w-[3px] animate-pulse bg-gbrand align-middle" />
              </div>
            ) : (
              <p className="flex items-center gap-1.5 rounded-glass-md border border-glassline-brand bg-gbg-deep/30 px-3 py-2.5 text-xs text-gtext-muted">
                <span className="inline-block h-3.5 w-[3px] animate-pulse bg-gbrand align-middle" />
                {step.employee.name} 正在思考，马上开始输出…
              </p>
            )}
          </div>
        )}

        {/* ── 已完成的产出：收起态给一段预览，展开看全文 ─────────────────── */}
        {!isLive && hasOutput && (
          <div className="px-3.5 pb-3">
            <div
              className={cn(
                'markdown-body overflow-y-auto rounded-glass-md border border-glassline bg-gbg-deep/25 px-3 py-2.5 text-xs leading-5 scroll-thin',
                expanded ? 'max-h-[32rem]' : 'max-h-24',
              )}
            >
              <Markdown content={shownOutput} />
            </div>
            {!expanded && outputChars > 220 && (
              <button
                type="button"
                onClick={onToggle}
                className="mt-1.5 text-[11px] font-medium text-gbrand-text transition-colors hover:text-gbrand-text-hover"
              >
                展开全文（{outputChars} 字）
              </button>
            )}
          </div>
        )}

        {/* ── 展开态：说明、理由、送进模型的输入、错误 ──────────────────── */}
        {expanded && (
          <div className="space-y-2.5 border-t border-glassline px-3.5 py-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gtext-muted">这一步要做什么</p>
              <p className="mt-1 text-xs leading-5 text-gtext-secondary">{step.description}</p>
            </div>

            {step.rationale && (
              <p className="rounded-glass-md border-l-2 border-glassline-brand bg-gbrand/[0.06] px-2.5 py-1.5 text-[11px] leading-5 text-gtext-muted">
                为什么派 {step.employee.name}：{step.rationale}
              </p>
            )}

            {dependencies.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gtext-muted">
                  上游
                </span>
                {dependencies.map((dependency) => (
                  <button
                    key={dependency.stepKey}
                    type="button"
                    onClick={() => onJumpToStep(dependency.stepKey)}
                    className="inline-flex items-center gap-1 rounded-glass-pill border border-glassline bg-glass-2 px-2 py-0.5 text-[10px] text-gtext-secondary transition-colors hover:border-glassline-brand hover:text-gbrand-text"
                  >
                    {String(dependency.order).padStart(2, '0')} {dependency.employee.name}
                  </button>
                ))}
              </div>
            )}

            {step.inputPrompt && (
              <div>
                <button
                  type="button"
                  onClick={() => setPromptOpen((current) => !current)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-gbrand-text transition-colors hover:text-gbrand-text-hover"
                >
                  <ChevronDown className={cn('h-3 w-3 transition-transform', promptOpen && 'rotate-180')} />
                  送给模型的完整输入（{step.inputPrompt.length} 字）
                </button>
                {promptOpen && (
                  <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded-glass-md border border-glassline bg-gbg-deep/40 px-2.5 py-2 text-[11px] leading-5 text-gtext-secondary scroll-thin">
                    {step.inputPrompt}
                  </pre>
                )}
              </div>
            )}

            {step.error && (
              <p className="rounded-glass-md border border-gdanger/25 bg-gdanger/[0.06] px-2.5 py-2 text-[11px] leading-5 text-gdanger">
                {step.error}
              </p>
            )}

            {step.sessionId && (
              <button
                type="button"
                onClick={onOpenConversation}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gbrand-text transition-colors hover:text-gbrand-text-hover"
              >
                <MessageSquareText className="h-3 w-3" />
                查看这一步的完整对话
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** 「⋯」菜单：编辑类与执行类操作都收在这里，让卡片正面只留过程信息 */
function StepMenu({
  step,
  editable,
  runActive,
  busy,
  availableEmployees,
  dependencies,
  onReplaceEmployee,
  onRemoveDependency,
  onDelete,
  onRetry,
  onPause,
  onResume,
  onOpenConversation,
}: {
  step: TaskExecutionStep;
  editable: boolean;
  runActive: boolean;
  busy: boolean;
  availableEmployees: TaskCandidateEmployee[];
  dependencies: TaskExecutionStep[];
  onReplaceEmployee: (employeeId: string) => void;
  onRemoveDependency: (dependencyStepKey: string) => void;
  onDelete: () => void;
  onRetry: () => void;
  onPause: () => void;
  onResume: () => void;
  onOpenConversation: () => void;
}) {
  const canRetry = !runActive && (step.status === 'failed' || step.status === 'completed');
  const canPause = runActive && step.status === 'queued';
  const canResume = step.status === 'paused';
  const others = availableEmployees.filter((employee) => employee.id !== step.employee.id);

  const hasAnything =
    canRetry || canPause || canResume || Boolean(step.sessionId) || (editable && (others.length > 0 || dependencies.length > 0));
  if (!hasAnything) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="这一步的更多操作"
          className="grid h-6 w-6 place-items-center rounded-glass-md text-gtext-muted opacity-0 transition-all duration-200 hover:bg-glass-3 hover:text-gtext-primary focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100"
        >
          <Ellipsis className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent glass align="end" className="min-w-[11rem]">
        {step.sessionId && (
          <DropdownMenuItem onClick={onOpenConversation}>
            <MessageSquareText className="mr-2 h-3.5 w-3.5" />
            查看完整对话
          </DropdownMenuItem>
        )}
        {canRetry && (
          <DropdownMenuItem disabled={busy} onClick={onRetry}>
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            从这一步重跑
          </DropdownMenuItem>
        )}
        {canPause && (
          <DropdownMenuItem disabled={busy} onClick={onPause}>
            <Pause className="mr-2 h-3.5 w-3.5" />
            暂停这一步
          </DropdownMenuItem>
        )}
        {canResume && (
          <DropdownMenuItem disabled={busy} onClick={onResume}>
            <Play className="mr-2 h-3.5 w-3.5" />
            恢复
          </DropdownMenuItem>
        )}

        {editable && others.length > 0 && (
          <>
            <div className="mt-1 border-t border-glassline pt-1">
              <p className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-gtext-muted">
                <UserCog className="h-3 w-3" />
                换人做这一步
              </p>
            </div>
            {others.slice(0, 6).map((employee) => (
              <DropdownMenuItem key={employee.id} onClick={() => onReplaceEmployee(employee.id)}>
                {employee.name}
              </DropdownMenuItem>
            ))}
          </>
        )}

        {editable && dependencies.length > 0 && (
          <>
            <div className="mt-1 border-t border-glassline pt-1">
              <p className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-gtext-muted">
                <Link2Off className="h-3 w-3" />
                断开上游依赖
              </p>
            </div>
            {dependencies.map((dependency) => (
              <DropdownMenuItem key={dependency.stepKey} onClick={() => onRemoveDependency(dependency.stepKey)}>
                不再等 {dependency.employee.name}
              </DropdownMenuItem>
            ))}
          </>
        )}

        {editable && (
          <div className="mt-1 border-t border-glassline pt-1">
            <DropdownMenuItem onClick={onDelete} className="text-gdanger focus:text-gdanger">
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              从计划里移除
            </DropdownMenuItem>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
