/**
 * 服务端执行引擎的前端契约。
 *
 * 与 `backend/src/shared/task.dto.ts` 的执行段一一对应。执行状态的权威在服务端，
 * 这里只有「看到的东西」——前端不再持有任何执行逻辑（旧实现是 tasks/page.tsx
 * 里的 executePlan 循环，关标签页任务就死）。
 */

import type { TaskRunStatus } from './task-orchestration';

export type TaskRunStepStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped' | 'paused';

/** 一条交接记录：某个上游步骤把产出交给了当前步骤 */
export interface TaskHandoffEntry {
  fromStepKey: string;
  fromStepTitle: string;
  fromEmployeeName: string;
  /** 摘要（前 400 字）。全文在上游步骤的 output 里 */
  excerpt: string;
  /** 完整字符数，让「交接了多少」可量化 */
  chars: number;
}

export interface TaskExecutionStep {
  stepKey: string;
  order: number;
  title: string;
  description: string;
  employee: { id: string; name: string; avatar: string | null };
  capability: { id: string; name: string };
  skillVersionId: string | null;
  dependsOn: string[];
  rationale: string;
  estimatedSeconds: number;
  status: TaskRunStepStatus;
  /** 会议要求的「输入」：真正送进模型的 prompt 全文 */
  inputPrompt: string | null;
  /** 会议要求的「交接内容」 */
  handoff: TaskHandoffEntry[];
  output: string | null;
  error: string | null;
  sessionId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  attempt: number;
}

export interface TaskExecutionSnapshot {
  id: string;
  objective: string;
  summary: string;
  status: TaskRunStatus;
  steps: TaskExecutionStep[];
  deliverable: string | null;
  deliverableGeneratedAt: string | null;
  deliverableDegraded: boolean;
  startedAt: string | null;
  completedAt: string | null;
  heartbeatAt: string | null;
  stopRequested: boolean;
  updatedAt: string;
}

export type TaskEventType =
  | 'RUN_CREATED' | 'RUN_STARTED' | 'RUN_COMPLETED' | 'RUN_FAILED' | 'RUN_STOPPED'
  | 'STEP_STARTED' | 'STEP_COMPLETED' | 'STEP_FAILED' | 'STEP_SKIPPED'
  | 'STEP_PAUSED' | 'STEP_RESUMED' | 'PLAN_EDITED'
  | 'STEP_HANDOFF' | 'DELIVERABLE_READY';

export interface TaskExecutionEvent {
  id: string;
  type: TaskEventType;
  stepId: string | null;
  stepTitle: string | null;
  employeeName: string | null;
  message: string | null;
  payload: unknown;
  createdAt: string;
}

export type TaskStreamFrame =
  | { type: 'snapshot'; snapshot: TaskExecutionSnapshot }
  | { type: 'run_status'; status: TaskRunStatus; startedAt: string | null; completedAt: string | null }
  | {
      type: 'step_status';
      stepKey: string;
      status: TaskRunStepStatus;
      startedAt?: string | null;
      completedAt?: string | null;
      durationMs?: number | null;
      error?: string | null;
      attempt?: number;
      sessionId?: string | null;
    }
  | { type: 'step_delta'; stepKey: string; delta: string }
  | { type: 'step_output'; stepKey: string; output: string }
  | { type: 'step_input'; stepKey: string; inputPrompt: string; handoff: TaskHandoffEntry[] }
  | { type: 'tool'; stepKey: string; name: string; phase: 'start' | 'end'; success?: boolean; durationMs?: number }
  | { type: 'event'; event: TaskExecutionEvent }
  | { type: 'deliverable'; deliverable: string; degraded: boolean; generatedAt: string }
  | { type: 'ping'; heartbeatAt: string | null };

/** 步骤上正在进行的工具调用，仅存在于内存（不落库，跑完即弃） */
export interface LiveStepTool {
  name: string;
  status: 'running' | 'done';
  success?: boolean;
  durationMs?: number;
}

export const TERMINAL_RUN_STATUSES: TaskRunStatus[] = ['completed', 'failed', 'stopped'];

export function isRunActive(status: TaskRunStatus): boolean {
  return status === 'running';
}

/** 心跳超过这个时长没更新，就在界面上提示「可能已失联」 */
const HEARTBEAT_STALE_MS = 70_000;

/**
 * worker 是否看起来还活着。
 *
 * 服务端有 cron 在 60s 内收口失联运行，但用户不该盯着一个「还在跑」的界面
 * 等一分钟才知道出事了 —— 心跳一旧就先如实说。
 */
export function isWorkerStale(snapshot: Pick<TaskExecutionSnapshot, 'status' | 'heartbeatAt'>): boolean {
  if (snapshot.status !== 'running') return false;
  if (!snapshot.heartbeatAt) return true;
  return Date.now() - new Date(snapshot.heartbeatAt).getTime() > HEARTBEAT_STALE_MS;
}
