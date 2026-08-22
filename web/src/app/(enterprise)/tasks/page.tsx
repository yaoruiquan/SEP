'use client';

import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Plus, Play, RotateCcw, Sparkles, StopCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/feedback';
import { LaunchTaskDialog } from '@/features/task/launch-task-dialog';
import { TaskRunTimeline } from '@/features/task/task-run-timeline';
import { TaskRunOutput } from '@/features/task/task-run-output';
import { useChatStream } from '@/features/chat/use-chat-stream';
import { useConversations, useCreateConversation } from '@/features/chat/use-conversations';
import { useTaskUpdates } from '@/hooks/use-realtime';
import type { ConversationSession } from '@/lib/types';
import type { TaskPlan, TaskPlanStep } from '@/features/task/task-orchestration';

type HistoryTask = ConversationSession & { employee?: { id: string; name: string; avatar: string | null }; _count?: { messages?: number } };

function HistoryCard({ conversation }: { conversation: HistoryTask }) {
  return <div className="flex w-full items-center gap-3 rounded-xl border border-border bg-background p-3"><Avatar name={conversation.employee?.name ?? '硅基员工'} src={conversation.employee?.avatar} className="h-9 w-9 text-xs" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{conversation.title || '未命名会话'}</p><p className="mt-1 text-xs text-fg-muted">{conversation.employee?.name ?? '硅基员工'} · {conversation._count?.messages ?? 0} 条消息</p></div><Badge variant="glass" className="shrink-0 text-[11px]">历史执行</Badge></div>;
}

function clonePlan(plan: TaskPlan): TaskPlan { return { ...plan, status: 'running', steps: plan.steps.map((step) => ({ ...step })) }; }

