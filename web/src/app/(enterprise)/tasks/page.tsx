'use client';

import { useCallback, useRef, useState } from 'react';
import { Check, Circle, Clock3, Loader2, Plus, Radio, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatStream } from '@/features/chat/use-chat-stream';
import { useCreateConversation } from '@/features/chat/use-conversations';
import { TaskFlowCanvas } from '@/features/task/task-flow-canvas';
import { TaskListRail } from '@/features/task/task-list-rail';
import { TaskObjectiveComposer } from '@/features/task/task-objective-composer';
import { TaskStepInspector } from '@/features/task/task-step-inspector';
import { useCreateTaskPlan } from '@/features/task/use-task-plan';
import { useTaskUpdates } from '@/hooks/use-realtime';
import { cn } from '@/lib/utils';
import type { TaskPlan, TaskPlanStep } from '@/features/task/task-orchestration';

const PHASES = ['目标理解', '计划生成', '用户确认', '执行交付'];

function clonePlanForExecution(plan: TaskPlan, startIndex: number): TaskPlan {
  return {
    ...plan,
    status: 'running',
    steps: plan.steps.map((step, index) => {
      if (index < startIndex && step.status === 'completed') return { ...step };
      return {
        ...step,
        status: 'queued',
        progress: 0,
        output: undefined,
        error: undefined,
        startedAt: undefined,
        completedAt: undefined,
        durationMs: undefined,
      };
    }),
  };
}

function getPhaseIndex(plan: TaskPlan | null, planning: boolean) {
  if (planning) return 1;
  if (!plan) return 0;
  if (plan.status === 'awaiting_confirmation') return 2;
  return 3;
}

