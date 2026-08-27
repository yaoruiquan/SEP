import type { TaskPlan, TaskPlanStep, TaskRunStatus } from './task-orchestration';

/**
 * 服务端持久化的任务运行。
 *
 * 重构前任务和模板存在 localStorage（`sep-task-plans` / `sep-task-templates`），
 * 换浏览器或清缓存就全丢，也没法跨设备。契约见
 * docs/plans/2026-08-27-task-center-api-contract.md。
 */

export interface GraphLayoutPayload {
  nodes: Record<string, { x: number; y: number }>;
  endpoints?: Partial<Record<'input' | 'output', { x: number; y: number }>>;
}

export interface TaskRunSummary {
  id: string;
  objective: string;
  status: TaskRunStatus;
  stepCount: number;
  completedStepCount: number;
  employeeNames: string[];
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 仅 scope=enterprise 时返回 */
  owner?: { id: string; name: string | null };
}

export interface TaskRun extends TaskRunSummary {
  summary: string;
  steps: TaskPlanStep[];
  layout: GraphLayoutPayload | null;
  planner: { type: 'llm'; model: string } | null;
}

export interface TaskRunListResponse {
  items: TaskRunSummary[];
  nextCursor: string | null;
}

export type TaskEventType =
  | 'RUN_CREATED' | 'RUN_STARTED' | 'RUN_COMPLETED' | 'RUN_FAILED' | 'RUN_STOPPED'
  | 'STEP_STARTED' | 'STEP_COMPLETED' | 'STEP_FAILED' | 'STEP_SKIPPED'
  | 'STEP_PAUSED' | 'STEP_RESUMED' | 'PLAN_EDITED';

export interface TaskRunEvent {
  id: string;
  taskRunId: string;
  type: TaskEventType;
  stepId: string | null;
  stepTitle: string | null;
  employeeName: string | null;
  message: string | null;
  createdAt: string;
}

export interface TaskTemplate {
  id: string;
  name: string;
  objective: string;
  steps: TaskPlanStep[];
  layout: GraphLayoutPayload | null;
  createdAt: string;
  updatedAt: string;
}

/** 服务端记录 → 前端执行用的 TaskPlan */
export function toPlan(run: TaskRun): TaskPlan {
  return {
    id: run.id,
    objective: run.objective,
    summary: run.summary,
    steps: run.steps,
    status: run.status,
    createdAt: run.createdAt,
    planner: run.planner ?? undefined,
  };
}

/** 清空运行痕迹，用于存模板和从模板载入 */
export function resetSteps(steps: TaskPlanStep[]): TaskPlanStep[] {
  return steps.map((step, index) => ({
    ...step,
    order: index + 1,
    status: 'queued',
    progress: 0,
    output: undefined,
    error: undefined,
    startedAt: undefined,
    completedAt: undefined,
    durationMs: undefined,
  }));
}

/** 执行中断留下的孤儿运行：还挂在 running，但已经很久没动静 */
const ORPHAN_AFTER_MS = 10 * 60 * 1000;

export function isOrphanRun(run: Pick<TaskRunSummary, 'status' | 'updatedAt'>): boolean {
  if (run.status !== 'running') return false;
  return Date.now() - new Date(run.updatedAt).getTime() > ORPHAN_AFTER_MS;
}