export default function TasksPage() {
  const { data: conversations = [], isLoading } = useConversations();
  const createConversation = useCreateConversation();
  const { isConnected } = useTaskUpdates();
  const { state: stream, send, stop, reset } = useChatStream();
  const [launchOpen, setLaunchOpen] = useState(false);
  const [plan, setPlan] = useState<TaskPlan | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string>();
  const [finalOutput, setFinalOutput] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);
  const stopRequested = useRef(false);

  const currentStep = plan?.steps.find((step) => step.id === selectedStepId) ?? plan?.steps.find((step) => step.status === 'running') ?? plan?.steps.at(-1);
  const completedCount = plan?.steps.filter((step) => step.status === 'completed').length ?? 0;
  const progress = plan && plan.steps.length > 0 ? Math.round((completedCount / plan.steps.length) * 100) : 0;
  const recentConversations = useMemo(() => (conversations as HistoryTask[]).slice(0, 8), [conversations]);

  const updateStep = (stepId: string, update: Partial<TaskPlanStep>) => setPlan((current) => current ? ({ ...current, steps: current.steps.map((step) => step.id === stepId ? { ...step, ...update } : step) }) : current);

  const executePlan = async (confirmedPlan: TaskPlan) => {
    setIsLaunching(true); stopRequested.current = false; setFinalOutput(''); reset();
    const runningPlan = clonePlan(confirmedPlan);
    setPlan(runningPlan); setSelectedStepId(runningPlan.steps[0]?.id); setLaunchOpen(false);
    let previousOutput = '';
    for (const step of runningPlan.steps) {
      if (stopRequested.current) break;
      setSelectedStepId(step.id); updateStep(step.id, { status: 'running', progress: 10, startedAt: new Date().toISOString() });
      try {
        const conversation = await createConversation.mutateAsync({ employeeId: step.employee.id, title: confirmedPlan.objective.slice(0, 60) });
        const prompt = [`这是一个多步骤任务。总目标：${confirmedPlan.objective}`, `当前步骤：${step.title}。${step.description}`, previousOutput ? `前序步骤输出：\n${previousOutput}` : '', '请只完成当前步骤，并返回可供下一步骤使用的清晰结果。'].filter(Boolean).join('\n\n');
        const startedAt = Date.now();
        const outcome = await send(conversation.id, prompt, undefined, (info) => {
          const output = info.text?.trim() ?? ''; previousOutput = output;
          updateStep(step.id, { status: 'completed', progress: 100, output, completedAt: new Date().toISOString(), durationMs: Date.now() - startedAt }); setFinalOutput(output);
        });
        if (outcome !== 'ok') throw new Error('执行被中断');
      } catch (error) {
        if (stopRequested.current) {
          setPlan((current) => current ? { ...current, status: 'stopped' } : current);
          setIsLaunching(false);
          return;
        }
        updateStep(step.id, { status: 'failed', progress: 100, error: error instanceof Error ? error.message : '执行失败' }); setPlan((current) => current ? { ...current, status: 'failed' } : current); setIsLaunching(false); return;
      }
    }
    setPlan((current) => current ? { ...current, status: stopRequested.current ? 'stopped' : 'completed' } : current); setIsLaunching(false);
  };

  return <div className="flex h-full min-h-0 flex-col bg-neutral-50/50">
    <div className="shrink-0 border-b border-neutral-200 bg-white px-6 py-5"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4"><div><div className="flex items-center gap-3"><h1 className="text-2xl font-semibold text-neutral-900">任务编排中心</h1><Badge variant="glass" className="gap-1 text-xs"><span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-success' : 'bg-fg-subtle'}`} />{isConnected ? '实时同步' : '离线缓存'}</Badge></div><p className="mt-1 text-sm text-neutral-600">描述目标，确认计划，观察多个硅基员工协同完成任务</p></div><Button onClick={() => setLaunchOpen(true)}><Plus className="mr-1.5 h-4 w-4" />发起编排任务</Button></div></div>
    <div className="min-h-0 flex-1 overflow-y-auto p-6"><div className="mx-auto grid max-w-7xl gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-foreground">最近任务</h2><span className="text-xs text-fg-subtle">{recentConversations.length} 条历史</span></div>{isLoading ? <div className="rounded-xl border border-border bg-background p-5 text-sm text-fg-muted">正在加载历史任务…</div> : recentConversations.length === 0 ? <Card className="p-5"><EmptyState title="还没有历史任务" description="发起一个编排任务，执行过程会显示在这里。" /></Card> : recentConversations.map((conversation) => <HistoryCard key={conversation.id} conversation={conversation} />)}</aside>
      <main className="min-w-0">{!plan ? <div className="flex min-h-[560px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-white px-8 text-center"><div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Sparkles className="h-7 w-7" /></div><h2 className="text-xl font-semibold text-foreground">把目标交给任务编排器</h2><p className="mt-2 max-w-md text-sm leading-6 text-fg-muted">系统会分析你已订阅的硅基员工，先生成一份可检查的执行计划，再按步骤展示每位员工的工作进度。</p><Button className="mt-6" onClick={() => setLaunchOpen(true)}><Play className="mr-1.5 h-4 w-4" />创建第一个任务</Button></div> : <div className="space-y-5"><div className="rounded-2xl border border-border bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate text-lg font-semibold text-foreground">{plan.objective}</h2><Badge variant={plan.status === 'completed' ? 'default' : plan.status === 'failed' ? 'glass-danger' : 'glass-info'}>{plan.status === 'running' ? '执行中' : plan.status === 'completed' ? '已完成' : plan.status === 'failed' ? '执行失败' : plan.status === 'stopped' ? '已停止' : '计划中'}</Badge></div><p className="mt-1 text-sm text-fg-muted">{plan.summary}</p></div><div className="flex shrink-0 gap-2">{isLaunching && <Button size="sm" variant="secondary" onClick={() => { stopRequested.current = true; stop(); }}><StopCircle className="mr-1.5 h-4 w-4" />停止</Button>}{plan.status === 'completed' && <Button size="sm" variant="secondary" onClick={() => executePlan(plan)}><RotateCcw className="mr-1.5 h-4 w-4" />重新执行</Button>}</div></div><div className="mt-5 flex items-center gap-3"><div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div><span className="text-xs font-medium text-fg-muted">{completedCount}/{plan.steps.length} 步骤</span></div></div><div className="grid gap-5 lg:grid-cols-[minmax(300px,0.75fr)_minmax(0,1.25fr)]"><Card className="p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-foreground">执行流程</h3><span className="text-xs text-fg-subtle">按依赖顺序</span></div><TaskRunTimeline steps={plan.steps} activeStepId={selectedStepId} onSelect={(step) => setSelectedStepId(step.id)} /></Card><div className="space-y-4"><Card className="p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-foreground">实时工作台</h3>{currentStep?.status === 'running' && <span className="inline-flex items-center gap-1.5 text-xs text-primary"><Loader2 className="h-3.5 w-3.5 animate-spin" />{currentStep.employee.name} 正在工作</span>}</div><TaskRunOutput step={currentStep} finalOutput={plan.status === 'completed' ? finalOutput : undefined} /></Card>{stream.toolCalls.length > 0 && <Card className="p-4"><h3 className="mb-3 text-sm font-semibold text-foreground">技能调用记录</h3><div className="space-y-2">{stream.toolCalls.map((tool, index) => <div key={`${tool.name}-${index}`} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs"><span>{tool.name}</span><span className={tool.success === false ? 'text-danger' : 'text-success'}>{tool.status === 'running' ? '调用中' : tool.success === false ? '失败' : '完成'}</span></div>)}</div></Card>}</div></div></div>}</main>
    </div></div>
    <LaunchTaskDialog open={launchOpen} creating={isLaunching} onClose={() => setLaunchOpen(false)} onCreate={executePlan} />
  </div>;
}
