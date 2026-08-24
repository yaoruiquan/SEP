import type { TaskPlanStep } from './task-orchestration';

export interface TaskFlowStage {
  depth: number;
  steps: TaskPlanStep[];
}

export function buildTaskFlowStages(steps: TaskPlanStep[]): TaskFlowStage[] {
  const depthById = new Map<string, number>();

  for (const step of steps) {
    const dependencyDepths = step.dependsOn
      .map((dependencyId) => depthById.get(dependencyId))
      .filter((depth): depth is number => depth !== undefined);
    depthById.set(step.id, dependencyDepths.length > 0 ? Math.max(...dependencyDepths) + 1 : 0);
  }

  const stages = new Map<number, TaskPlanStep[]>();
  for (const step of steps) {
    const depth = depthById.get(step.id) ?? 0;
    stages.set(depth, [...(stages.get(depth) ?? []), step]);
  }

  return [...stages.entries()]
    .sort(([left], [right]) => left - right)
    .map(([depth, stageSteps]) => ({ depth, steps: stageSteps }));
}
