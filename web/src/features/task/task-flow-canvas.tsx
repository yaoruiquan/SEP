'use client';

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Circle,
  CircleDashed,
  FileCheck2,
  FileOutput,
  GitBranch,
  Loader2,
  MousePointer2,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Unlink,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/features/chat/markdown';
import type { LiveToolCall } from '@/features/chat/use-chat-stream';
import { cn } from '@/lib/utils';
import type { TaskCandidateEmployee, TaskPlan, TaskPlanStep } from './task-orchestration';

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

function PlanStepNode({
  step,
  selected,
  connecting,
  onSelect,
  onPointerDown,
  onStartConnect,
}: {
  step: TaskPlanStep;
  selected: boolean;
  connecting: boolean;
  onSelect: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onStartConnect: () => void;
}) {
  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onClick={onSelect}
      className={cn(
        'group relative flex min-h-[7.25rem] w-full flex-col rounded-xl border bg-white p-3.5 text-left transition duration-200',
        selected ? 'border-primary/50 shadow-[0_8px_24px_-18px_rgba(219,39,119,0.35)] ring-2 ring-primary/5' : 'border-slate-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_8px_24px_-18px_rgba(15,23,42,0.25)]',
        step.status === 'completed' && 'border-emerald-200 bg-emerald-50/30',
        step.status === 'failed' && 'border-rose-200 bg-rose-50/40',
      )}
    >
      {step.dependsOn.length > 0 && (
        <span className="absolute -top-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-primary/20 bg-white px-2 py-0.5 text-[9px] font-medium text-primary shadow-sm">
          <span className="absolute -bottom-4 left-1/2 h-4 w-px -translate-x-1/2 bg-primary/30" />
          <GitBranch className="h-2.5 w-2.5" />
          {step.dependsOn.length} 条连接
        </span>
      )}
      {step.status === 'running' && (
        <span className="absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-md bg-primary/15">
          <span className="block h-full w-1/3 animate-[task-flow_1.4s_ease-in-out_infinite] bg-primary" />
        </span>
      )}
      <div className="flex items-start gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[11px] font-semibold text-slate-700">
          {String(step.order).padStart(2, '0')}
        </span>
        <p className="line-clamp-2 min-w-0 flex-1 text-xs font-semibold leading-5 text-slate-900">{step.title}</p>
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-slate-500">
          <StepStatusIcon status={step.status} />
          {STATUS_LABELS[step.status]}
        </span>
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-slate-100 pt-2.5">
        <Avatar name={step.employee.name} src={step.employee.avatar} className="h-7 w-7 text-[10px]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold text-slate-800">{step.employee.name}</p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-slate-500">
            <Zap className="h-3 w-3 shrink-0 text-slate-400" />
            {step.capability.name}
          </p>
        </div>
        <span
          role="button"
          tabIndex={0}
          aria-label={connecting ? '正在连接，点击其他节点完成连线' : '从此节点开始连线'}
          onClick={(event) => { event.stopPropagation(); onStartConnect(); }}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onStartConnect(); } }}
          className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition', connecting ? 'bg-primary/10 text-primary' : 'text-slate-400 hover:bg-slate-100 hover:text-primary')}
        >
          {step.dependsOn.length > 0 ? <GitBranch className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}
        </span>
        {step.status === 'completed' && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
      </div>
    </button>
  );
}

