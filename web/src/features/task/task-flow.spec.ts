import { describe, expect, it } from 'vitest';
import { buildTaskFlowStages } from './task-flow';
import type { TaskPlanStep } from './task-orchestration';

function step(id: string, dependsOn: string[] = []): TaskPlanStep {
  return {
    id,
    order: Number(id.replace('step-', '')),
    title: id,
    description: id,
    intent: 'llm_planned',
    employee: {
      id: `employee-${id}`,
      name: id,
      description: id,
      position: 'test',
      industry: 'test',
      avatar: null,
      capabilities: [],
    },
    capability: { id: `capability-${id}`, name: id, description: id, type: 'SKILL' },
    dependsOn,
    rationale: id,
    estimatedSeconds: 60,
    status: 'queued',
    progress: 0,
  };
}

describe('buildTaskFlowStages', () => {
  it('groups independent steps and advances dependent steps', () => {
    const stages = buildTaskFlowStages([
      step('step-1'),
      step('step-2'),
      step('step-3', ['step-1', 'step-2']),
    ]);

    expect(stages.map((stage) => stage.steps.map((item) => item.id))).toEqual([
      ['step-1', 'step-2'],
      ['step-3'],
    ]);
  });

  it('keeps a linear dependency chain in separate stages', () => {
    const stages = buildTaskFlowStages([
      step('step-1'),
      step('step-2', ['step-1']),
      step('step-3', ['step-2']),
    ]);

    expect(stages.map((stage) => stage.depth)).toEqual([0, 1, 2]);
  });
});
