'use client';

import type { TaskPlan, TaskPlanStep } from './task-orchestration';
import type { TaskExecutionSnapshot, TaskExecutionStep } from './task-execution';

export type { LiveStepTool } from './task-execution';
export type { TaskCandidateEmployee } from './task-orchestration';

/**
 * 规划期的计划 → 执行期的快照形状。
 *
 * 「合成一屏」的关键一步。改造前规划和执行是两个组件、两套数据形状，确认执行的
 * 那一刻整屏跳变，用户看到的是「换了个页面」而不是「同一个团队开始动了」。
 *
 * 统一到执行快照这一侧，而不是反过来：执行快照是信息更全的那个（有 inputPrompt、
 * handoff、sessionId），把它降级成计划形状会丢信息；反过来只是补空值。
 */
export function planToSnapshot(plan: TaskPlan): TaskExecutionSnapshot {
  return {
    id: plan.id,
    objective: plan.objective,
    summary: plan.summary,
    status: plan.status,
    steps: [...plan.steps]
      .sort((left, right) => left.order - right.order)
      .map(planStepToExecutionStep),
    deliverable: null,
    deliverableGeneratedAt: null,
    deliverableDegraded: false,
    startedAt: null,
    completedAt: null,
    heartbeatAt: null,
    stopRequested: false,
    updatedAt: plan.createdAt,
  };
}

function planStepToExecutionStep(step: TaskPlanStep): TaskExecutionStep {
  return {
    stepKey: step.id,
    order: step.order,
    title: step.title,
    description: step.description,
    employee: { id: step.employee.id, name: step.employee.name, avatar: step.employee.avatar },
    capability: { id: step.capability.id, name: step.capability.name },
    skillVersionId: null,
    dependsOn: step.dependsOn,
    rationale: step.rationale,
    estimatedSeconds: step.estimatedSeconds,
    // 规划期不存在 paused / running；JSON 快照里若残留旧状态一律按排队处理，
    // 权威状态在服务端的 TaskRunStep 行上
    status: step.status === 'completed' || step.status === 'skipped' ? step.status : 'queued',
    inputPrompt: null,
    handoff: [],
    output: step.output ?? null,
    error: null,
    sessionId: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    attempt: 0,
  };
}

/**
 * 计划里声明了依赖、但上游还没交付的那些「待发生的交接」。
 *
 * 交接桥要区分「已经交过了」和「还没交」—— 两者用同一种视觉会让人误以为
 * 东西已经传过去了。
 */
export function pendingHandoffs(
  step: TaskExecutionStep,
  allSteps: TaskExecutionStep[],
): { fromEmployeeName: string; fromStepTitle: string }[] {
  const delivered = new Set(step.handoff.map((entry) => entry.fromStepKey));
  return step.dependsOn
    .filter((key) => !delivered.has(key))
    .flatMap((key) => {
      const upstream = allSteps.find((candidate) => candidate.stepKey === key);
      if (!upstream) return [];
      return [{ fromEmployeeName: upstream.employee.name, fromStepTitle: upstream.title }];
    });
}