function FlowEndpoint({ type, plan, onSelect }: { type: 'input' | 'output'; plan: TaskPlan; onSelect?: () => void }) {
  const input = type === 'input';
  return (
    <div className={cn(
      'relative flex min-h-[7.25rem] flex-col justify-between rounded-2xl border px-4 py-4',
      input ? 'border-primary/25 bg-primary/[0.045]' : plan.status === 'completed' ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white',
    )}>
      <div className="flex items-start gap-3">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', input ? 'bg-primary text-white' : 'bg-emerald-100 text-emerald-600')}>
          {input ? <Sparkles className="h-4 w-4" /> : <FileOutput className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          <p className={cn('text-[10px] font-semibold uppercase tracking-[0.12em]', input ? 'text-primary' : 'text-emerald-700')}>{input ? '任务输入' : '交付输出'}</p>
          <p className="mt-1 line-clamp-3 text-xs font-semibold leading-5 text-slate-900">{input ? plan.objective : plan.status === 'completed' ? '硅基团队已完成交付' : '等待所有步骤完成后汇总'}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
        {input ? '由你的目标开始' : plan.status === 'completed' ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />结果已就绪</> : '执行过程中的每一步都会汇入这里'}
      </div>
      {onSelect && <button type="button" className="absolute inset-0 rounded-2xl" onClick={onSelect} aria-label="查看任务输入" />}
    </div>
  );
}

function StepDetail({
  plan,
  step,
  running,
  liveOutput,
  liveReasoning,
  toolCalls,
  onConfirm,
  onStop,
  onRetry,
  availableEmployees,
  onReplace,
}: {
  plan: TaskPlan;
  step: TaskPlanStep;
  running: boolean;
  liveOutput: string;
  liveReasoning: string;
  toolCalls: LiveToolCall[];
  onConfirm: () => void;
  onStop: () => void;
  onRetry: (step: TaskPlanStep) => void;
  availableEmployees: TaskCandidateEmployee[];
  onReplace: (employeeId: string) => void;
}) {
  const actions = [
    ...toolCalls.slice(-2).map((tool) => `${tool.status === 'running' ? '正在调用' : '已完成'} ${tool.name}`),
    ...(liveReasoning.trim() ? [`正在分析：${liveReasoning.trim().slice(-100)}`] : []),
  ].slice(-3);
  const output = step.status === 'running' ? liveOutput : step.output ?? '';
  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_30px_-26px_rgba(15,23,42,0.45)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn('relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 bg-slate-50', step.status === 'running' && 'border-primary', step.status === 'completed' && 'border-emerald-400', step.status === 'failed' && 'border-rose-400', step.status === 'queued' && 'border-slate-200')}>
            {step.status === 'running' && <span className="absolute -inset-1 animate-pulse rounded-2xl border border-primary/20" />}
            <Avatar name={step.employee.name} src={step.employee.avatar} className="h-10 w-10 text-sm" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-950">{step.employee.name}</p>
            <p className="mt-0.5 truncate text-xs text-slate-500">{step.employee.position} · {step.capability.name}</p>
            <p className={cn('mt-1 text-xs font-medium', step.status === 'running' ? 'text-primary' : step.status === 'completed' ? 'text-emerald-600' : step.status === 'failed' ? 'text-rose-600' : 'text-amber-600')}>
              {step.status === 'running' ? '正在工作' : step.status === 'completed' ? '已完成并提交结果' : step.status === 'failed' ? step.error ?? '执行失败' : '候场中，等待上游交付'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {plan.status === 'awaiting_confirmation' && <Button size="sm" onClick={onConfirm} disabled={running}><Play className="h-3.5 w-3.5" />确认并执行</Button>}
          {plan.status === 'running' && <Button size="sm" variant="secondary" onClick={onStop}><Square className="h-3.5 w-3.5 fill-current" />停止</Button>}
          {plan.status === 'failed' && step.status === 'failed' && <Button size="sm" variant="secondary" onClick={() => onRetry(step)} disabled={running}><RotateCcw className="h-3.5 w-3.5" />重试</Button>}
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-xl bg-slate-50 px-3.5 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">执行动态</p>
          <div className="mt-2 space-y-2">
            {actions.length > 0 ? actions.map((action, index) => <p key={`${action}-${index}`} className="flex gap-2 text-[11px] leading-5 text-slate-600"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />{action}</p>) : <p className="text-[11px] leading-5 text-slate-500">{step.status === 'queued' ? '员工已选定，确认计划后开始调用。' : '该步骤的实时动作会显示在这里。'}</p>}
          </div>
        </div>
        <div className="min-w-0 rounded-xl border border-slate-100 px-3.5 py-3">
          <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">步骤结果</p><span className="text-[10px] text-slate-400">预计 {Math.ceil(step.estimatedSeconds / 60)} 分钟</span></div>
          {output ? <div className="markdown-body mt-2 max-h-48 overflow-y-auto text-xs leading-5"><Markdown content={output} /></div> : <p className="mt-2 text-[11px] leading-5 text-slate-500">{step.status === 'completed' ? '该步骤已完成，但没有返回文本结果。' : '执行完成后，结果会在这里展开。'}</p>}
        </div>
      </div>
    </div>
  );
}

