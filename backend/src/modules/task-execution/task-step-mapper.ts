import { TASK_RUN_STATUS, TASK_STEP_STATUS, type Prisma, type TaskRun, type TaskRunStep } from '@prisma/client';
import type {
  TaskExecutionSnapshot,
  TaskHandoffEntry,
  TaskRunEventView,
  TaskRunStatus,
  TaskRunStepStatus,
  TaskRunStepView,
} from 'shared';

/**
 * DB 枚举（UPPER_SNAKE）与前端契约（小写）之间的唯一转换点。
 *
 * TaskService 里已经有一份 statusToDb/statusFromDb 字面量映射，但那份用 `any`
 * 且不含步骤状态。这里用 Record 约束住，漏一个值编译期就报错。
 */

export const RUN_STATUS_TO_DB: Record<TaskRunStatus, TASK_RUN_STATUS> = {
  draft: TASK_RUN_STATUS.DRAFT,
  awaiting_confirmation: TASK_RUN_STATUS.AWAITING_CONFIRMATION,
  running: TASK_RUN_STATUS.RUNNING,
  completed: TASK_RUN_STATUS.COMPLETED,
  failed: TASK_RUN_STATUS.FAILED,
  stopped: TASK_RUN_STATUS.STOPPED,
};

export const RUN_STATUS_FROM_DB: Record<TASK_RUN_STATUS, TaskRunStatus> = {
  DRAFT: 'draft',
  AWAITING_CONFIRMATION: 'awaiting_confirmation',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  STOPPED: 'stopped',
};

export const STEP_STATUS_TO_DB: Record<TaskRunStepStatus, TASK_STEP_STATUS> = {
  queued: TASK_STEP_STATUS.QUEUED,
  running: TASK_STEP_STATUS.RUNNING,
  completed: TASK_STEP_STATUS.COMPLETED,
  failed: TASK_STEP_STATUS.FAILED,
  skipped: TASK_STEP_STATUS.SKIPPED,
  paused: TASK_STEP_STATUS.PAUSED,
};

export const STEP_STATUS_FROM_DB: Record<TASK_STEP_STATUS, TaskRunStepStatus> = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  PAUSED: 'paused',
};

/** handoff 列是 Json，读回来要收窄成数组；脏数据一律当空处理而不是抛。 */
export function parseHandoff(value: Prisma.JsonValue | null): TaskHandoffEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is TaskHandoffEntry =>
      typeof entry === 'object' && entry !== null && 'fromStepKey' in entry,
  );
}

const iso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null;

export function serializeStep(step: TaskRunStep): TaskRunStepView {
  return {
    stepKey: step.stepKey,
    order: step.order,
    title: step.title,
    description: step.description,
    employee: { id: step.employeeId, name: step.employeeName, avatar: step.employeeAvatar },
    capability: { id: step.capabilityId, name: step.capabilityName },
    skillVersionId: step.skillVersionId,
    dependsOn: step.dependsOn,
    rationale: step.rationale,
    estimatedSeconds: step.estimatedSeconds,
    status: STEP_STATUS_FROM_DB[step.status],
    inputPrompt: step.inputPrompt,
    handoff: parseHandoff(step.handoff),
    output: step.output,
    error: step.error,
    sessionId: step.sessionId,
    startedAt: iso(step.startedAt),
    completedAt: iso(step.completedAt),
    durationMs: step.durationMs,
    attempt: step.attempt,
  };
}

export function serializeSnapshot(
  run: TaskRun,
  steps: TaskRunStep[],
): TaskExecutionSnapshot {
  return {
    id: run.id,
    objective: run.objective,
    summary: run.summary,
    status: RUN_STATUS_FROM_DB[run.status],
    steps: [...steps].sort((a, b) => a.order - b.order).map(serializeStep),
    deliverable: run.deliverable,
    deliverableGeneratedAt: iso(run.deliverableGeneratedAt),
    deliverableDegraded: run.deliverableDegraded,
    startedAt: iso(run.startedAt),
    completedAt: iso(run.completedAt),
    heartbeatAt: iso(run.heartbeatAt),
    stopRequested: run.stopRequestedAt !== null,
    updatedAt: run.updatedAt.toISOString(),
  };
}

export function serializeEvent(event: {
  id: string;
  type: TaskRunEventView['type'];
  stepId: string | null;
  stepTitle: string | null;
  employeeName: string | null;
  message: string | null;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
}): TaskRunEventView {
  return {
    id: event.id,
    type: event.type,
    stepId: event.stepId,
    stepTitle: event.stepTitle,
    employeeName: event.employeeName,
    message: event.message,
    payload: event.payload ?? null,
    createdAt: event.createdAt.toISOString(),
  };
}

/**
 * 从 TaskRun.steps 这个兼容读 JSON 快照里提取建 TaskRunStep 行所需的字段。
 *
 * 存量运行（迁移前创建）已由迁移回填；这里服务的是**新建但还没跑过**的运行 ——
 * 创建走的仍是 TaskService.create（写 JSON），第一次执行时才实体化成行。
 */
export interface PlanStepSeed {
  stepKey: string;
  order: number;
  title: string;
  description: string;
  employeeId: string;
  employeeName: string;
  employeeAvatar: string | null;
  capabilityId: string;
  capabilityName: string;
  dependsOn: string[];
  rationale: string;
  estimatedSeconds: number;
  status: TASK_STEP_STATUS;
  output: string | null;
}

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback;

export function seedsFromPlanJson(steps: Prisma.JsonValue | null): PlanStepSeed[] {
  if (!Array.isArray(steps)) return [];

  return steps.flatMap((raw, index) => {
    if (typeof raw !== 'object' || raw === null) return [];
    const step = raw as Record<string, unknown>;
    const employee = (step.employee ?? {}) as Record<string, unknown>;
    const capability = (step.capability ?? {}) as Record<string, unknown>;
    const employeeId = asString(employee.id);
    const capabilityId = asString(capability.id);
    // 没有员工或能力的步骤无法执行，直接丢掉而不是留一个必然失败的行
    if (!employeeId || !capabilityId) return [];

    const rawStatus = asString(step.status, 'queued');
    const status =
      rawStatus === 'completed'
        ? TASK_STEP_STATUS.COMPLETED
        : rawStatus === 'skipped'
          ? TASK_STEP_STATUS.SKIPPED
          : TASK_STEP_STATUS.QUEUED;

    return [
      {
        stepKey: asString(step.id, `step-${index + 1}`),
        order: typeof step.order === 'number' ? step.order : index + 1,
        title: asString(step.title, '未命名步骤'),
        description: asString(step.description),
        employeeId,
        employeeName: asString(employee.name, '未知员工'),
        employeeAvatar: typeof employee.avatar === 'string' && employee.avatar ? employee.avatar : null,
        capabilityId,
        capabilityName: asString(capability.name, '未知能力'),
        dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn.filter((d): d is string => typeof d === 'string') : [],
        rationale: asString(step.rationale),
        estimatedSeconds: typeof step.estimatedSeconds === 'number' ? step.estimatedSeconds : 0,
        status,
        output: typeof step.output === 'string' && step.output ? step.output : null,
      },
    ];
  });
}
