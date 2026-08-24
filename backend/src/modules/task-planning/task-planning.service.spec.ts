import { BadRequestException } from '@nestjs/common';
import { TaskPlanningService } from './task-planning.service';

describe('TaskPlanningService', () => {
  const subscriptions = { findAll: jest.fn() };
  const prisma = { digitalEmployee: { findMany: jest.fn() } };
  const config = { get: jest.fn((key: string, fallback?: string) => {
    if (key === 'SUB2API_API_KEY') return 'test-key';
    return fallback;
  }) };
  const service = new TaskPlanningService(prisma as never, subscriptions as never, config as never);

  const validPlan = {
    summary: '先分析数据，再生成管理层报告',
    steps: [
      {
        employeeId: 'employee-1', capabilityId: 'cap-1', title: '分析销售数据',
        description: '识别趋势和异常', rationale: '数据分析师最匹配', dependsOnStepNumbers: [], estimatedSeconds: 7200,
      },
      {
        employeeId: 'employee-2', capabilityId: 'cap-2', title: '生成报告',
        description: '整理分析结果', rationale: '报告撰写员最匹配', dependsOnStepNumbers: [1], estimatedSeconds: 90,
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptions.findAll.mockResolvedValue([
      { status: 'ACTIVE', employee: { id: 'employee-1' } },
      { status: 'ACTIVE', employee: { id: 'employee-2' } },
    ]);
    prisma.digitalEmployee.findMany.mockResolvedValue([
      {
        id: 'employee-1',
        name: '数据分析师',
        description: '分析经营数据',
        position: '数据分析',
        industry: '电商',
        avatar: null,
        bindings: [{ capability: { id: 'cap-1', name: '销售分析', description: '分析销售趋势', type: 'SKILL' } }],
      },
      {
        id: 'employee-2',
        name: '报告撰写员',
        description: '生成管理层报告',
        position: '内容创作',
        industry: '通用',
        avatar: null,
        bindings: [{ capability: { id: 'cap-2', name: '报告生成', description: '生成结构化报告', type: 'SKILL' } }],
      },
    ]);
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(validPlan) } }],
    }), { status: 200 }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('generates a validated LLM plan without executing any employee', async () => {
    const plan = await service.preview('user-1', { objective: '分析销售数据并生成报告' });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://longdaoai.cn/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(plan.status).toBe('awaiting_confirmation');
    expect(plan.planner.type).toBe('llm');
    expect(plan.steps.map((step) => step.employee.id)).toEqual(['employee-1', 'employee-2']);
    expect(plan.steps[0].estimatedSeconds).toBe(3600);
    expect(plan.steps[1].dependsOn).toEqual(['step-1']);
  });

  it('rejects a requested employee outside the active subscription set', async () => {
    await expect(
      service.preview('user-1', { objective: '分析销售数据', employeeIds: ['unknown-employee'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('drops model steps that reference IDs outside the candidate catalog', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        summary: 'invalid selection',
        steps: [{
          employeeId: 'not-allowed', capabilityId: 'not-allowed', title: '越权步骤',
          description: 'should be dropped', rationale: 'invalid', dependsOnStepNumbers: [], estimatedSeconds: 120,
        }],
      }) } }],
    }), { status: 200 }));

    await expect(service.preview('user-1', { objective: '分析销售数据' })).rejects.toThrow('无效的员工或能力选择');
  });
});