function CanvasToolbar({ plan, canEdit, onAddNode }: { plan: TaskPlan; canEdit: boolean; onAddNode: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        draggable={canEdit}
        disabled={!canEdit}
        onDragStart={(event) => event.dataTransfer.setData('application/x-sep-node', 'employee')}
        onClick={onAddNode}
        className={cn(
          'flex items-center gap-2 rounded-lg border bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 shadow-[0_4px_12px_-10px_rgba(15,23,42,0.4)] transition',
          canEdit ? 'cursor-grab border-slate-200 hover:-translate-y-0.5 hover:border-primary/30 hover:text-primary active:cursor-grabbing' : 'cursor-not-allowed border-slate-100 text-slate-300',
        )}
        title="拖入画布新增硅基员工节点，也可以点击快速添加"
      >
        <Bot className="h-3.5 w-3.5" />
        新增员工节点
      </button>
      <span className="hidden items-center gap-1 text-[10px] text-slate-400 sm:inline-flex"><MousePointer2 className="h-3 w-3" />拖动节点调整顺序</span>
      <span className="hidden items-center gap-1 text-[10px] text-slate-400 md:inline-flex"><GitBranch className="h-3 w-3" />点击连接点再选择目标</span>
      <span className="ml-auto text-[10px] text-slate-400">{plan.steps.length} 个员工节点</span>
    </div>
  );
}

