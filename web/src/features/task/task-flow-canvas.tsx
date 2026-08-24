'use client';

import {
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDashed,
  FileCheck2,
  Loader2,
  Sparkles,
  XCircle,
  Zap,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { buildTaskFlowStages } from './task-flow';
import type { TaskPlan, TaskPlanStep } from './task-orchestration';

const STATUS_LABELS = {
  queued: '等待执行',
  running: '执行中',
  completed: '已完成',
  failed: '执行失败',
  skipped: '已跳过',
} as const;

function StepStatusIcon({ status }: { status: TaskPlanStep['status'] }) {
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-danger" />;
  return <Circle className="h-4 w-4 text-fg-subtle" />;
}

function FlowConnector({ label }: { label?: string }) {
  return (
    <div className="flex h-12 flex-col items-center justify-center text-fg-subtle" aria-hidden="true">
      <div className="h-6 w-px bg-neutral-300" />
      {label ? <span className="absolute rounded-sm bg-neutral-100 px-2 py-0.5 text-[10px] text-fg-muted">{label}</span> : null}
      <ChevronDown className="-mt-1 h-4 w-4" />
    </div>
  );
}

function PlanStepNode({
  step,
  selected,
  onSelect,
}: {
  step: TaskPlanStep;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'relative min-h-36 w-full rounded-lg border bg-white p-4 text-left shadow-sm transition',
        selected ? 'border-primary ring-2 ring-primary/10' : 'border-neutral-200 hover:border-primary/30 hover:shadow',
        step.status === 'completed' && 'border-success/30',
        step.status === 'failed' && 'border-danger/40',
      )}
    >
      {step.status === 'running' && (
        <span className="absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-lg bg-primary/15">
          <span className="block h-full w-1/3 animate-[task-flow_1.4s_ease-in-out_infinite] bg-primary" />
        </span>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-xs font-semibold text-foreground">
            {step.order}
          </span>
          <p className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">{step.title}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-fg-muted">
          <StepStatusIcon status={step.status} />
          {STATUS_LABELS[step.status]}
        </span>
      </div>

      <p className="mt-3 line-clamp-2 text-xs leading-5 text-fg-muted">{step.description}</p>

      <div className="mt-4 flex items-center gap-2 border-t border-neutral-100 pt-3">
        <Avatar name={step.employee.name} src={step.employee.avatar} className="h-7 w-7 text-[10px]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">{step.employee.name}</p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-fg-subtle">
            <Zap className="h-3 w-3 shrink-0" />
            {step.capability.name}
          </p>
        </div>
        {step.status === 'completed' && <Check className="h-4 w-4 shrink-0 text-success" />}
      </div>
    </button>
  );
}

function EmptyFlow({ planning }: { planning: boolean }) {
  const phases = [
    { label: '理解目标', icon: Sparkles },
    { label: '选择员工与技能', icon: Bot },
    { label: '生成执行计划', icon: CircleDashed },
    { label: '确认后执行', icon: FileCheck2 },
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center py-8 sm:py-12">
      {phases.map((phase, index) => {
        const Icon = phase.icon;
        const active = planning && index <= 2;
        return (
          <div key={phase.label} className="flex w-full max-w-md flex-col items-center">
            {index > 0 && <FlowConnector />}
            <div
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border bg-white px-4 py-3 shadow-sm transition',
                active ? 'border-primary/40 bg-primary/[0.03]' : 'border-neutral-200',
              )}
            >
              <span className={cn('flex h-9 w-9 items-center justify-center rounded-md bg-neutral-100 text-fg-muted', active && 'bg-primary/10 text-primary')}>
                {active && index === 2 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{phase.label}</p>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  {planning && index === 0 && '正在分析任务目标'}
                  {planning && index === 1 && '正在读取可用员工能力'}
                  {planning && index === 2 && '规划模型正在拆解任务'}
                  {!planning && index === 0 && '等待输入任务'}
                  {!planning && index > 0 && '等待上一步'}
                  {planning && index === 3 && '等待计划生成'}
                </p>
              </div>
              <span className="text-xs font-medium text-fg-subtle">0{index + 1}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface TaskFlowCanvasProps {
  plan: TaskPlan | null;
  planning: boolean;
  selectedStepId?: string;
  onSelectStep: (step: TaskPlanStep) => void;
}

export function TaskFlowCanvas({ plan, planning, selectedStepId, onSelectStep }: TaskFlowCanvasProps) {
  if (!plan) return <EmptyFlow planning={planning} />;

  const stages = buildTaskFlowStages(plan.steps);

  return (
    <div className="mx-auto max-w-4xl py-3">
      <div className="mx-auto max-w-xl rounded-lg border border-neutral-300 bg-neutral-900 px-5 py-4 text-white shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium text-neutral-400">任务目标</span>
          <Badge className="border border-white/15 bg-white/10 text-[10px] text-neutral-200">模型已理解</Badge>
        </div>
        <p className="mt-2 text-sm font-medium leading-6">{plan.objective}</p>
      </div>

      {stages.map((stage, stageIndex) => (
        <div key={stage.depth}>
          <FlowConnector label={stage.steps.length > 1 ? `${stage.steps.length} 个同级步骤` : undefined} />
          <div className={cn('grid gap-3', stage.steps.length > 1 && 'xl:grid-cols-2')}>
            {stage.steps.map((step) => (
              <PlanStepNode
                key={step.id}
                step={step}
                selected={selectedStepId === step.id}
                onSelect={() => onSelectStep(step)}
              />
            ))}
          </div>
        </div>
      ))}

      <FlowConnector />
      <div className={cn(
        'mx-auto flex max-w-xl items-center gap-3 rounded-lg border px-4 py-3',
        plan.status === 'completed' ? 'border-success/30 bg-success/5' : 'border-dashed border-neutral-300 bg-white',
      )}>
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-md bg-neutral-100 text-fg-muted', plan.status === 'completed' && 'bg-success/10 text-success')}>
          <FileCheck2 className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">最终交付</p>
          <p className="mt-0.5 truncate text-xs text-fg-subtle">
            {plan.status === 'completed' ? '所有步骤已完成，可查看最终结果' : '汇总最后一步的执行结果'}
          </p>
        </div>
        {plan.status === 'completed' && <CheckCircle2 className="h-5 w-5 text-success" />}
      </div>
    </div>
  );
}
