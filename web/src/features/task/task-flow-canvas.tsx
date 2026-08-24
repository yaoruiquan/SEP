'use client';

import type { CSSProperties } from 'react';
import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Circle,
  CircleDashed,
  FileCheck2,
  GitBranch,
  Loader2,
  Sparkles,
  XCircle,
  Zap,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { buildTaskFlowStages } from './task-flow';
import type { TaskPlan, TaskPlanStep } from './task-orchestration';

const STATUS_LABELS = {
  queued: '候场中',
  running: '正在工作',
  completed: '已完成',
  failed: '需要处理',
  skipped: '已跳过',
} as const;

function StepStatusIcon({ status }: { status: TaskPlanStep['status'] }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-danger" />;
  return <Circle className="h-3.5 w-3.5 text-fg-subtle" />;
}

function PlanStepNode({ step, selected, onSelect }: { step: TaskPlanStep; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group relative flex min-h-28 w-full flex-col rounded-md border bg-white p-3 text-left transition',
        selected ? 'border-primary shadow-sm ring-2 ring-primary/10' : 'border-neutral-200 hover:border-primary/30',
        step.status === 'completed' && 'border-success/35 bg-success/[0.025]',
        step.status === 'failed' && 'border-danger/40 bg-danger/[0.025]',
      )}
    >
      {step.status === 'running' && (
        <span className="absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-md bg-primary/15">
          <span className="block h-full w-1/3 animate-[task-flow_1.4s_ease-in-out_infinite] bg-primary" />
        </span>
      )}
      <div className="flex items-start gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-neutral-100 text-[11px] font-semibold text-foreground">
          {String(step.order).padStart(2, '0')}
        </span>
        <p className="line-clamp-2 min-w-0 flex-1 text-xs font-semibold leading-5 text-foreground">{step.title}</p>
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-fg-muted">
          <StepStatusIcon status={step.status} />
          {STATUS_LABELS[step.status]}
        </span>
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-neutral-100 pt-2.5">
        <Avatar name={step.employee.name} src={step.employee.avatar} className="h-7 w-7 text-[10px]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-foreground">{step.employee.name}</p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-fg-subtle">
            <Zap className="h-3 w-3 shrink-0" />
            {step.capability.name}
          </p>
        </div>
        {step.dependsOn.length > 0 && <GitBranch className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-label="依赖前序步骤" />}
        {step.status === 'completed' && <Check className="h-4 w-4 shrink-0 text-success" />}
      </div>
    </button>
  );
}

function EmptyFlow({ planning }: { planning: boolean }) {
  const phases = [
    { label: '理解目标', detail: planning ? '正在分析任务' : '等待输入任务', icon: Sparkles },
    { label: '选择员工与技能', detail: planning ? '正在匹配团队' : '等待目标', icon: Bot },
    { label: '生成执行计划', detail: planning ? '模型正在编排' : '等待员工匹配', icon: CircleDashed },
    { label: '确认后执行', detail: '由你授权启动', icon: FileCheck2 },
  ];

  return (
    <div className="grid h-full min-h-0 content-start grid-cols-2 gap-2 px-1 sm:gap-3 xl:grid-cols-4">
      {phases.map((phase, index) => {
        const Icon = phase.icon;
        const active = planning && index <= 2;
        return (
          <div key={phase.label} className="relative">
            <div className={cn(
              'flex h-full min-h-24 items-center gap-3 rounded-md border bg-white p-3',
              active ? 'border-primary/40 bg-primary/[0.03]' : 'border-neutral-200',
            )}>
              <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-fg-muted', active && 'bg-primary/10 text-primary')}>
                {active && index === 2 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">{phase.label}</p>
                <p className="mt-1 truncate text-[10px] text-fg-subtle">{phase.detail}</p>
              </div>
              <span className="text-[10px] font-medium text-fg-subtle">0{index + 1}</span>
            </div>
            {index < phases.length - 1 && <ArrowRight className="absolute -right-2.5 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 rounded-full bg-neutral-50 text-fg-subtle xl:block" />}
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
  const columnCount = Math.min(Math.max(stages.length, 1), 4);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex min-h-16 shrink-0 items-center gap-4 rounded-md border border-neutral-800 bg-neutral-900 px-4 py-3 text-white">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/10 text-primary"><Sparkles className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium text-neutral-400">任务目标 · 模型已理解</p>
          <p className="mt-1 line-clamp-2 text-xs font-medium leading-5">{plan.objective}</p>
        </div>
      </div>

      <div
        className="task-flow-plan-grid grid min-h-0 flex-1 content-center gap-3"
        style={{ '--task-flow-columns': columnCount } as CSSProperties}
      >
        {stages.map((stage, stageIndex) => (
          <div key={stage.depth} className="relative flex min-w-0 flex-col justify-center gap-2">
            {stage.steps.map((step) => (
              <PlanStepNode key={step.id} step={step} selected={selectedStepId === step.id} onSelect={() => onSelectStep(step)} />
            ))}
            {stageIndex < stages.length - 1 && (stageIndex + 1) % 4 !== 0 && (
              <ArrowRight className="absolute -right-2.5 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 rounded-full bg-neutral-50 text-fg-subtle xl:block" aria-hidden="true" />
            )}
          </div>
        ))}
      </div>

      <div className={cn(
        'flex min-h-14 shrink-0 items-center gap-3 rounded-md border px-4 py-2.5',
        plan.status === 'completed' ? 'border-success/35 bg-success/5' : 'border-dashed border-neutral-300 bg-white',
      )}>
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-md bg-neutral-100 text-fg-muted', plan.status === 'completed' && 'bg-success/10 text-success')}>
          <FileCheck2 className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground">最终交付</p>
          <p className="mt-0.5 truncate text-[10px] text-fg-subtle">
            {plan.status === 'completed' ? '硅基团队已完成交付，右侧可查看摘要' : '所有员工完成工作后汇总交付'}
          </p>
        </div>
        {plan.status === 'completed' && <CheckCircle2 className="h-5 w-5 text-success" />}
      </div>
    </div>
  );
}
