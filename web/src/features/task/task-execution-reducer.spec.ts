import { describe, expect, it } from 'vitest';
import {
  EMPTY_EXECUTION_STATE,
  executionReducer,
  type ExecutionState,
} from './task-execution-reducer';
import type { TaskExecutionSnapshot, TaskExecutionStep } from './task-execution';

const step = (over: Partial<TaskExecutionStep> = {}): TaskExecutionStep => ({
  stepKey: 'step-1',
  order: 1,
  title: '竞品调研',
  description: '查三家竞品',
  employee: { id: 'emp1', name: '市场调研员', avatar: null },
  capability: { id: 'cap1', name: '网页检索' },
  skillVersionId: null,
  dependsOn: [],
  rationale: '',
  estimatedSeconds: 60,
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

const snapshot = (steps: TaskExecutionStep[]): TaskExecutionSnapshot => ({
  id: 'run1',
  objective: '给保温杯做投放方案',
  summary: '',
  status: 'running',
  steps,
  deliverable: null,
  deliverableGeneratedAt: null,
  deliverableDegraded: false,
  startedAt: '2026-08-31T10:00:00.000Z',
  completedAt: null,
  heartbeatAt: '2026-08-31T10:00:10.000Z',
  stopRequested: false,
  updatedAt: '2026-08-31T10:00:10.000Z',
});

const withSnapshot = (steps: TaskExecutionStep[]): ExecutionState => ({
  ...EMPTY_EXECUTION_STATE,
  snapshot: snapshot(steps),
});

describe('executionReducer', () => {
  it('snapshot 帧清掉累加的增量 —— 否则已完成的步骤会显示出多写一截的幻影', () => {
    const state: ExecutionState = {
      ...withSnapshot([step()]),
      liveText: { 'step-1': '半截内容' },
      error: '旧错误',
    };

    const next = executionReducer(state, {
      kind: 'frame',
      frame: { type: 'snapshot', snapshot: snapshot([step({ output: '完整内容' })]) },
    });

    expect(next.liveText).toEqual({});
    expect(next.error).toBeNull();
    expect(next.snapshot?.steps[0].output).toBe('完整内容');
  });

  it('step_delta 按 stepKey 累加，互不干扰', () => {
    let state = withSnapshot([step(), step({ stepKey: 'step-2', order: 2 })]);
    state = executionReducer(state, { kind: 'frame', frame: { type: 'step_delta', stepKey: 'step-1', delta: '前' } });
    state = executionReducer(state, { kind: 'frame', frame: { type: 'step_delta', stepKey: 'step-2', delta: 'A' } });
    state = executionReducer(state, { kind: 'frame', frame: { type: 'step_delta', stepKey: 'step-1', delta: '后' } });

    expect(state.liveText['step-1']).toBe('前后');
    expect(state.liveText['step-2']).toBe('A');
  });

  it('step_output 写进快照并清空该步的增量', () => {
    let state = withSnapshot([step()]);
    state = executionReducer(state, { kind: 'frame', frame: { type: 'step_delta', stepKey: 'step-1', delta: '半截' } });
    state = executionReducer(state, {
      kind: 'frame',
      frame: { type: 'step_output', stepKey: 'step-1', output: '完整产出' },
    });

    expect(state.snapshot?.steps[0].output).toBe('完整产出');
    expect(state.liveText['step-1']).toBe('');
  });

  it('重跑（status=running）清掉上一轮的实时文本与工具', () => {
    let state = withSnapshot([step({ status: 'failed', error: '超时' })]);
    state = executionReducer(state, { kind: 'frame', frame: { type: 'step_delta', stepKey: 'step-1', delta: '上一轮' } });
    state = executionReducer(state, {
      kind: 'frame',
      frame: { type: 'tool', stepKey: 'step-1', name: '检索', phase: 'start' },
    });

    state = executionReducer(state, {
      kind: 'frame',
      frame: { type: 'step_status', stepKey: 'step-1', status: 'running', attempt: 2, error: null },
    });

    expect(state.liveText['step-1']).toBe('');
    expect(state.liveTools['step-1']).toEqual([]);
    expect(state.snapshot?.steps[0].status).toBe('running');
    expect(state.snapshot?.steps[0].attempt).toBe(2);
    expect(state.snapshot?.steps[0].error).toBeNull();
  });

  it('step_status 只覆盖帧里带的字段，没带的保持原值', () => {
    const state = withSnapshot([step({ status: 'running', startedAt: '2026-08-31T10:00:00.000Z', attempt: 1 })]);
    const next = executionReducer(state, {
      kind: 'frame',
      frame: { type: 'step_status', stepKey: 'step-1', status: 'completed', durationMs: 1200 },
    });

    expect(next.snapshot?.steps[0].startedAt).toBe('2026-08-31T10:00:00.000Z');
    expect(next.snapshot?.steps[0].attempt).toBe(1);
    expect(next.snapshot?.steps[0].durationMs).toBe(1200);
  });

  it('step_input 落下 prompt 与交接内容', () => {
    const state = withSnapshot([step({ stepKey: 'step-2', order: 2, dependsOn: ['step-1'] })]);
    const next = executionReducer(state, {
      kind: 'frame',
      frame: {
        type: 'step_input',
        stepKey: 'step-2',
        inputPrompt: '完整 prompt',
        handoff: [
          {
            fromStepKey: 'step-1',
            fromStepTitle: '竞品调研',
            fromEmployeeName: '市场调研员',
            excerpt: '摘要',
            chars: 2294,
          },
        ],
      },
    });

    expect(next.snapshot?.steps[0].inputPrompt).toBe('完整 prompt');
    expect(next.snapshot?.steps[0].handoff[0].chars).toBe(2294);
  });

  it('tool 帧把最后一个 running 的工具收尾，不会误改前面已完成的', () => {
    let state = withSnapshot([step()]);
    state = executionReducer(state, { kind: 'frame', frame: { type: 'tool', stepKey: 'step-1', name: 'A', phase: 'start' } });
    state = executionReducer(state, {
      kind: 'frame',
      frame: { type: 'tool', stepKey: 'step-1', name: 'A', phase: 'end', success: true, durationMs: 300 },
    });
    state = executionReducer(state, { kind: 'frame', frame: { type: 'tool', stepKey: 'step-1', name: 'B', phase: 'start' } });
    state = executionReducer(state, {
      kind: 'frame',
      frame: { type: 'tool', stepKey: 'step-1', name: 'B', phase: 'end', success: false },
    });

    expect(state.liveTools['step-1']).toEqual([
      { name: 'A', status: 'done', success: true, durationMs: 300 },
      { name: 'B', status: 'done', success: false, durationMs: undefined },
    ]);
  });

  it('重复的事件按 id 去重 —— 重连后会补拉一遍历史', () => {
    const event = {
      id: 'e1',
      type: 'STEP_STARTED' as const,
      stepId: 'step-1',
      stepTitle: '竞品调研',
      employeeName: '市场调研员',
      message: '开始',
      payload: null,
      createdAt: '2026-08-31T10:00:00.000Z',
    };
    let state = executionReducer(EMPTY_EXECUTION_STATE, { kind: 'frame', frame: { type: 'event', event } });
    state = executionReducer(state, { kind: 'frame', frame: { type: 'event', event } });

    expect(state.events).toHaveLength(1);
  });

  it('deliverable 帧落下正文与退化标记', () => {
    const state = withSnapshot([step({ status: 'completed', output: 'x' })]);
    const next = executionReducer(state, {
      kind: 'frame',
      frame: {
        type: 'deliverable',
        deliverable: '# 方案',
        degraded: true,
        generatedAt: '2026-08-31T10:10:00.000Z',
      },
    });

    expect(next.snapshot?.deliverable).toBe('# 方案');
    expect(next.snapshot?.deliverableDegraded).toBe(true);
    expect(next.snapshot?.deliverableGeneratedAt).toBe('2026-08-31T10:10:00.000Z');
  });

  it('快照还没到就收到增量帧时不崩，也不凭空造出 snapshot', () => {
    const next = executionReducer(EMPTY_EXECUTION_STATE, {
      kind: 'frame',
      frame: { type: 'step_status', stepKey: 'step-1', status: 'running' },
    });
    expect(next.snapshot).toBeNull();

    const pinged = executionReducer(EMPTY_EXECUTION_STATE, {
      kind: 'frame',
      frame: { type: 'ping', heartbeatAt: '2026-08-31T10:00:00.000Z' },
    });
    expect(pinged.snapshot).toBeNull();
  });

  it('reset 回到空状态', () => {
    const state = withSnapshot([step()]);
    expect(executionReducer(state, { kind: 'reset' })).toEqual(EMPTY_EXECUTION_STATE);
  });
});
