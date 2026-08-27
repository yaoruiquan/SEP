'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, FolderOpen, History, Plus, Radio, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useChatStream } from '@/features/chat/use-chat-stream';
import { useCreateTaskConversation } from '@/features/chat/use-conversations';
import { TaskObjectiveComposer } from '@/features/task/task-objective-composer';
import { TaskWorkbench } from '@/features/task/components/task-workbench';
import { TaskDependencyGraph } from '@/features/task/components/task-dependency-graph';
import { TaskHistoryDrawer } from '@/features/task/components/task-history-drawer';
import { TaskTemplateDrawer } from '@/features/task/components/task-template-drawer';
import { TaskResultDialog } from '@/features/task/components/task-result-dialog';
import { useCreateTaskPlan } from '@/features/task/use-task-plan';
import {
  useCreateTaskRun,
  useCreateTaskTemplate,
  useDeleteTaskRun,
  useDeleteTaskTemplate,
  useReconcileTaskRun,
  useTaskRun,
  useTaskRuns,
  useTaskTemplates,
  useUpdateTaskRun,
  useUpdateTaskStep,
} from '@/features/task/use-task-runs';
import { resetSteps, toPlan, type GraphLayoutPayload, type TaskRunSummary, type TaskTemplate } from '@/features/task/task-run';
import { useMyEmployees } from '@/features/enterprise/use-enterprise';
import { useTaskUpdates } from '@/hooks/use-realtime';
import { cn } from '@/lib/utils';
import type { TaskCandidateEmployee, TaskPlan, TaskPlanStep } from '@/features/task/task-orchestration';
import type { MyEmployee } from '@/lib/types';

const VIEW_STORAGE_KEY = 'sep.tasks.view';

function toCandidateEmployee(item: MyEmployee): TaskCandidateEmployee {
  const capabilities = item.employee.bindings?.map((binding) => binding.capability) ?? [];
  return {
    id: item.employee.id,
    name: item.employee.name,
    avatar: item.employee.avatar,
    description: capabilities.map((capability) => capability.description).filter(Boolean).join('；'),
    // MyEmployee 的 employee 投影里没有 position/industry，保持空串（原实现亦然）
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
      return { ...step, status: 'queued', progress: 0, output: undefined, error: undefined, startedAt: undefined, completedAt: undefined, durationMs: undefined };
    }),
  };
}

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