export default function TasksPage() {
  const createConversation = useCreateConversation();
  const planner = useCreateTaskPlan();
  const { isConnected } = useTaskUpdates();
  const { state: stream, send, stop, reset } = useChatStream();
  const [objective, setObjective] = useState('');
  const [tasks, setTasks] = useState<TaskPlan[]>([]);
  const [plan, setPlan] = useState<TaskPlan | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string>();
  const [isExecuting, setIsExecuting] = useState(false);
  const stopRequested = useRef(false);

  const storePlan = useCallback((next: TaskPlan) => {
    setPlan(next);
    setTasks((current) => {
      const exists = current.some((task) => task.id === next.id);
      return exists
        ? current.map((task) => task.id === next.id ? next : task)
        : [next, ...current];
    });
  }, []);

  const updateStoredPlan = useCallback((planId: string, updater: (current: TaskPlan) => TaskPlan) => {
    setPlan((current) => current?.id === planId ? updater(current) : current);
    setTasks((current) => current.map((task) => task.id === planId ? updater(task) : task));
  }, []);

  const updateStep = useCallback((planId: string, stepId: string, update: Partial<TaskPlanStep>) => {
    updateStoredPlan(planId, (current) => ({
      ...current,
      steps: current.steps.map((step) => step.id === stepId ? { ...step, ...update } : step),
    }));
  }, [updateStoredPlan]);

  const generatePlan = () => {
    planner.mutate(
      { objective },
      {
        onSuccess: (generatedPlan) => {
          storePlan(generatedPlan);
          setSelectedStepId(generatedPlan.steps[0]?.id);
        },
      },
    );
  };

  const executePlan = async (sourcePlan: TaskPlan, startIndex = 0) => {
    if (isExecuting) return;

    setIsExecuting(true);
    stopRequested.current = false;
    reset();

    const runningPlan = clonePlanForExecution(sourcePlan, startIndex);
    const outputs = new Map(
      runningPlan.steps
        .filter((step, index) => index < startIndex && step.output)
        .map((step) => [step.id, step.output as string]),
    );
    storePlan(runningPlan);
    setSelectedStepId(runningPlan.steps[startIndex]?.id);

    try {
      for (let index = startIndex; index < runningPlan.steps.length; index += 1) {
        if (stopRequested.current) break;

        const step = runningPlan.steps[index];
        const startedAt = Date.now();
        setSelectedStepId(step.id);
        step.status = 'running';
        step.progress = 0;
        step.startedAt = new Date(startedAt).toISOString();
        updateStep(runningPlan.id, step.id, {
          status: 'running',
          progress: 0,
          startedAt: step.startedAt,
          error: undefined,
        });

        const dependencyOutputs = step.dependsOn
          .map((dependencyId) => outputs.get(dependencyId))
          .filter((output): output is string => Boolean(output));

        try {
          const conversation = await createConversation.mutateAsync({
            employeeId: step.employee.id,
            title: sourcePlan.objective.slice(0, 60),
          });
          const prompt = [
            `这是一个经过用户确认的多步骤任务。总目标：${sourcePlan.objective}`,
            `当前步骤：${step.title}\n${step.description}`,
            dependencyOutputs.length > 0 ? `上游步骤输出：\n${dependencyOutputs.join('\n\n---\n\n')}` : '',
            '请只完成当前步骤，并返回可供后续步骤直接使用的清晰结果。',
          ].filter(Boolean).join('\n\n');

          let output = '';
          const outcome = await send(conversation.id, prompt, step.employee.id, (info) => {
            output = info.text?.trim() ?? '';
          });

          if (outcome !== 'ok') throw new Error(outcome === 'aborted' ? '执行已停止' : '执行连接中断');

          step.status = 'completed';
          step.progress = 100;
          step.output = output;
          step.completedAt = new Date().toISOString();
          step.durationMs = Date.now() - startedAt;
          outputs.set(step.id, output);
          updateStep(runningPlan.id, step.id, {
            status: 'completed',
            progress: 100,
            output,
            completedAt: step.completedAt,
            durationMs: step.durationMs,
          });
        } catch (error) {
          if (stopRequested.current) {
            updateStoredPlan(runningPlan.id, (current) => ({ ...current, status: 'stopped' }));
            return;
          }

          const message = error instanceof Error ? error.message : '执行失败';
          step.status = 'failed';
          step.error = message;
          updateStep(runningPlan.id, step.id, { status: 'failed', progress: 0, error: message });
          updateStoredPlan(runningPlan.id, (current) => ({ ...current, status: 'failed' }));
          return;
        }
      }

      updateStoredPlan(runningPlan.id, (current) => ({
        ...current,
        status: stopRequested.current ? 'stopped' : 'completed',
      }));
    } finally {
      setIsExecuting(false);
    }
  };

  const stopExecution = () => {
    stopRequested.current = true;
    stop();
  };

  const createNewTask = () => {
    if (isExecuting) return;
    setPlan(null);
    setSelectedStepId(undefined);
    setObjective('');
    planner.reset();
    reset();
  };

  const selectTask = (task: TaskPlan) => {
    if (isExecuting && task.id !== plan?.id) return;
    setPlan(task);
    setObjective(task.objective);
    setSelectedStepId(
      task.steps.find((step) => step.status === 'running' || step.status === 'failed')?.id
      ?? task.steps[0]?.id,
    );
    reset();
  };

  const retryStep = (step: TaskPlanStep) => {
    if (!plan) return;
    const stepIndex = plan.steps.findIndex((candidate) => candidate.id === step.id);
    if (stepIndex >= 0) void executePlan(plan, stepIndex);
  };

  const currentStep = plan?.steps.find((step) => step.id === selectedStepId)
    ?? plan?.steps.find((step) => step.status === 'running')
    ?? plan?.steps[0];
  const completedCount = plan?.steps.filter((step) => step.status === 'completed').length ?? 0;
  const phaseIndex = getPhaseIndex(plan, planner.isPending);
  const planProgress = plan?.steps.length ? (completedCount / plan.steps.length) * 100 : 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-50">
      <header className="shrink-0 border-b border-neutral-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="truncate text-lg font-semibold text-neutral-900">任务编排中心</h1>
              <span className="hidden items-center gap-1.5 rounded-sm border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] text-fg-muted sm:flex">
                <Radio className={cn('h-3 w-3', isConnected ? 'text-success' : 'text-fg-subtle')} />
                {isConnected ? '实时同步' : '离线缓存'}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-fg-muted">由规划模型选择员工与技能，确认后执行</p>
          </div>
          <Button size="sm" onClick={createNewTask} disabled={isExecuting || !plan}>
            <Plus className="h-4 w-4" />
            新建任务
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[240px_minmax(520px,1fr)_360px]">
        <div className="hidden min-h-0 xl:block">
          <TaskListRail tasks={tasks} activeTaskId={plan?.id} running={isExecuting} onSelect={selectTask} onNew={createNewTask} />
        </div>

        <main className="min-h-0 overflow-y-auto bg-neutral-50 scroll-thin">
          {!plan && (
            <TaskObjectiveComposer
              objective={objective}
              planning={planner.isPending}
              error={planner.error instanceof Error ? planner.error.message : undefined}
              onObjectiveChange={(value) => {
                setObjective(value);
                if (planner.error) planner.reset();
              }}
              onGenerate={generatePlan}
            />
          )}

          <div className="border-b border-border bg-white px-5 py-3 sm:px-7">
            <div className="mx-auto flex max-w-4xl items-center gap-1">
              {PHASES.map((phase, index) => {
                const completed = index < phaseIndex || (plan?.status === 'completed' && index === phaseIndex);
                const active = index === phaseIndex;
                return (
                  <div key={phase} className="flex min-w-0 flex-1 items-center">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
                        completed && 'border-primary bg-primary text-white',
                        active && !completed && 'border-primary text-primary',
                        !active && !completed && 'border-neutral-300 text-fg-subtle',
                      )}>
                        {completed ? <Check className="h-3 w-3" /> : active && planner.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Circle className="h-2.5 w-2.5" />}
                      </span>
                      <span className={cn('hidden truncate text-[11px] sm:block', active ? 'font-medium text-foreground' : 'text-fg-subtle')}>{phase}</span>
                    </div>
                    {index < PHASES.length - 1 && <span className={cn('mx-2 h-px min-w-3 flex-1 bg-neutral-200', index < phaseIndex && 'bg-primary/40')} />}
                  </div>
                );
              })}
            </div>
          </div>

          {plan && (
            <section className="border-b border-border bg-white px-5 py-4 sm:px-7">
              <div className="mx-auto max-w-4xl">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                      <h2 className="line-clamp-1 text-sm font-semibold text-foreground">{plan.summary}</h2>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-fg-muted">{plan.objective}</p>
                  </div>
                  {plan.planner && <span className="shrink-0 rounded-sm border border-neutral-200 bg-neutral-50 px-2 py-1 text-[10px] text-fg-subtle" title={plan.planner.model}>大模型规划</span>}
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
                    <div className="h-full bg-primary transition-all duration-500" style={{ width: `${planProgress}%` }} />
                  </div>
                  <span className="shrink-0 text-[11px] font-medium text-fg-muted">{completedCount}/{plan.steps.length} 步完成</span>
                  {plan.status === 'running' && currentStep && <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-info sm:flex"><Loader2 className="h-3 w-3 animate-spin" />{currentStep.employee.name}</span>}
                  {plan.status === 'awaiting_confirmation' && <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-warning sm:flex"><Clock3 className="h-3 w-3" />等待确认</span>}
                </div>
              </div>
            </section>
          )}

          <section className="px-4 py-5 sm:px-6">
            <div className="mx-auto max-w-4xl">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">执行流程</h2>
                  <p className="mt-0.5 text-[11px] text-fg-subtle">根据任务目标和员工能力动态生成</p>
                </div>
                {plan && <span className="text-[11px] text-fg-subtle">{plan.steps.length} 个步骤</span>}
              </div>
              <TaskFlowCanvas plan={plan} planning={planner.isPending} selectedStepId={selectedStepId} onSelectStep={(step) => setSelectedStepId(step.id)} />
            </div>
          </section>
        </main>

        <div className="min-h-0 border-t border-border lg:border-l lg:border-t-0">
          <TaskStepInspector
            plan={plan}
            step={currentStep}
            running={isExecuting}
            liveOutput={currentStep?.status === 'running' ? stream.text : ''}
            toolCalls={currentStep?.status === 'running' ? stream.toolCalls : []}
            onConfirm={() => plan && void executePlan(plan)}
            onStop={stopExecution}
            onRetry={retryStep}
          />
        </div>
      </div>
    </div>
  );
}
