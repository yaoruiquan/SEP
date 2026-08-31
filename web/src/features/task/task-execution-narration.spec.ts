import { describe, expect, it } from 'vitest';
import {
  narrateRun,
  narrateStep,
  toNarratable,
  type NarratableStep,
} from './task-execution-narration';
import type { TaskExecutionStep } from './task-execution';

const node = (over: Partial<NarratableStep> = {}): NarratableStep => ({
  key: 'step-1',
  order: 1,
  title: '竞品调研',
  status: 'queued',
  employeeName: '市场调研员',
  employeeId: 'emp1',
  capabilityName: '网页检索',
  dependsOn: [],
  estimatedSeconds: 120,
  startedAt: null,
  durationMs: null,
  output: null,
  error: null,
  ...over,
});

describe('narrateStep', () => {
  it('候场中且有上游时点名在等谁 —— 一排「候场中」看不出卡在哪', () => {
    const upstream = node({ key: 'step-1', employeeName: '市场调研员' });
    const downstream = node({ key: 'step-2', order: 2, dependsOn: ['step-1'], employeeName: '文案' });
    const narration = narrateStep(downstream, { steps: [upstream, downstream] });

    expect(narration.tone).toBe('idle');
    expect(narration.detail).toBe('等 市场调研员 交付后开始');
  });

  it('候场中且无上游时说自己已就位', () => {
    const step = node();
    expect(narrateStep(step, { steps: [step] }).detail).toContain('已就位');
  });

  it('paused 是独立状态，不再靠外部传标志位', () => {
    const step = node({ status: 'paused' });
    const narration = narrateStep(step, { steps: [step] });

    expect(narration.tone).toBe('paused');
    expect(narration.detail).toBe('市场调研员 已停下，等你恢复');
  });

  it('进行中报出正在用的技能与已用时长', () => {
    const startedAt = new Date(Date.now() - 38_000).toISOString();
    const step = node({ status: 'running', startedAt });
    const narration = narrateStep(step, { steps: [step] });

    expect(narration.detail).toBe('市场调研员 正在网页检索');
    expect(narration.timing).toContain('已用 38 秒');
  });

  it('已完成但没有文本产出时说清楚，不假装交付了东西', () => {
    const step = node({ status: 'completed', output: null, durationMs: 1200 });
    expect(narrateStep(step, { steps: [step] }).detail).toContain('没有返回文本');
  });

  it('失败时把错误原文当作汇报内容', () => {
    const step = node({ status: 'failed', error: '赠送额度与企业钱包余额均已用尽' });
    expect(narrateStep(step, { steps: [step] }).detail).toBe('赠送额度与企业钱包余额均已用尽');
  });
});

describe('narrateRun', () => {
  const two = [
    node({ key: 'step-1', order: 1, employeeId: 'emp1' }),
    node({ key: 'step-2', order: 2, employeeId: 'emp2', employeeName: '文案', dependsOn: ['step-1'] }),
  ];

  it('运行中报出第 N/M 步与当前执行人', () => {
    const steps = [{ ...two[0], status: 'completed' as const }, { ...two[1], status: 'running' as const }];
    const narration = narrateRun('running', steps);

    expect(narration.label).toBe('第 2/2 步进行中');
    expect(narration.detail).toBe('文案 正在网页检索');
    expect(narration.doneCount).toBe(1);
  });

  it('运行中但只剩暂停的步骤时，说的是「等你放行」而不是「进行中」', () => {
    const steps = [{ ...two[0], status: 'completed' as const }, { ...two[1], status: 'paused' as const }];
    const narration = narrateRun('running', steps);

    expect(narration.label).toBe('等你放行');
    expect(narration.focusStep?.key).toBe('step-2');
  });

  it('失败时指向卡住的那一步', () => {
    const steps = [{ ...two[0], status: 'failed' as const, error: '模型超时' }, two[1]];
    const narration = narrateRun('failed', steps);

    expect(narration.label).toBe('第 1 步卡住了');
    expect(narration.detail).toBe('模型超时');
  });

  it('完成时按去重后的员工数报人头', () => {
    const steps = two.map((step) => ({ ...step, status: 'completed' as const }));
    expect(narrateRun('completed', steps).detail).toBe('2 位员工完成了 2 步');
  });

  it('停止后提示可以从中断处继续，并指向下一个待跑步骤', () => {
    const steps = [{ ...two[0], status: 'completed' as const }, two[1]];
    const narration = narrateRun('stopped', steps);

    expect(narration.detail).toContain('可以从中断处继续');
    expect(narration.focusStep?.key).toBe('step-2');
  });
});

describe('toNarratable', () => {
  it('把执行步骤压成叙事需要的最小形状', () => {
    const step: TaskExecutionStep = {
      stepKey: 'step-7',
      order: 7,
      title: '写文案',
      description: '',
      employee: { id: 'emp9', name: '文案', avatar: null },
      capability: { id: 'cap9', name: '文案创作' },
      skillVersionId: null,
      dependsOn: ['step-6'],
      rationale: '',
      estimatedSeconds: 90,
      status: 'completed',
      inputPrompt: 'prompt',
      handoff: [],
      output: '成稿',
      error: null,
      sessionId: 'sess',
      startedAt: null,
      completedAt: null,
      durationMs: 4200,
      attempt: 1,
    };

    expect(toNarratable(step)).toEqual({
      key: 'step-7',
      order: 7,
      title: '写文案',
      status: 'completed',
      employeeName: '文案',
      employeeId: 'emp9',
      capabilityName: '文案创作',
      dependsOn: ['step-6'],
      estimatedSeconds: 90,
      startedAt: null,
      durationMs: 4200,
      output: '成稿',
      error: null,
    });
  });
});
