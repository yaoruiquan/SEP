'use client';

import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock3,
  FileOutput,
  GitBranch,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Zap,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/features/chat/markdown';
import type { LiveToolCall } from '@/features/chat/use-chat-stream';
import type { TaskPlan, TaskPlanStep } from './task-orchestration';

function formatDuration(seconds: number) {
  return seconds >= 60 ? `${Math.ceil(seconds / 60)} 分钟` : `${seconds} 秒`;
}

function EmptyInspector() {
  return (
    <div className="flex h-full min-h-56 flex-col">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">任务状态</h2>
        <p className="mt-1 text-xs text-fg-subtle">等待创建编排任务</p>
      </div>
      <div className="space-y-0 px-5 py-5">
        {['描述任务目标', '模型生成计划', '确认员工与技能', '执行并交付'].map((label, index) => (
          <div key={label} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-neutral-300 bg-white text-[10px] font-medium text-fg-muted">{index + 1}</span>
              {index < 3 && <span className="h-8 w-px bg-neutral-200" />}
            </div>
            <p className="pt-0.5 text-xs text-fg-muted">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

interface TaskStepInspectorProps {
  plan: TaskPlan | null;
  step?: TaskPlanStep;
  running: boolean;
  liveOutput: string;
  toolCalls: LiveToolCall[];
  onConfirm: () => void;
  onStop: () => void;
  onRetry: (step: TaskPlanStep) => void;
}

export function TaskStepInspector({
  plan,
  step,
  running,
  liveOutput,
  toolCalls,
  onConfirm,
  onStop,
  onRetry,
}: TaskStepInspectorProps) {
  if (!plan) return <EmptyInspector />;

  const dependencies = step
    ? step.dependsOn
      .map((dependencyId) => plan.steps.find((candidate) => candidate.id === dependencyId))
      .filter((dependency): dependency is TaskPlanStep => Boolean(dependency))
    : [];
  const employeeCount = new Set(plan.steps.map((candidate) => candidate.employee.id)).size;
  const selectedOutput = step?.status === 'running' ? liveOutput : step?.output;

  return (
    <aside className="flex h-full min-h-0 flex-col bg-white">
      <div className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{step ? `步骤 ${step.order}` : '执行计划'}</h2>
            <p className="mt-1 text-xs text-fg-subtle">
              {step ? step.title : `${employeeCount} 位员工 · ${plan.steps.length} 个步骤`}
            </p>
          </div>
          {plan.status === 'awaiting_confirmation' && (
            <span className="rounded-sm border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] font-medium text-warning">待确认</span>
          )}
          {plan.status === 'running' && (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-info"><Loader2 className="h-3.5 w-3.5 animate-spin" />执行中</span>
          )}
          {plan.status === 'completed' && (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-success"><CheckCircle2 className="h-3.5 w-3.5" />已完成</span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <section className="border-b border-border px-5 py-5">
          <div className="flex items-center gap-3">
            {step ? (
              <Avatar name={step.employee.name} src={step.employee.avatar} className="h-10 w-10 text-sm" />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary"><Sparkles className="h-5 w-5" /></span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{step?.employee.name ?? '模型生成的执行计划'}</p>
              <p className="mt-0.5 truncate text-xs text-fg-muted">{step?.employee.position ?? plan.summary}</p>
            </div>
          </div>

          {step && (
            <dl className="mt-5 space-y-3 text-xs">
              <div className="flex items-start gap-3">
                <dt className="flex w-20 shrink-0 items-center gap-1.5 text-fg-subtle"><Zap className="h-3.5 w-3.5" />调用技能</dt>
                <dd className="font-medium text-foreground">{step.capability.name}</dd>
              </div>
              <div className="flex items-start gap-3">
                <dt className="flex w-20 shrink-0 items-center gap-1.5 text-fg-subtle"><Clock3 className="h-3.5 w-3.5" />预计耗时</dt>
                <dd className="text-foreground">{formatDuration(step.estimatedSeconds)}</dd>
              </div>
              <div className="flex items-start gap-3">
                <dt className="flex w-20 shrink-0 items-center gap-1.5 text-fg-subtle"><GitBranch className="h-3.5 w-3.5" />上游步骤</dt>
                <dd className="min-w-0 text-foreground">
                  {dependencies.length > 0 ? dependencies.map((dependency) => dependency.title).join('、') : '无，可直接执行'}
                </dd>
              </div>
            </dl>
          )}
        </section>

        {step && (
          <section className="border-b border-border px-5 py-5">
            <h3 className="text-xs font-semibold text-foreground">步骤要求</h3>
            <p className="mt-2 text-xs leading-5 text-fg-muted">{step.description}</p>
            <div className="mt-4 rounded-md border-l-2 border-primary bg-neutral-50 px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-foreground"><Bot className="h-3.5 w-3.5 text-primary" />选择依据</p>
              <p className="mt-1 text-[11px] leading-5 text-fg-muted">{step.rationale}</p>
            </div>
          </section>
        )}

        {toolCalls.length > 0 && step?.status === 'running' && (
          <section className="border-b border-border px-5 py-5">
            <h3 className="text-xs font-semibold text-foreground">技能调用</h3>
            <div className="mt-3 space-y-2">
              {toolCalls.map((tool, index) => (
                <div key={`${tool.name}-${index}`} className="flex items-center gap-2 rounded-md bg-neutral-50 px-3 py-2 text-xs">
                  {tool.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-info" /> : <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                  <span className="min-w-0 flex-1 truncate text-foreground">{tool.name}</span>
                  <span className="text-[10px] text-fg-subtle">{tool.status === 'running' ? '调用中' : '完成'}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {step && (selectedOutput || step.error || step.status === 'running') && (
          <section className="px-5 py-5">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              {step.error ? <AlertCircle className="h-3.5 w-3.5 text-danger" /> : <FileOutput className="h-3.5 w-3.5 text-primary" />}
              {step.status === 'completed' ? '步骤产出' : step.error ? '错误信息' : '实时输出'}
            </h3>
            {step.error ? (
              <p className="mt-3 rounded-md bg-danger/5 px-3 py-2.5 text-xs leading-5 text-danger">{step.error}</p>
            ) : selectedOutput ? (
              <div className="markdown-body mt-3 text-xs"><Markdown content={selectedOutput} /></div>
            ) : (
              <div className="mt-3 flex items-center gap-2 text-xs text-fg-muted"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />员工正在处理当前步骤</div>
            )}
          </section>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-white px-5 py-4">
        {plan.status === 'awaiting_confirmation' && (
          <Button className="w-full" onClick={onConfirm} disabled={running || plan.steps.length === 0}>
            <Play className="h-4 w-4" />
            确认并开始执行
          </Button>
        )}
        {plan.status === 'running' && (
          <Button className="w-full" variant="secondary" onClick={onStop}>
            <Square className="h-3.5 w-3.5 fill-current" />
            停止执行
          </Button>
        )}
        {plan.status === 'failed' && step?.status === 'failed' && (
          <Button className="w-full" onClick={() => onRetry(step)} disabled={running}>
            <RotateCcw className="h-4 w-4" />
            从当前步骤重试
          </Button>
        )}
        {plan.status === 'completed' && (
          <p className="text-center text-xs text-fg-muted">任务已完成，点击流程节点查看每一步产出</p>
        )}
      </div>
    </aside>
  );
}
