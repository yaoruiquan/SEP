import { describe, expect, it } from 'vitest';
import { pendingHandoffs, planToSnapshot } from './task-execution-view-model';
import type { TaskExecutionStep } from './task-execution';
import type { TaskPlan, TaskPlanStep } from './task-orchestration';

const employee = (id: string, name: string) => ({
  id,
  name,
  description: '',
  position: '',
  industry: '',
  avatar: null,
  capabilities: [],
});

const planStep = (over: Partial<TaskPlanStep> & Pick<TaskPlanStep, 'id' | 'order'>): TaskPlanStep => ({
  title: '竞品调研',
  description: '查三家竞品',
  intent: 'llm_planned',
  employee: employee('emp1', '市场调研员'),
  capability: { id: 'cap1', name: '网页检索', description: '', type: 'SKILL' },
  dependsOn: [],
  rationale: '需要外部数据',
  estimatedSeconds: 120,
  status: 'queued',
  progress: 0,
  ...over,
});

const plan = (steps: TaskPlanStep[], status: TaskPlan['status'] = 'awaiting_confirmation'): TaskPlan => ({
  id: 'run1',
  objective: '给保温杯做投放方案',
  summary: '两步',
  steps,
  status,
  createdAt: '2026-08-31T10:00:00.000Z',
});

const execStep = (over: Partial<TaskExecutionStep> & Pick<TaskExecutionStep, 'stepKey' | 'order'>): TaskExecutionStep => ({
  title: '竞品调研',
  description: '',
  employee: { id: 'emp1', name: '市场调研员', avatar: null },
  capability: { id: 'cap1', name: '网页检索' },
  skillVersionId: null,
  dependsOn: [],
  rationale: '',
  estimatedSeconds: 0,
  status: 'queued',
  inputPrompt: null,
  handoff: [],
  output: null,
  error: null,
  sessionId: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
  attempt: 0,
  ...over,
});

describe('planToSnapshot', () => {
  it('按 order 排序并保留计划里的选人理由与预计时长', () => {
    const snapshot = planToSnapshot(
      plan([
        planStep({ id: 'step-2', order: 2, employee: employee('emp2', '文案') }),
        planStep({ id: 'step-1', order: 1 }),
      ]),
    );

    expect(snapshot.steps.map((step) => step.stepKey)).toEqual(['step-1', 'step-2']);
    expect(snapshot.steps[0].rationale).toBe('需要外部数据');
    expect(snapshot.steps[0].estimatedSeconds).toBe(120);
  });

  it('规划期没有执行痕迹：startedAt / 交付物 / 交接一律为空', () => {
    const snapshot = planToSnapshot(plan([planStep({ id: 'step-1', order: 1 })]));

    expect(snapshot.startedAt).toBeNull();
    expect(snapshot.deliverable).toBeNull();
    expect(snapshot.stopRequested).toBe(false);
    expect(snapshot.steps[0].handoff).toEqual([]);
    expect(snapshot.steps[0].inputPrompt).toBeNull();
  });

  it('JSON 快照里残留的 running / failed 一律按排队处理 —— 权威状态在服务端', () => {
    const snapshot = planToSnapshot(
      plan([
        planStep({ id: 'step-1', order: 1, status: 'running' }),
        planStep({ id: 'step-2', order: 2, status: 'failed' }),
        planStep({ id: 'step-3', order: 3, status: 'completed', output: '产出' }),
        planStep({ id: 'step-4', order: 4, status: 'skipped' }),
      ]),
    );

    expect(snapshot.steps.map((step) => step.status)).toEqual([
      'queued',
      'queued',
      'completed',
      'skipped',
    ]);
    expect(snapshot.steps[2].output).toBe('产出');
  });
});

describe('pendingHandoffs', () => {
  it('依赖已交付时不再算「待交接」', () => {
    const upstream = execStep({ stepKey: 'step-1', order: 1, status: 'completed', output: 'x' });
    const downstream = execStep({
      stepKey: 'step-2',
      order: 2,
      dependsOn: ['step-1'],
      handoff: [
        {
          fromStepKey: 'step-1',
          fromStepTitle: '竞品调研',
          fromEmployeeName: '市场调研员',
          excerpt: 'x',
          chars: 1,
        },
      ],
    });

    expect(pendingHandoffs(downstream, [upstream, downstream])).toEqual([]);
  });

  it('依赖还没交付时报出在等谁 —— 已交接和待交接不能长一个样', () => {
    const upstream = execStep({ stepKey: 'step-1', order: 1, title: '竞品调研' });
    const downstream = execStep({
      stepKey: 'step-2',
      order: 2,
      dependsOn: ['step-1'],
      employee: { id: 'emp2', name: '文案', avatar: null },
    });

    expect(pendingHandoffs(downstream, [upstream, downstream])).toEqual([
      { fromEmployeeName: '市场调研员', fromStepTitle: '竞品调研' },
    ]);
  });

  it('依赖指向不存在的步骤时忽略，不生成空占位', () => {
    const step = execStep({ stepKey: 'step-2', order: 2, dependsOn: ['step-deleted'] });
    expect(pendingHandoffs(step, [step])).toEqual([]);
  });
});
