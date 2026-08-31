import type { TaskPlan, TaskPlanStep, TaskStepStatus } from './task-orchestration';
import {
  formatDuration,
  narrateStep as narrateStepCore,
  STEP_TONE_BY_STATUS as TONE_BY_STATUS,
  type NarratableStep,
  type StepNarration,
  type StepTone,
} from './task-execution-narration';

/**
 * 依赖图用的状态文案适配层。
 *
 * 画布组件吃的是 `TaskPlanStep`（规划期形状），而叙事的权威实现在
 * `task-execution-narration.ts`。这里只做形状转换，不重写文案 —— 同一个步骤在
 * 时间线和依赖图上必须说同一句话，各写一份就会漂移（重构前有四处各写一套，
 * 同一步骤在不同位置显示不同说法）。
 */

export type { StepTone, StepNarration };
export { formatDuration };

export const STEP_TONE_BY_STATUS: Record<TaskStepStatus, StepTone> = {
  queued: TONE_BY_STATUS.queued,
  running: TONE_BY_STATUS.running,
  completed: TONE_BY_STATUS.completed,
  failed: TONE_BY_STATUS.failed,
  skipped: TONE_BY_STATUS.skipped,
};

function toNarratable(step: TaskPlanStep, paused: boolean): NarratableStep {
  // 画布把「暂停」作为一个外部集合传进来（pausedStepIds），执行期它是步骤自己的
  // 状态。在这里统一成状态，下游只认一种模型。
  const pausedNow = paused && (step.status === 'queued' || step.status === 'running');
  return {
    key: step.id,
    order: step.order,
    title: step.title,
    status: pausedNow ? 'paused' : step.status,
    employeeName: step.employee.name,
    employeeId: step.employee.id,
    capabilityName: step.capability.name,
    dependsOn: step.dependsOn,
    estimatedSeconds: step.estimatedSeconds,
    startedAt: step.startedAt ?? null,
    durationMs: step.durationMs ?? null,
    output: step.output ?? null,
    error: step.error ?? null,
  };
}

export function narrateStep(
  step: TaskPlanStep,
  ctx: { plan: TaskPlan; paused?: boolean; nowMs?: number },
): StepNarration {
  const paused = ctx.paused ?? false;
  return narrateStepCore(toNarratable(step, paused), {
    steps: ctx.plan.steps.map((candidate) => toNarratable(candidate, false)),
    nowMs: ctx.nowMs,
  });
}
