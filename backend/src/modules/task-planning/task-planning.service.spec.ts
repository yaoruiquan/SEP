import { BadRequestException } from '@nestjs/common';
import { TaskPlanningService } from './task-planning.service';

describe('TaskPlanningService', () => {
  const subscriptions = { findAll: jest.fn() };
  const prisma = {
    digitalEmployee: { findMany: jest.fn() },
    employeeGrant: { findMany: jest.fn() },
  };
  const enterpriseContext = {
    resolve: jest.fn().mockResolvedValue({
      enterpriseId: 'enterprise-1',
      memberId: 'member-1',
      departmentId: null,
    }),
  };
  const config = { get: jest.fn((key: string, fallback?: string) => {
    // SUB2API_PLANNER_MODEL 之外的键都由系统设置回答了，这里只留规划器覆盖口
    return fallback;
  }) };
  // 中转参数统一从系统设置取（见 resolveSub2ApiProviderConfig 的注释：
  // 读 env 会与运营在管理端改的值不同步，线上因此出过 401）
  const settings = {
    getEffectiveValue: jest.fn(async (key: string) => {
      if (key === 'SUB2API_BASE_URL') return 'https://relay.test/v1';
      if (key === 'SUB2API_API_KEY') return 'test-key';
      if (key === 'SUB2API_DEFAULT_MODEL') return 'gemini-3.5-flash-high';
      return null;
    }),
  };
  const service = new TaskPlanningService(
    prisma as never,
    subscriptions as never,
    enterpriseContext as never,
    config as never,
    settings as never,
  );

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
      { id: 'subscription-1', status: 'ACTIVE', employee: { id: 'employee-1' } },
      { id: 'subscription-2', status: 'ACTIVE', employee: { id: 'employee-2' } },
    ]);
    prisma.employeeGrant.findMany.mockResolvedValue([
      { subscriptionId: 'subscription-1' },
      { subscriptionId: 'subscription-2' },
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

    // 地址与密钥都来自系统设置，不是 env —— 这条断言同时守住「规划器和对话
    // 用同一套中转参数」，线上曾因为规划器读 env 而独自报 401
    expect(global.fetch).toHaveBeenCalledWith(
      'https://relay.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
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
