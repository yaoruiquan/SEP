'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Expand,
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Markdown } from '@/features/chat/markdown';
import type { LiveToolCall } from '@/features/chat/use-chat-stream';
import { cn } from '@/lib/utils';
import type { TaskPlan, TaskPlanStep } from './task-orchestration';

type InspectorTab = 'work' | 'detail' | 'delivery';

function formatDuration(seconds: number) {
  return seconds >= 60 ? `${Math.ceil(seconds / 60)} 分钟` : `${seconds} 秒`;
}

function plainText(content: string) {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`\[\]()|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getStepStatus(step: TaskPlanStep) {
  if (step.status === 'running') return { label: '正在工作', detail: `正在使用 ${step.capability.name}`, tone: 'text-info', dot: 'bg-info' };
  if (step.status === 'completed') return { label: '工作完成', detail: '产出已提交到任务', tone: 'text-success', dot: 'bg-success' };
  if (step.status === 'failed') return { label: '工作受阻', detail: step.error ?? '需要重新执行当前步骤', tone: 'text-danger', dot: 'bg-danger' };
  return { label: '候场中', detail: '等待你的确认或上游交付', tone: 'text-warning', dot: 'bg-warning' };
}

function EmptyInspector({ planning }: { planning: boolean }) {
  return (
    <aside className="flex h-full min-h-0 flex-col bg-white">
      <div className="border-b border-border px-5 py-3.5">
        <h2 className="text-sm font-semibold text-foreground">硅基员工工作台</h2>
        <p className="mt-0.5 text-[11px] text-fg-subtle">员工状态会随真实执行事件更新</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <div className={cn(
          'relative flex h-24 w-24 items-center justify-center rounded-full border-2 bg-neutral-50',
          planning ? 'border-primary/40' : 'border-neutral-200',
        )}>
          {planning && <span className="absolute inset-1 animate-pulse rounded-full border border-primary/25" />}
          {planning ? <Loader2 className="h-9 w-9 animate-spin text-primary" /> : <Bot className="h-9 w-9 text-fg-subtle" />}
          <span className={cn('absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-white', planning ? 'bg-primary' : 'bg-neutral-300')} />
        </div>
        <h3 className="mt-5 text-base font-semibold text-foreground">{planning ? '正在组建硅基团队' : '员工席位等待任务'}</h3>
        <p className="mt-2 max-w-xs text-xs leading-5 text-fg-muted">
          {planning ? '规划模型正在分析目标、选择员工和技能。确认计划前不会开始工作。' : '提交任务目标后，这里会出现被选中的硅基员工和他的实时工作状态。'}
        </p>
        <div className="mt-6 grid w-full max-w-xs grid-cols-3 gap-2 text-[10px] text-fg-subtle">
          {['员工身份', '当前技能', '实时动作'].map((item) => <span key={item} className="border-t border-neutral-200 pt-2">{item}</span>)}
        </div>
      </div>
    </aside>
  );
}

interface TaskStepInspectorProps {
  plan: TaskPlan | null;
  step?: TaskPlanStep;
  planning?: boolean;
  running: boolean;
  liveOutput: string;
  liveReasoning?: string;
  toolCalls: LiveToolCall[];
  onConfirm: () => void;
  onStop: () => void;
  onRetry: (step: TaskPlanStep) => void;
}

export function TaskStepInspector({
  plan,
  step,
  planning = false,
  running,
  liveOutput,
  liveReasoning = '',
  toolCalls,
  onConfirm,
  onStop,
  onRetry,
}: TaskStepInspectorProps) {
  const [tab, setTab] = useState<InspectorTab>('work');
  const [reportOpen, setReportOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (plan?.status === 'completed') setTab('delivery');
    else if (plan?.status === 'running') setTab('work');
  }, [plan?.status]);

  if (!plan || !step) return <EmptyInspector planning={planning} />;

  const dependencies = step.dependsOn
    .map((dependencyId) => plan.steps.find((candidate) => candidate.id === dependencyId))
    .filter((dependency): dependency is TaskPlanStep => Boolean(dependency));
  const finalOutput = [...plan.steps].reverse().find((candidate) => candidate.output)?.output ?? '';
  const selectedOutput = step.status === 'running' ? liveOutput : step.output ?? '';
  const employeeSeats = (() => {
    const seen = new Set<string>();
    return plan.steps.filter((candidate) => {
      if (seen.has(candidate.employee.id)) return false;
      seen.add(candidate.employee.id);
      return true;
    });
  })();
  const status = getStepStatus(step);
  const recentActions = [
    ...toolCalls.slice(-2).map((tool) => ({
      label: `${tool.status === 'running' ? '正在调用' : '已完成'} ${tool.name}`,
      done: tool.status === 'done',
    })),
    ...(liveReasoning.trim() ? [{ label: plainText(liveReasoning).slice(-90), done: false }] : []),
    ...(liveOutput.trim() ? [{ label: `正在整理输出：${plainText(liveOutput).slice(-80)}`, done: false }] : []),
  ].slice(-3);

  const copyResult = async () => {
    if (!finalOutput) return;
    await navigator.clipboard.writeText(finalOutput);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <aside className="flex h-full min-h-0 flex-col bg-white">
        <div className="shrink-0 border-b border-border px-4 pt-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-foreground">硅基员工工作台</h2>
              <p className="mt-0.5 truncate text-[11px] text-fg-subtle">步骤 {step.order} · {step.title}</p>
            </div>
            <span className={cn('flex shrink-0 items-center gap-1.5 text-[11px] font-medium', status.tone)}>
              <span className={cn('h-2 w-2 rounded-full', status.dot, step.status === 'running' && 'animate-pulse')} />
              {status.label}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3">
            {([
              ['work', '工作状态'],
              ['detail', '步骤详情'],
              ['delivery', '最终交付'],
            ] as Array<[InspectorTab, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={cn(
                  'border-b-2 px-2 pb-2 text-[11px] transition',
                  tab === value ? 'border-primary font-semibold text-primary' : 'border-transparent text-fg-muted hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {tab === 'work' && (
            <div className="flex h-full min-h-0 flex-col">
              <section className="shrink-0 border-b border-border px-5 py-4">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    'relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 bg-neutral-50',
                    step.status === 'running' && 'border-primary',
                    step.status === 'completed' && 'border-success',
                    step.status === 'failed' && 'border-danger',
                    step.status === 'queued' && 'border-warning/50',
                  )}>
                    {step.status === 'running' && <span className="absolute -inset-1 animate-pulse rounded-full border border-primary/25" />}
                    <Avatar name={step.employee.name} src={step.employee.avatar} className="h-16 w-16 text-xl" />
                    <span className={cn('absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-white', status.dot)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-foreground">{step.employee.name}</p>
                    <p className="mt-1 truncate text-xs text-fg-muted">{step.employee.position}</p>
                    <p className={cn('mt-2 text-xs font-medium', status.tone)}>{status.detail}</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3 rounded-md bg-neutral-50 px-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2 text-xs text-fg-muted"><Zap className="h-3.5 w-3.5 shrink-0 text-primary" /><span className="truncate">{step.capability.name}</span></span>
                  <span className="shrink-0 text-[10px] text-fg-subtle">预计 {formatDuration(step.estimatedSeconds)}</span>
                </div>
              </section>

              <section className="min-h-0 flex-1 px-5 py-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-foreground">实时动作</h3>
                  {step.status === 'running' && <span className="text-[10px] text-info">事件流同步中</span>}
                </div>
                <div className="mt-3 space-y-3">
                  {recentActions.length > 0 ? recentActions.map((action, index) => (
                    <div key={`${action.label}-${index}`} className="flex gap-2.5">
                      <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', action.done ? 'bg-success' : 'bg-primary', !action.done && step.status === 'running' && 'animate-pulse')} />
                      <p className="line-clamp-2 text-[11px] leading-5 text-fg-muted">{action.label}</p>
                    </div>
                  )) : (
                    <div className="rounded-md border border-dashed border-neutral-200 px-3 py-4 text-center">
                      <p className="text-xs font-medium text-foreground">{step.status === 'queued' ? '员工已入选，等待开始' : step.status === 'completed' ? '当前步骤已完成' : '暂时没有执行事件'}</p>
                      <p className="mt-1 text-[10px] text-fg-subtle">{step.status === 'queued' ? '确认计划后才会调用员工与技能' : '新的技能调用会实时显示在这里'}</p>
                    </div>
                  )}
                </div>
              </section>

              <section className="shrink-0 border-t border-border px-5 py-3">
                <p className="mb-2 text-[10px] font-medium text-fg-subtle">执行团队</p>
                <div className="flex gap-2 overflow-hidden">
                  {employeeSeats.map((seat) => {
                    const active = seat.employee.id === step.employee.id;
                    return (
                      <div key={seat.employee.id} className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2 py-2', active ? 'border-primary/30 bg-primary/[0.03]' : 'border-neutral-200')}>
                        <Avatar name={seat.employee.name} src={seat.employee.avatar} className="h-7 w-7 shrink-0 text-[10px]" />
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-medium text-foreground">{seat.employee.name}</p>
                          <p className={cn('mt-0.5 truncate text-[9px]', active ? status.tone : 'text-fg-subtle')}>{active ? status.label : seat.status === 'completed' ? '已交付' : '候场'}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          )}

          {tab === 'detail' && (
            <div className="h-full px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Sparkles className="h-4 w-4" /></span>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-2 line-clamp-4 text-xs leading-5 text-fg-muted">{step.description}</p>
                </div>
              </div>
              <dl className="mt-5 space-y-3 border-t border-border pt-4 text-xs">
                <div className="flex gap-3"><dt className="flex w-20 shrink-0 items-center gap-1.5 text-fg-subtle"><Zap className="h-3.5 w-3.5" />技能</dt><dd className="font-medium text-foreground">{step.capability.name}</dd></div>
                <div className="flex gap-3"><dt className="flex w-20 shrink-0 items-center gap-1.5 text-fg-subtle"><Clock3 className="h-3.5 w-3.5" />预计耗时</dt><dd>{formatDuration(step.estimatedSeconds)}</dd></div>
                <div className="flex gap-3"><dt className="flex w-20 shrink-0 items-center gap-1.5 text-fg-subtle"><GitBranch className="h-3.5 w-3.5" />上游</dt><dd className="line-clamp-2 min-w-0">{dependencies.length > 0 ? dependencies.map((dependency) => dependency.title).join('、') : '无，可直接执行'}</dd></div>
              </dl>
              <div className="mt-5 border-l-2 border-primary bg-neutral-50 px-3 py-3">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground"><Bot className="h-3.5 w-3.5 text-primary" />模型选择依据</p>
                <p className="mt-1.5 line-clamp-5 text-[11px] leading-5 text-fg-muted">{step.rationale}</p>
              </div>
            </div>
          )}

          {tab === 'delivery' && (
            <div className="flex h-full min-h-0 flex-col px-5 py-4">
              {finalOutput ? (
                <>
                  <div className="flex items-start gap-3 border-b border-border pb-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-success/10 text-success"><FileOutput className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-medium text-success">硅基团队已交付</p>
                      <h3 className="mt-1 line-clamp-2 text-base font-semibold leading-6 text-foreground">{plan.objective}</h3>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 py-4">
                    <p className="text-xs font-semibold text-foreground">交付摘要</p>
                    <p className="mt-2 line-clamp-6 text-xs leading-6 text-fg-muted">{plainText(finalOutput)}</p>
                  </div>
                  <div className="grid shrink-0 grid-cols-2 gap-2">
                    <Button variant="secondary" size="sm" onClick={copyResult}>{copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}{copied ? '已复制' : '复制结果'}</Button>
                    <Button size="sm" onClick={() => setReportOpen(true)}><Expand className="h-4 w-4" />查看完整交付</Button>
                  </div>
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-md bg-neutral-100 text-fg-subtle"><FileOutput className="h-6 w-6" /></span>
                  <h3 className="mt-4 text-sm font-semibold text-foreground">等待最终交付</h3>
                  <p className="mt-2 max-w-xs text-xs leading-5 text-fg-muted">员工完成全部步骤后，这里只展示关键摘要；完整报告会在独立阅读视图中打开。</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border bg-white px-4 py-3">
          {plan.status === 'awaiting_confirmation' && (
            <Button className="w-full" onClick={onConfirm} disabled={running || plan.steps.length === 0}><Play className="h-4 w-4" />确认计划，启动硅基团队</Button>
          )}
          {plan.status === 'running' && (
            <Button className="w-full" variant="secondary" onClick={onStop}><Square className="h-3.5 w-3.5 fill-current" />停止执行</Button>
          )}
          {plan.status === 'failed' && step.status === 'failed' && (
            <Button className="w-full" onClick={() => onRetry(step)} disabled={running}><RotateCcw className="h-4 w-4" />从当前步骤重试</Button>
          )}
          {plan.status === 'completed' && <p className="text-center text-[11px] text-success"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />任务已完成，交付物已就绪</p>}
          {plan.status === 'stopped' && <p className="text-center text-[11px] text-fg-muted"><AlertCircle className="mr-1 inline h-3.5 w-3.5" />任务已停止</p>}
        </div>
      </aside>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="grid h-[86vh] max-w-4xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-6 py-5 pr-14">
            <DialogTitle>{plan.objective}</DialogTitle>
            <DialogDescription>硅基团队最终交付 · {plan.steps.length} 个步骤已完成</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-7 py-6 scroll-thin">
            <div className="markdown-body"><Markdown content={finalOutput} /></div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