function StepInspectorPanel({
  plan,
  step,
  running,
  liveOutput,
  liveReasoning,
  toolCalls,
  onConfirm,
  onStop,
  onRetry,
  availableEmployees,
  onReplace,
  onRemoveDependency,
  onClose,
}: {
  plan: TaskPlan;
  step?: TaskPlanStep;
  running: boolean;
  liveOutput: string;
  liveReasoning: string;
  toolCalls: LiveToolCall[];
  onConfirm: () => void;
  onStop: () => void;
  onRetry: (step: TaskPlanStep) => void;
  availableEmployees: TaskCandidateEmployee[];
  onReplace: (employeeId: string) => void;
  onRemoveDependency: (dependencyId: string) => void;
  onClose: () => void;
}) {
  if (!step) return null;
  return (
    <aside className="absolute inset-y-0 right-0 z-30 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col border-l border-slate-200 bg-white shadow-[-18px_0_40px_-32px_rgba(15,23,42,0.55)]">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-4"><div><p className="text-sm font-semibold text-slate-950">节点配置</p><p className="mt-1 text-[11px] text-slate-500">步骤 {step.order} · {step.title}</p></div><div className="flex items-center gap-2"><StepStatusIcon status={step.status} /><button type="button" className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={onClose} aria-label="关闭节点配置"><X className="h-4 w-4" /></button></div></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex items-center gap-3"><div className={cn('relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 bg-slate-50', step.status === 'running' && 'border-primary', step.status === 'completed' && 'border-emerald-400', step.status === 'failed' && 'border-rose-400')}><Avatar name={step.employee.name} src={step.employee.avatar} className="h-10 w-10" /></div><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-950">{step.employee.name}</p><p className="truncate text-xs text-slate-500">{step.employee.position}</p><p className={cn('mt-1 text-xs font-medium', step.status === 'running' ? 'text-primary' : step.status === 'completed' ? 'text-emerald-600' : step.status === 'failed' ? 'text-rose-600' : 'text-amber-600')}>{STATUS_LABELS[step.status]}</p></div></div>
        <div className="mt-4 rounded-xl bg-slate-50 px-3 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">执行员工</p><select value={step.employee.id} onChange={(event) => onReplace(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-800 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10">{availableEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">使用技能</p><p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-800"><Zap className="h-3.5 w-3.5 text-primary" />{step.capability.name}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{step.description}</p></div>
        <div className="mt-4 rounded-xl border border-slate-200 px-3 py-3"><div className="flex items-center justify-between gap-2"><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">上游依赖</p><span className="text-[10px] text-slate-400">{step.dependsOn.length} 条</span></div>{step.dependsOn.length > 0 ? <div className="mt-2 space-y-1.5">{step.dependsOn.map((dependencyId) => { const dependency = plan.steps.find((candidate) => candidate.id === dependencyId); return <div key={dependencyId} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5"><span className="min-w-0 truncate text-[11px] text-slate-600">{dependency?.employee.name ?? dependencyId}</span><button type="button" className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-white hover:text-rose-500" onClick={() => onRemoveDependency(dependencyId)} aria-label="移除依赖"><Unlink className="h-3 w-3" /></button></div>; })}</div> : <p className="mt-2 text-[11px] leading-5 text-slate-500">当前节点从任务输入直接开始。</p>}</div>
        <div className="mt-4"><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">实时动作</p><div className="mt-2 space-y-2">{toolCalls.length > 0 ? toolCalls.slice(-3).map((tool, index) => <p key={`${tool.name}-${index}`} className="flex gap-2 text-[11px] leading-5 text-slate-600"><span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', tool.status === 'running' ? 'animate-pulse bg-primary' : 'bg-emerald-500')} />{tool.status === 'running' ? '正在调用' : '已完成'} {tool.name}</p>) : <p className="text-[11px] leading-5 text-slate-500">{step.status === 'queued' ? '确认计划后开始调用员工。' : liveReasoning || '暂无新的执行事件。'}</p>}</div></div>
        <div className="mt-4 rounded-xl border border-slate-200 px-3 py-3"><div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">步骤结果</p><span className="text-[10px] text-slate-400">预计 {Math.ceil(step.estimatedSeconds / 60)} 分钟</span></div>{(step.status === 'running' ? liveOutput : step.output) ? <div className="markdown-body mt-2 max-h-40 overflow-y-auto text-xs leading-5"><Markdown content={step.status === 'running' ? liveOutput : step.output ?? ''} /></div> : <p className="mt-2 text-[11px] leading-5 text-slate-500">执行完成后，结果会显示在这里。</p>}</div>
        <div className="mt-4 border-l-2 border-primary/40 bg-primary/[0.035] px-3 py-2.5"><p className="text-[10px] font-semibold text-slate-700">选择依据</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{step.rationale}</p></div>
      </div>
      <div className="border-t border-slate-200 p-3">{plan.status === 'awaiting_confirmation' && <Button className="w-full" onClick={onConfirm} disabled={running}><Play className="h-4 w-4" />确认并执行</Button>}{plan.status === 'running' && <Button className="w-full" variant="secondary" onClick={onStop}><Square className="h-3.5 w-3.5 fill-current" />停止执行</Button>}{plan.status === 'failed' && step.status === 'failed' && <Button className="w-full" onClick={() => onRetry(step)} disabled={running}><RotateCcw className="h-4 w-4" />重试当前节点</Button>}{plan.status === 'completed' && <p className="text-center text-[11px] text-emerald-600">任务已完成，交付物已就绪</p>}</div>
    </aside>
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
    <div className="grid h-full min-h-0 content-start grid-cols-2 gap-3 px-1 sm:grid-cols-4">
      {phases.map((phase, index) => {
        const Icon = phase.icon;
        const active = planning && index <= 2;
        return (
          <div key={phase.label} className="relative">
            <div className={cn(
              'flex h-full min-h-[6.5rem] flex-col items-start gap-2 rounded-xl border bg-white p-3.5',
              active ? 'border-slate-950 bg-slate-950 text-white shadow-sm' : 'border-slate-200',
            )}>
              <div className="flex w-full items-center justify-between">
                <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500', active && 'bg-white/10 text-white')}>
                  {active && index === 2 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                </span>
                <span className={cn('text-[10px] font-semibold', active ? 'text-white/60' : 'text-slate-300')}>0{index + 1}</span>
              </div>
              <div className="min-w-0">
                <p className={cn('text-xs font-semibold', active ? 'text-white' : 'text-slate-800')}>{phase.label}</p>
                <p className={cn('mt-1 truncate text-[10px]', active ? 'text-white/60' : 'text-slate-400')}>{phase.detail}</p>
              </div>
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
  running: boolean;
  liveOutput: string;
  liveReasoning: string;
  toolCalls: LiveToolCall[];
  onConfirm: () => void;
  onStop: () => void;
  onRetry: (step: TaskPlanStep) => void;
  availableEmployees: TaskCandidateEmployee[];
  onAddNode: () => void;
  onMoveStep: (sourceStepId: string, targetStepId: string) => void;
  onConnectSteps: (sourceStepId: string, targetStepId: string) => void;
  onRemoveDependency: (stepId: string, dependencyId: string) => void;
  onReplaceStep: (stepId: string, employeeId: string) => void;
  onClearSelection: () => void;
}

export function TaskFlowCanvas({ plan, planning, selectedStepId, onSelectStep, running, liveOutput, liveReasoning, toolCalls, onConfirm, onStop, onRetry, availableEmployees, onAddNode, onMoveStep, onConnectSteps, onRemoveDependency, onReplaceStep, onClearSelection }: TaskFlowCanvasProps) {
  const [connectingFromId, setConnectingFromId] = useState<string>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | undefined>(undefined);
  const didDragRef = useRef(false);
  if (!plan) return <EmptyFlow planning={planning} />;

  const selectedStep = plan.steps.find((step) => step.id === selectedStepId);
  const orderedSteps = [...plan.steps].sort((left, right) => left.order - right.order);
  const nodePositions = orderedSteps.reduce<Record<string, { x: number; y: number }>>((result, step, index) => {
    result[step.id] = positions[step.id] ?? { x: 250 + (index % 3) * 245, y: 92 + Math.floor(index / 3) * 165 };
    return result;
  }, {});
  const positionFor = (id: string) => nodePositions[id] ?? { x: 250, y: 92 };
  const canvasWidth = Math.max(980, 560 + Math.ceil(orderedSteps.length / 3) * 245);
  const canvasHeight = Math.max(510, 185 + Math.ceil(orderedSteps.length / 3) * 165);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, stepId: string) => {
    if (running || event.button !== 0 || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const current = positionFor(stepId);
    dragRef.current = { id: stepId, offsetX: event.clientX - rect.left - current.x, offsetY: event.clientY - rect.top - current.y };
    didDragRef.current = false;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const nextX = Math.max(190, Math.min(canvasWidth - 230, event.clientX - rect.left - drag.offsetX));
    const nextY = Math.max(42, Math.min(canvasHeight - 145, event.clientY - rect.top - drag.offsetY));
    if (Math.abs(nextX - positionFor(drag.id).x) > 2 || Math.abs(nextY - positionFor(drag.id).y) > 2) didDragRef.current = true;
    const id = drag.id;
    setPositions((current) => ({ ...current, [id]: { x: nextX, y: nextY } }));
  };

  const handlePointerUp = () => {
    dragRef.current = undefined;
  };

  return (
    <div className="relative h-full min-h-[520px] overflow-hidden border-y border-slate-200 bg-[#f8f9fb]">
      <div className="absolute inset-x-0 top-0 z-20 flex min-h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><MousePointer2 className="h-4 w-4" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-950">{plan.summary}</p><p className="truncate text-[10px] text-slate-500">自由画布 · 点击节点查看员工状态</p></div></div>
        <div className="flex shrink-0 items-center gap-2"><CanvasToolbar plan={plan} canEdit={!running && plan.status !== 'completed'} onAddNode={onAddNode} /><span className="hidden items-center gap-1 text-[10px] text-slate-400 sm:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{plan.steps.length} 个节点</span></div>
      </div>
      {connectingFromId && <div className="absolute left-4 top-[4.5rem] z-20 flex items-center gap-3 rounded-xl border border-primary/20 bg-white px-3 py-2 text-[11px] text-primary shadow-sm"><GitBranch className="h-3.5 w-3.5" />选择一个下游节点建立依赖<button type="button" className="text-primary/70 hover:text-primary" onClick={() => setConnectingFromId(undefined)}>取消</button></div>}
      <div ref={canvasRef} className="absolute inset-0 overflow-auto pt-14 [background-image:radial-gradient(#d9dee8_1px,transparent_1px)] [background-size:18px_18px]" onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!running && event.dataTransfer.getData('application/x-sep-node') === 'employee') onAddNode(); }}>
        <div className="relative" style={{ width: canvasWidth, height: canvasHeight }}>
          <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
            {orderedSteps.flatMap((step) => step.dependsOn.map((dependencyId) => { const source = positionFor(dependencyId); const target = positionFor(step.id); return <path key={dependencyId + '-' + step.id} d={'M ' + (source.x + 190) + ' ' + (source.y + 72) + ' C ' + (source.x + 225) + ' ' + (source.y + 72) + ', ' + (target.x - 35) + ' ' + (target.y + 72) + ', ' + target.x + ' ' + (target.y + 72)} fill="none" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="5 5" />; }))}
          </svg>
          <div className="absolute left-5 top-1/2 w-40 -translate-y-1/2"><FlowEndpoint type="input" plan={plan} /></div>
          <ArrowRight className="absolute left-[12.5rem] top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          {orderedSteps.map((step) => { const position = positionFor(step.id); return <div key={step.id} className="absolute w-[190px]" style={{ left: position.x, top: position.y }}><PlanStepNode step={step} selected={selectedStepId === step.id} connecting={connectingFromId === step.id} onPointerDown={(event) => handlePointerDown(event, step.id)} onSelect={() => { if (didDragRef.current) { didDragRef.current = false; return; } if (connectingFromId && connectingFromId !== step.id) { onConnectSteps(connectingFromId, step.id); setConnectingFromId(undefined); } else onSelectStep(step); }} onStartConnect={() => { if (!running) setConnectingFromId((current) => current === step.id ? undefined : step.id); }} /></div>; })}
          <ArrowRight className="absolute right-[12.5rem] top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <div className="absolute right-5 top-1/2 w-40 -translate-y-1/2"><FlowEndpoint type="output" plan={plan} /></div>
        </div>
      </div>
      {selectedStep && <StepInspectorPanel plan={plan} step={selectedStep} running={running} liveOutput={liveOutput} liveReasoning={liveReasoning} toolCalls={toolCalls} onConfirm={onConfirm} onStop={onStop} onRetry={onRetry} availableEmployees={availableEmployees} onReplace={(employeeId) => onReplaceStep(selectedStep.id, employeeId)} onRemoveDependency={(dependencyId) => onRemoveDependency(selectedStep.id, dependencyId)} onClose={onClearSelection} />}
    </div>
  );
}
