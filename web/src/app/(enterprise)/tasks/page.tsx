'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { History, Plus, Radio, X, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatStream } from '@/features/chat/use-chat-stream';
import { useCreateConversation } from '@/features/chat/use-conversations';
import { TaskFlowCanvas } from '@/features/task/task-flow-canvas';
import { TaskListRail } from '@/features/task/task-list-rail';
import { TaskObjectiveComposer } from '@/features/task/task-objective-composer';
import { useCreateTaskPlan } from '@/features/task/use-task-plan';
import { useMyEmployees } from '@/features/enterprise/use-enterprise';
import { useTaskUpdates } from '@/hooks/use-realtime';
import { cn } from '@/lib/utils';
import type { TaskCandidateEmployee, TaskPlan, TaskPlanStep } from '@/features/task/task-orchestration';
import type { MyEmployee } from '@/lib/types';

function toCandidateEmployee(item: MyEmployee): TaskCandidateEmployee {
  const capabilities = item.employee.bindings?.map((binding) => binding.capability) ?? [];
  return {
    id: item.employee.id,
    name: item.employee.name,
    avatar: item.employee.avatar,
    description: capabilities.map((capability) => capability.description).filter(Boolean).join('；'),
    position: '',
    industry: '',
    capabilities,
  };
}

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