export default function TasksPage() {
  const runsQuery = useTaskRuns({ limit: 50 });
  const templatesQuery = useTaskTemplates();
  const createRun = useCreateTaskRun();
  const updateRun = useUpdateTaskRun();
  const patchStep = useUpdateTaskStep();
  const deleteRun = useDeleteTaskRun();
  const reconcileRun = useReconcileTaskRun();
  const createTemplate = useCreateTaskTemplate();
  const deleteTemplate = useDeleteTaskTemplate();
  const planner = useCreateTaskPlan();
  const createTaskConversation = useCreateTaskConversation();
  const { data: myEmployees = [] } = useMyEmployees();
  const { isConnected } = useTaskUpdates();
  const { state: stream, send, stop, reset } = useChatStream();

  const [objective, setObjective] = useState('');
  const [plan, setPlan] = useState<TaskPlan | null>(null);
  const [layout, setLayout] = useState<GraphLayoutPayload | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string>();
  const [isExecuting, setIsExecuting] = useState(false);
  const [pausedStepIds, setPausedStepIds] = useState<string[]>([]);
  const [view, setView] = useState<'workbench' | 'graph'>('workbench');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [resultStepId, setResultStepId] = useState<string>();
  const [loadingRunId, setLoadingRunId] = useState<string>();

  const stopRequested = useRef(false);
  const pausedRef = useRef(new Set<string>());
  const layoutTimer = useRef<number | undefined>(undefined);

  const runs = runsQuery.data?.items ?? [];
  const loadedRun = useTaskRun(loadingRunId ?? '');

  const availableEmployees = useMemo(
    () => myEmployees.map(toCandidateEmployee).filter((employee) => employee.capabilities.length > 0),
    [myEmployees],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === 'workbench' || stored === 'graph') setView(stored);
  }, []);

  const changeView = (next: 'workbench' | 'graph') => {
    setView(next);
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  };

  // 点开历史记录里的某条 → 拉详情 → 载入为当前工作计划
  useEffect(() => {
    if (!loadingRunId || !loadedRun.data) return;
    const run = loadedRun.data;
    setPlan(toPlan(run));
    setLayout(run.layout);
    setObjective(run.objective);
    setSelectedStepId(
      run.steps.find((step) => step.status === 'running' || step.status === 'failed')?.id ?? run.steps[0]?.id,
    );
    setLoadingRunId(undefined);
    setHistoryOpen(false);
    reset();
  }, [loadedRun.data, loadingRunId, reset]);

  /** 本地立即改，同时把这一步落库（不 await，避免拖慢执行循环） */
  const applyStep = useCallback(
    (runId: string, stepId: string, patch: Partial<TaskPlanStep>, persist = true) => {
      setPlan((current) => {
        if (!current || current.id !== runId) return current;
        return { ...current, steps: current.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)) };
      });
      if (!persist) return;
      // 只带上真正有值的字段：DTO 是 strict 的，塞 null 会被 400 拒掉。
      // 清除旧的 error 不靠这里 —— executePlan 起步时会整份 PATCH steps，
      // clonePlanForExecution 已经把重跑范围内的 error 抹掉了。
      patchStep.mutate(
        {
          id: runId,
          stepId,
          ...(patch.status !== undefined && { status: patch.status }),
          ...(patch.progress !== undefined && { progress: patch.progress }),
          ...(patch.output !== undefined && { output: patch.output }),
          ...(patch.error !== undefined && { error: patch.error }),
          ...(patch.startedAt !== undefined && { startedAt: patch.startedAt }),
          ...(patch.completedAt !== undefined && { completedAt: patch.completedAt }),
          ...(patch.durationMs !== undefined && { durationMs: patch.durationMs }),
        },
        { onError: (error) => toast.error(errorMessage(error, '步骤状态没能保存')) },
      );
    },
    [patchStep],
  );

  /** 改计划结构（增删/连线/换人）→ 整份 steps 落库 */
  const applyPlanEdit = useCallback(
    (updater: (current: TaskPlan) => TaskPlan) => {
      setPlan((current) => {
        if (!current) return current;
        const next = updater(current);
        if (next === current) return current;
        updateRun.mutate(
          { id: next.id, steps: next.steps, status: next.status },
          { onError: (error) => toast.error(errorMessage(error, '计划改动没能保存')) },
        );
        return next;
      });
    },
    [updateRun],
  );

  const persistLayout = useCallback(
    (next: GraphLayoutPayload) => {
      setLayout(next);
      if (!plan) return;
      window.clearTimeout(layoutTimer.current);
      layoutTimer.current = window.setTimeout(() => {
        updateRun.mutate({ id: plan.id, layout: next });
      }, 800);
    },
    [plan, updateRun],
  );

  useEffect(() => () => window.clearTimeout(layoutTimer.current), []);

  const generatePlan = () => {
    planner.mutate(
      { objective },
      {
        onSuccess: (preview) => {
          createRun.mutate(
            {
              objective: preview.objective || objective,
              summary: preview.summary,
              steps: preview.steps,
              planner: preview.planner ?? null,
              status: 'awaiting_confirmation',
            },
            {
              onSuccess: (run) => {
                setPlan(toPlan(run));
                setLayout(run.layout);
                setSelectedStepId(undefined);
              },
              onError: (error) => toast.error(errorMessage(error, '计划没能保存')),
            },
          );
        },
      },
    );
  };

  const addEmployeeNode = useCallback(() => {
    if (!plan || isExecuting || plan.status === 'completed') return;
    const employee = availableEmployees[0];
    const capability = employee?.capabilities[0];
    if (!employee || !capability) return;
    const stepId = `manual-${Date.now()}`;
    applyPlanEdit((current) => {
      const ordered = [...current.steps].sort((left, right) => left.order - right.order);
      const previous = ordered[ordered.length - 1];
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
      return { ...current, status: 'awaiting_confirmation', steps: [...current.steps, nextStep] };
    });
    setSelectedStepId(stepId);
  }, [applyPlanEdit, availableEmployees, isExecuting, plan]);

  const connectSteps = useCallback(
    (sourceId: string, targetId: string) => {
      if (isExecuting || sourceId === targetId) return;
      applyPlanEdit((current) => {
        const source = current.steps.find((step) => step.id === sourceId);
        const target = current.steps.find((step) => step.id === targetId);
        if (!source || !target || source.order >= target.order || target.dependsOn.includes(sourceId)) return current;
        return {
          ...current,
          status: 'awaiting_confirmation',
          steps: current.steps.map((step) => (step.id === targetId ? { ...step, dependsOn: [...step.dependsOn, sourceId] } : step)),
        };
      });
    },
    [applyPlanEdit, isExecuting],
  );

  const removeDependency = useCallback(
    (stepId: string, dependencyId: string) => {
      if (isExecuting) return;
      applyPlanEdit((current) => ({
        ...current,
        status: 'awaiting_confirmation',
        steps: current.steps.map((step) =>
          step.id === stepId ? { ...step, dependsOn: step.dependsOn.filter((id) => id !== dependencyId) } : step,
        ),
      }));
    },
    [applyPlanEdit, isExecuting],
  );

  const replaceStepEmployee = useCallback(
    (stepId: string, employeeId: string) => {
      if (isExecuting) return;
      const employee = availableEmployees.find((candidate) => candidate.id === employeeId);
      if (!employee || employee.capabilities.length === 0) return;
      applyPlanEdit((current) => ({
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
    },
    [applyPlanEdit, availableEmployees, isExecuting],
  );

  const deleteStep = useCallback(
    (stepId: string) => {
      if (isExecuting) return;
      applyPlanEdit((current) => {
        const remaining = current.steps.filter((step) => step.id !== stepId).sort((left, right) => left.order - right.order);
        return {
          ...current,
          status: 'awaiting_confirmation',
          steps: remaining.map((step, index) => ({
            ...step,
            order: index + 1,
            dependsOn: step.dependsOn.filter((id) => id !== stepId),
          })),
        };
      });
      setSelectedStepId((current) => (current === stepId ? undefined : current));
    },
    [applyPlanEdit, isExecuting],
  );

  const waitForResume = (stepId: string) =>
    new Promise<void>((resolve) => {
      const poll = () => {
        if (stopRequested.current) return resolve();
        if (!pausedRef.current.has(stepId)) return resolve();
        window.setTimeout(poll, 180);
      };
      poll();
    });

  const executePlan = async (sourcePlan: TaskPlan, startIndex = 0) => {
    if (isExecuting) return;
    setIsExecuting(true);
    stopRequested.current = false;
    pausedRef.current.clear();
    setPausedStepIds([]);
    reset();

    const runningPlan = clonePlanForExecution(sourcePlan, startIndex);
    const outputs = new Map(
      runningPlan.steps.filter((step, index) => index < startIndex && step.output).map((step) => [step.id, step.output as string]),
    );
    setPlan(runningPlan);
    setSelectedStepId(runningPlan.steps[startIndex]?.id);
    updateRun.mutate({
      id: runningPlan.id,
      status: 'running',
      steps: runningPlan.steps,
      startedAt: new Date().toISOString(),
    });

    const finish = (status: TaskPlan['status']) => {
      setPlan((current) => (current?.id === runningPlan.id ? { ...current, status } : current));
      updateRun.mutate({
        id: runningPlan.id,
        status,
        completedAt: status === 'completed' ? new Date().toISOString() : null,
      });
    };

    try {
      for (let index = startIndex; index < runningPlan.steps.length; index += 1) {
        if (stopRequested.current) break;
        const step = runningPlan.steps[index];

        while (pausedRef.current.has(step.id) && !stopRequested.current) {
          applyStep(runningPlan.id, step.id, { status: 'queued', progress: 0 }, false);
          await waitForResume(step.id);
        }
        if (stopRequested.current) break;

        const startedAt = Date.now();
        setSelectedStepId(step.id);
        step.status = 'running';
        step.progress = 0;
        step.startedAt = new Date(startedAt).toISOString();
        applyStep(runningPlan.id, step.id, { status: 'running', progress: 0, startedAt: step.startedAt, error: undefined });

        const dependencyOutputs = step.dependsOn
          .map((dependencyId) => outputs.get(dependencyId))
          .filter((output): output is string => Boolean(output));

        try {
          const conversation = await createTaskConversation.mutateAsync({
            employeeId: step.employee.id,
            title: sourcePlan.objective.slice(0, 60),
            taskPlanId: runningPlan.id,
            taskStepId: step.id,
          });
          const prompt = [
            `这是一个经过用户确认的多步骤任务。总目标：${sourcePlan.objective}`,
            `当前步骤：${step.title}\n${step.description}`,
            dependencyOutputs.length > 0 ? `上游步骤输出：\n${dependencyOutputs.join('\n\n---\n\n')}` : '',
            '请只完成当前步骤，并返回可供后续步骤直接使用的清晰结果。',
          ]
            .filter(Boolean)
            .join('\n\n');

          let output = '';
          const outcome = await send(conversation.id, prompt, step.employee.id, (info) => {
            output = info.text?.trim() ?? '';
          });

          if (outcome === 'aborted' && pausedRef.current.has(step.id) && !stopRequested.current) {
            step.status = 'queued';
            step.progress = 0;
            applyStep(runningPlan.id, step.id, { status: 'queued', progress: 0 }, false);
            index -= 1;
            continue;
          }
          if (outcome !== 'ok') throw new Error(outcome === 'aborted' ? '执行已停止' : '执行连接中断');

          step.status = 'completed';
          step.progress = 100;
          step.output = output;
          step.completedAt = new Date().toISOString();
          step.durationMs = Date.now() - startedAt;
          outputs.set(step.id, output);
          applyStep(runningPlan.id, step.id, {
            status: 'completed',
            progress: 100,
            output,
            completedAt: step.completedAt,
            durationMs: step.durationMs,
          });
        } catch (error) {
          if (stopRequested.current) {
            finish('stopped');
            return;
          }
          const message = errorMessage(error, '执行失败');
          step.status = 'failed';
          step.error = message;
          applyStep(runningPlan.id, step.id, { status: 'failed', progress: 0, error: message });
          finish('failed');
          return;
        }
      }
      finish(stopRequested.current ? 'stopped' : 'completed');
    } finally {
      setIsExecuting(false);
    }
  };

  const stopExecution = () => {
    stopRequested.current = true;
    pausedRef.current.clear();
    setPausedStepIds([]);
    stop();
  };

  const togglePauseStep = (stepId: string) => {
    if (!isExecuting) return;
    const wasPaused = pausedRef.current.has(stepId);
    if (wasPaused) pausedRef.current.delete(stepId);
    else pausedRef.current.add(stepId);
    setPausedStepIds([...pausedRef.current]);
    if (!wasPaused && plan?.steps.find((step) => step.id === stepId)?.status === 'running') stop();
  };

  const retryStep = (step: TaskPlanStep) => {
    if (!plan) return;
    const index = plan.steps.findIndex((candidate) => candidate.id === step.id);
    if (index >= 0) void executePlan(plan, index);
  };

  const createNewTask = () => {
    if (isExecuting) return;
    setPlan(null);
    setLayout(null);
    setSelectedStepId(undefined);
    setObjective('');
    pausedRef.current.clear();
    setPausedStepIds([]);
    planner.reset();
    reset();
    setHistoryOpen(false);
  };

  const saveAsTemplate = () => {
    if (!plan) return;
    createTemplate.mutate(
      {
        name: plan.objective.slice(0, 32) || '未命名工作流',
        objective: plan.objective,
        steps: resetSteps(plan.steps),
        layout,
      },
      {
        onSuccess: () => {
          toast.success('已存为模板');
          setTemplateOpen(true);
        },
        onError: (error) => toast.error(errorMessage(error, '模板没能保存')),
      },
    );
  };

  const loadTemplate = (template: TaskTemplate) => {
    createRun.mutate(
      {
        objective: template.objective,
        steps: resetSteps(template.steps),
        layout: template.layout,
        status: 'awaiting_confirmation',
      },
      {
        onSuccess: (run) => {
          setPlan(toPlan(run));
          setLayout(run.layout);
          setObjective(run.objective);
          setSelectedStepId(undefined);
          setTemplateOpen(false);
        },
        onError: (error) => toast.error(errorMessage(error, '模板载入失败')),
      },
    );
  };

  const openResult = useCallback(() => {
    if (!plan) return;
    const last = [...plan.steps].reverse().find((step) => step.output);
    if (!last) return;
    setResultStepId(last.id);
    setResultOpen(true);
  }, [plan]);

  const removeRun = (run: TaskRunSummary) => {
    deleteRun.mutate(run.id, {
      onSuccess: () => {
        if (plan?.id === run.id) createNewTask();
      },
      onError: (error) => toast.error(errorMessage(error, '删除失败')),
    });
  };

  const currentStep = plan?.steps.find((step) => step.id === selectedStepId) ?? plan?.steps.find((step) => step.status === 'running');
  const liveOutput = currentStep?.status === 'running' ? stream.text : '';

  /** 从第一个还没完成的步骤开始跑；全部完成就从头重跑 */
  const confirmAndRun = () => {
    if (!plan) return;
    const ordered = [...plan.steps].sort((left, right) => left.order - right.order);
    const resumeIndex = ordered.findIndex((step) => step.status !== 'completed');
    void executePlan(plan, resumeIndex < 0 ? 0 : resumeIndex);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-gbg-canvas">
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-glassline bg-gbg-deep/45 px-4 backdrop-blur-glass-sm sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-glass-md border border-glassline-brand bg-gbrand/10 text-gbrand-text">
            <Workflow className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="truncate text-[15px] font-semibold text-gtext-primary">任务编排中心</h1>
              <span className="hidden items-center gap-1.5 border-l border-glassline pl-2.5 text-[10px] text-gtext-muted sm:flex">
                <Radio className={cn('h-3 w-3', isConnected ? 'text-gsuccess' : 'text-gtext-disabled')} />
                {isConnected ? '实时事件已连接' : '实时事件未连接'}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-gtext-muted">描述目标，我来安排员工完成并交付</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="glass" onClick={() => setHistoryOpen(true)}>
            <History className="h-4 w-4" />
            <span className="hidden sm:inline">任务记录</span>
            {runs.length > 0 && (
              <span className="grid h-4 min-w-4 place-items-center rounded-glass-pill bg-gbrand px-1 text-[9px] text-white">
                {runs.length}
              </span>
            )}
          </Button>
          <Button size="sm" variant="glass" onClick={() => setTemplateOpen(true)}>
            <FolderOpen className="h-4 w-4" />
            <span className="hidden sm:inline">模板</span>
          </Button>
          {plan && (
            <Button size="sm" variant="glass" onClick={saveAsTemplate} loading={createTemplate.isPending}>
              <Bookmark className="h-4 w-4" />
              <span className="hidden sm:inline">存为模板</span>
            </Button>
          )}
          <Button size="sm" variant="glass-primary" onClick={createNewTask} disabled={isExecuting || !plan}>
            <Plus className="h-4 w-4" />
            新建任务
          </Button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        {!plan ? (
          <TaskObjectiveComposer
            objective={objective}
            planning={planner.isPending || createRun.isPending}
            error={planner.error instanceof Error ? planner.error.message : undefined}
            employees={availableEmployees.slice(0, 4)}
            employeeCount={availableEmployees.length}
            onObjectiveChange={(value) => {
              setObjective(value);
              if (planner.error) planner.reset();
            }}
            onGenerate={generatePlan}
          />
        ) : view === 'workbench' ? (
          <TaskWorkbench
            plan={plan}
            running={isExecuting}
            pausedStepIds={pausedStepIds}
            selectedStepId={selectedStepId}
            liveOutput={liveOutput}
            liveReasoning={stream.reasoning}
            toolCalls={stream.toolCalls}
            availableEmployees={availableEmployees}
            view={view}
            onViewChange={changeView}
            onSelectStep={(step) => setSelectedStepId(step.id)}
            onClearSelection={() => setSelectedStepId(undefined)}
            onConfirm={confirmAndRun}
            onStop={stopExecution}
            onTogglePause={togglePauseStep}
            onRetry={retryStep}
            onDeleteStep={deleteStep}
            onReplaceStep={replaceStepEmployee}
            onRemoveDependency={removeDependency}
            onAddNode={addEmployeeNode}
            onViewOutput={openResult}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <TaskWorkbench
              plan={plan}
              running={isExecuting}
              pausedStepIds={pausedStepIds}
              selectedStepId={selectedStepId}
              liveOutput=""
              liveReasoning=""
              toolCalls={[]}
              availableEmployees={availableEmployees}
              view={view}
              onViewChange={changeView}
              onSelectStep={(step) => setSelectedStepId(step.id)}
              onClearSelection={() => setSelectedStepId(undefined)}
              onConfirm={confirmAndRun}
              onStop={stopExecution}
              onTogglePause={togglePauseStep}
              onRetry={retryStep}
              onDeleteStep={deleteStep}
              onReplaceStep={replaceStepEmployee}
              onRemoveDependency={removeDependency}
              onAddNode={addEmployeeNode}
              onViewOutput={openResult}
              headerOnly
            />
            <div className="min-h-0 flex-1">
              <TaskDependencyGraph
                plan={plan}
                layout={layout}
                running={isExecuting}
                pausedStepIds={pausedStepIds}
                selectedStepId={selectedStepId}
                onLayoutChange={persistLayout}
                onResetLayout={() => {
                  setLayout(null);
                  updateRun.mutate({ id: plan.id, layout: null });
                }}
                onSelectStep={(step) => setSelectedStepId(step.id)}
                onConnectSteps={connectSteps}
                onViewOutput={openResult}
              />
            </div>
          </div>
        )}
      </main>

      <TaskHistoryDrawer
        open={historyOpen}
        runs={runs}
        loading={runsQuery.isLoading}
        activeRunId={plan?.id}
        running={isExecuting}
        reconcilingId={reconcileRun.isPending ? reconcileRun.variables : undefined}
        onOpenChange={setHistoryOpen}
        onSelect={(run) => setLoadingRunId(run.id)}
        onDelete={removeRun}
        onReconcile={(run) => reconcileRun.mutate(run.id, { onError: (error) => toast.error(errorMessage(error, '回收失败')) })}
        onNew={createNewTask}
      />

      <TaskTemplateDrawer
        open={templateOpen}
        templates={templatesQuery.data ?? []}
        loading={templatesQuery.isLoading}
        busyId={createRun.isPending ? undefined : deleteTemplate.variables}
        onOpenChange={setTemplateOpen}
        onLoad={loadTemplate}
        onDelete={(template) => deleteTemplate.mutate(template.id, { onError: (error) => toast.error(errorMessage(error, '删除失败')) })}
      />

      {plan && (
        <TaskResultDialog plan={plan} open={resultOpen} initialStepId={resultStepId} onOpenChange={setResultOpen} />
      )}
    </div>
  );
}



