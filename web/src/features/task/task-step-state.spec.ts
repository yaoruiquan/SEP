import { describe, expect, it } from 'vitest';
import { autoLayout } from './components/task-dependency-graph';
import type { TaskPlan, TaskPlanStep } from './task-orchestration';
import { formatDuration, narrateStep } from './task-step-state';

function employee(id: string, name: string) {
  return {
    id,
    name,
    description: '',
    position: '研发管理',
    industry: '软件研发',
    avatar: null,
    capabilities: [{ id: `cap-${id}`, name: '会议纪要整理', description: '', type: 'SKILL' as const }],
  };
}

function step(overrides: Partial<TaskPlanStep> & Pick<TaskPlanStep, 'id' | 'order'>): TaskPlanStep {
  const emp = overrides.employee ?? employee(`emp-${overrides.id}`, `员工${overrides.order}`);
  return {
    title: `第 ${overrides.order} 步`,
    description: '描述',
    intent: '整理',
    employee: emp,
    capability: emp.capabilities[0],
    dependsOn: [],
    rationale: '因为最合适',
    estimatedSeconds: 120,
    status: 'queued',
    progress: 0,
    ...overrides,
  } as TaskPlanStep;
}

function plan(steps: TaskPlanStep[], status: TaskPlan['status'] = 'awaiting_confirmation'): TaskPlan {
  return { id: 'run-1', objective: '整理今天的会议纪要', summary: '', steps, status, createdAt: '2026-08-27T00:00:00.000Z' };
}

describe('formatDuration', () => {
  it('秒 / 分秒 / 小时分', () => {
    expect(formatDuration(38_000)).toBe('38 秒');
    expect(formatDuration(72_000)).toBe('1 分 12 秒');
    expect(formatDuration(120_000)).toBe('2 分');
    expect(formatDuration(3_900_000)).toBe('1 小时 5 分');
  });

  it('负数和非法值返回空串', () => {
    expect(formatDuration(-1)).toBe('');
    expect(formatDuration(Number.NaN)).toBe('');
  });
});

describe('narrateStep', () => {
  it('候场中且有上游时点名在等谁', () => {
    const upstream = step({ id: 's1', order: 1, employee: employee('e1', '变革管理顾问') });
    const target = step({ id: 's2', order: 2, dependsOn: ['s1'] });
    const narration = narrateStep(target, { plan: plan([upstream, target]) });
    expect(narration.tone).toBe('idle');
    expect(narration.detail).toBe('等 变革管理顾问 交付后开始');
    expect(narration.timing).toBe('预计 2 分钟');
  });

  it('候场中且没有上游时说自己已就位', () => {
    const only = step({ id: 's1', order: 1, employee: employee('e1', '数据分析师') });
    expect(narrateStep(only, { plan: plan([only]) }).detail).toBe('数据分析师 已就位，确认计划后开始');
  });

  it('进行中报出正在用的技能和已用时长', () => {
    const now = Date.parse('2026-08-27T00:01:00.000Z');
    const running = step({
      id: 's1',
      order: 1,
      status: 'running',
      startedAt: '2026-08-27T00:00:22.000Z',
      employee: employee('e1', '变革管理顾问'),
    });
    const narration = narrateStep(running, { plan: plan([running], 'running'), nowMs: now });
    expect(narration.tone).toBe('active');
    expect(narration.detail).toBe('变革管理顾问 正在会议纪要整理');
    expect(narration.timing).toBe('已用 38 秒');
  });

  it('已完成报出用时；没有文本输出时说清楚', () => {
    const done = step({ id: 's1', order: 1, status: 'completed', output: '结论若干', durationMs: 72_000 });
    expect(narrateStep(done, { plan: plan([done]) })).toMatchObject({ tone: 'done', timing: '用了 1 分 12 秒' });

    const silent = step({ id: 's2', order: 2, status: 'completed', employee: employee('e2', '文档撰写员') });
    expect(narrateStep(silent, { plan: plan([silent]) }).detail).toContain('没有返回文本');
  });

  it('失败时把错误原文当作汇报内容', () => {
    const failed = step({ id: 's1', order: 1, status: 'failed', error: '上游没有给出结构化结果' });
    const narration = narrateStep(failed, { plan: plan([failed], 'failed') });
    expect(narration.tone).toBe('failed');
    expect(narration.detail).toBe('上游没有给出结构化结果');
  });

  it('暂停优先于 queued/running，但不覆盖已完成', () => {
    const running = step({ id: 's1', order: 1, status: 'running', employee: employee('e1', '数据分析师') });
    expect(narrateStep(running, { plan: plan([running]), paused: true })).toMatchObject({
      tone: 'paused',
      detail: '数据分析师 已停下，等你恢复',
    });

    const done = step({ id: 's2', order: 2, status: 'completed', durationMs: 1000 });
    expect(narrateStep(done, { plan: plan([done]), paused: true }).tone).toBe('done');
  });
});

describe('autoLayout', () => {
  it('按依赖深度分列，同层纵向排开', () => {
    const s1 = step({ id: 's1', order: 1 });
    const s2 = step({ id: 's2', order: 2, dependsOn: ['s1'] });
    const s3 = step({ id: 's3', order: 3, dependsOn: ['s1'] });
    const s4 = step({ id: 's4', order: 4, dependsOn: ['s2', 's3'] });
    const layout = autoLayout([s1, s2, s3, s4]);

    // s2/s3 同层：x 相同、y 不同
    expect(layout.s2.x).toBe(layout.s3.x);
    expect(layout.s2.y).not.toBe(layout.s3.y);
    // 深度递增 → x 递增
    expect(layout.s1.x).toBeLessThan(layout.s2.x);
    expect(layout.s2.x).toBeLessThan(layout.s4.x);
  });

  it('入参乱序也能算对深度（内部按 order 排过）', () => {
    const s1 = step({ id: 's1', order: 1 });
    const s2 = step({ id: 's2', order: 2, dependsOn: ['s1'] });
    const s3 = step({ id: 's3', order: 3, dependsOn: ['s2'] });
    const shuffled = autoLayout([s3, s1, s2]);
    const inOrder = autoLayout([s1, s2, s3]);
    expect(shuffled).toEqual(inOrder);
    expect(shuffled.s1.x).toBeLessThan(shuffled.s2.x);
    expect(shuffled.s2.x).toBeLessThan(shuffled.s3.x);
  });

  it('无依赖的步骤全部落在第一列', () => {
    const steps = [step({ id: 'a', order: 1 }), step({ id: 'b', order: 2 }), step({ id: 'c', order: 3 })];
    const layout = autoLayout(steps);
    expect(new Set([layout.a.x, layout.b.x, layout.c.x]).size).toBe(1);
    expect(new Set([layout.a.y, layout.b.y, layout.c.y]).size).toBe(3);
  });
});
