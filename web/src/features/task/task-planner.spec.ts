import { describe, expect, it } from 'vitest';
import { buildTaskPlan } from './task-planner';
import type { TaskCandidateEmployee } from './task-orchestration';

const candidates: TaskCandidateEmployee[] = [
  {
    id: 'analyst',
    name: '数据分析师',
    description: '负责经营数据分析、趋势识别和异常诊断',
    position: '数据分析',
    industry: '电商',
    avatar: null,
    capabilities: [
      { id: 'sales-analysis', name: '销售数据分析', description: '分析销售数据和趋势', type: 'SKILL' },
    ],
  },
  {
    id: 'writer',
    name: '报告撰写员',
    description: '将复杂结论整理为管理层报告和简报',
    position: '内容创作',
    industry: '通用',
    avatar: null,
    capabilities: [
      { id: 'report', name: '经营分析报告', description: '生成结构化经营报告', type: 'SKILL' },
    ],
  },
];

describe('buildTaskPlan', () => {
  it('selects analysis and report employees for a multi-step objective', () => {
    const plan = buildTaskPlan('分析最近三个月销售数据并输出经营分析报告', candidates);

    expect(plan.steps.map((step) => step.intent)).toEqual(['analysis', 'report']);
    expect(plan.steps[0].employee.id).toBe('analyst');
    expect(plan.steps[0].capability.id).toBe('sales-analysis');
    expect(plan.steps[1].employee.id).toBe('writer');
    expect(plan.steps[1].dependsOn).toEqual(['step-1']);
  });

  it('routes content tasks to the employee whose capability describes content', () => {
    const plan = buildTaskPlan('写一份新品推广文案', [
      {
        ...candidates[0],
        capabilities: [{ id: 'copy', name: '营销文案', description: '创作营销内容和推广文案', type: 'SKILL' }],
      },
    ]);

    expect(plan.steps[0].intent).toBe('content');
    expect(plan.steps[0].capability.id).toBe('copy');
  });

  it('provides a safe fallback when the objective has no intent keyword', () => {
    const plan = buildTaskPlan('请帮我处理这件事', candidates);

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].intent).toBe('general');
    expect(plan.steps[0].rationale).toContain('兜底');
  });

  it('returns an empty plan when no subscribed employee has a capability', () => {
    const plan = buildTaskPlan('分析数据', [{ ...candidates[0], capabilities: [] }]);

    expect(plan.steps).toEqual([]);
    expect(plan.summary).toContain('暂无可用');
  });
});