export default function TasksPage() {
  const createConversation = useCreateConversation();
  const planner = useCreateTaskPlan();
  const { data: myEmployees = [] } = useMyEmployees();
  const { isConnected } = useTaskUpdates();
  const { state: stream, send, stop, reset } = useChatStream();
  const [objective, setObjective] = useState('');
  const [tasks, setTasks] = useState<TaskPlan[]>([]);
  const [plan, setPlan] = useState<TaskPlan | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string>();
  const [isExecuting, setIsExecuting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const stopRequested = useRef(false);
  const availableEmployees = useMemo(
    () => myEmployees.map(toCandidateEmployee).filter((employee) => employee.capabilities.length > 0),
    [myEmployees],
  );

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

  const addEmployeeNode = useCallback(() => {
    if (!plan || isExecuting || plan.status === 'completed' || availableEmployees.length === 0) return;
    const employee = availableEmployees[0];
    const capability = employee.capabilities[0];
    if (!capability) return;
    const stepId = `manual-${Date.now()}`;

    updateStoredPlan(plan.id, (current) => {
      const orderedSteps = [...current.steps].sort((left, right) => left.order - right.order);
      const previous = orderedSteps[orderedSteps.length - 1];
      const nextStep: TaskPlanStep = {
        id: stepId,
        order: current.steps.length + 1,
        title: `调用 ${employee.name}`,
        description: capability.description || `由${employee.name}使用${capability.name}完成这一步。`,
        intent: capability.name,
        employee,
        capability,
        dependsOn: previous ? [previous.id] : [],
        rationale: '由你手动加入工作流，默认接在当前最后一个节点之后。',
        estimatedSeconds: 60,
        status: 'queued',
        progress: 0,
      };
      return {
        ...current,
        status: 'awaiting_confirmation',
        steps: [...current.steps, nextStep],
      };
    });
    setSelectedStepId(stepId);
  }, [availableEmployees, isExecuting, plan, updateStoredPlan]);

  const moveStep = useCallback((sourceId: string, targetId: string) => {
    if (!plan || isExecuting || sourceId === targetId || plan.status === 'completed') return;
    updateStoredPlan(plan.id, (current) => {
      const steps = [...current.steps].sort((left, right) => left.order - right.order);
      const sourceIndex = steps.findIndex((step) => step.id === sourceId);
      const targetIndex = steps.findIndex((step) => step.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const [moved] = steps.splice(sourceIndex, 1);
      steps.splice(targetIndex, 0, moved);
      const orderById = new Map(steps.map((step, index) => [step.id, index]));
      return {
        ...current,
        status: 'awaiting_confirmation',
        steps: steps.map((step, index) => ({
          ...step,
          order: index + 1,
          dependsOn: step.dependsOn.filter((dependencyId) => (orderById.get(dependencyId) ?? index) < index),
        })),
      };
    });
  }, [isExecuting, plan, updateStoredPlan]);

  const connectSteps = useCallback((sourceId: string, targetId: string) => {
    if (!plan || isExecuting || sourceId === targetId || plan.status === 'completed') return;
    updateStoredPlan(plan.id, (current) => {
      const source = current.steps.find((step) => step.id === sourceId);
      const target = current.steps.find((step) => step.id === targetId);
      if (!source || !target || source.order >= target.order || target.dependsOn.includes(sourceId)) return current;
      return {
        ...current,
        status: 'awaiting_confirmation',
        steps: current.steps.map((step) => step.id === targetId ? { ...step, dependsOn: [...step.dependsOn, sourceId] } : step),
      };
    });
  }, [isExecuting, plan, updateStoredPlan]);

  const removeDependency = useCallback((stepId: string, dependencyId: string) => {
    if (!plan || isExecuting || plan.status === 'completed') return;
    updateStoredPlan(plan.id, (current) => ({
      ...current,
      status: 'awaiting_confirmation',
      steps: current.steps.map((step) => step.id === stepId ? { ...step, dependsOn: step.dependsOn.filter((id) => id !== dependencyId) } : step),
    }));
  }, [isExecuting, plan, updateStoredPlan]);

  const replaceStepEmployee = useCallback((stepId: string, employeeId: string) => {
    if (!plan || isExecuting || plan.status === 'completed') return;
    const employee = availableEmployees.find((candidate) => candidate.id === employeeId);
    if (!employee || employee.capabilities.length === 0) return;
    updateStoredPlan(plan.id, (current) => ({
      ...current,
      status: 'awaiting_confirmation',
      steps: current.steps.map((step) => {
        if (step.id !== stepId) return step;
        const capability = employee.capabilities.find((candidate) => candidate.id === step.capability.id) ?? employee.capabilities[0];
        return {
          ...step,
          title: step.title.replace(/^调用 .*$/, `调用 ${employee.name}`),
          employee,
          capability,
          description: capability.description || step.description,
          status: 'queued',
          progress: 0,
          output: undefined,
          error: undefined,
        };
      }),
    }));
  }, [availableEmployees, isExecuting, plan, updateStoredPlan]);

  const generatePlan = () => {
    planner.mutate(
      { objective },
      {
        onSuccess: (generatedPlan) => {
          storePlan(generatedPlan);
          setSelectedStepId(undefined);
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
    setHistoryOpen(false);
  };

  const retryStep = (step: TaskPlanStep) => {
    if (!plan) return;
    const stepIndex = plan.steps.findIndex((candidate) => candidate.id === step.id);
    if (stepIndex >= 0) void executePlan(plan, stepIndex);
  };

  const currentStep = plan?.steps.find((step) => step.id === selectedStepId)
    ?? plan?.steps.find((step) => step.status === 'running')
    ?? plan?.steps[0];
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#f7f8fa] text-slate-950">
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-200/80 bg-white px-4 sm:px-7">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Workflow className="h-4 w-4" /></span>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-slate-950">任务编排中心</h1>
                <span className="hidden items-center gap-1.5 border-l border-slate-200 pl-2 text-[10px] text-slate-500 sm:flex">
                  <Radio className={cn('h-3 w-3', isConnected ? 'text-emerald-500' : 'text-slate-400')} />
                  {isConnected ? '实时事件已连接' : '本地工作区'}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">输入任务，自动编排员工并完成交付</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setHistoryOpen(true)} className="relative border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
            <History className="h-4 w-4" />
            <span className="hidden sm:inline">任务记录</span>
            {tasks.length > 0 && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] text-white">{tasks.length}</span>}
          </Button>
          <Button size="sm" onClick={createNewTask} disabled={isExecuting || !plan}>
            <Plus className="h-4 w-4" />
            新建任务
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <main className="flex min-h-0 min-w-0 flex-col bg-[#f7f8fa]">
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

          {plan && <section className="min-h-0 flex-1 px-3 py-3 sm:px-5 lg:px-7">
            <div className="h-full min-h-0">
              <TaskFlowCanvas
                plan={plan}
                planning={planner.isPending}
                selectedStepId={selectedStepId}
                onSelectStep={(step) => setSelectedStepId(step.id)}
                running={isExecuting}
                liveOutput={currentStep?.status === 'running' ? stream.text : ''}
                liveReasoning={currentStep?.status === 'running' ? stream.reasoning : ''}
                toolCalls={currentStep?.status === 'running' ? stream.toolCalls : []}
                onConfirm={() => { if (plan) void executePlan(plan); }}
                onStop={stopExecution}
                onRetry={retryStep}
                availableEmployees={availableEmployees}
                onAddNode={addEmployeeNode}
                onMoveStep={moveStep}
                onConnectSteps={connectSteps}
                onRemoveDependency={removeDependency}
                onReplaceStep={replaceStepEmployee}
                onClearSelection={() => setSelectedStepId(undefined)}
              />
            </div>
          </section>}
        </main>
      </div>

      {historyOpen && (
        <div className="absolute inset-0 z-40 flex bg-neutral-900/20" onClick={() => setHistoryOpen(false)}>
          <div className="h-full w-72 bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex h-12 items-center justify-between border-b border-border px-4">
              <p className="text-sm font-semibold text-foreground">编排任务</p>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setHistoryOpen(false)} aria-label="关闭任务列表"><X className="h-4 w-4" /></Button>
            </div>
            <div className="h-[calc(100%_-_3rem)]"><TaskListRail tasks={tasks} activeTaskId={plan?.id} running={isExecuting} onSelect={selectTask} onNew={createNewTask} /></div>
          </div>
        </div>
      )}
    </div>
  );
}
