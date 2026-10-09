import { NotFoundException } from '@nestjs/common';
import * as aiSdk from 'ai';
import * as openAiCompatible from '@ai-sdk/openai-compatible';
import { DigitalEmployeeRunner } from './digital-employee.runner';

const now = new Date('2026-10-08T06:00:00Z');
const member = {
  id: 'member-1',
  enterpriseId: 'enterprise-1',
  role: 'MEMBER',
  departmentId: 'department-1',
};
const employee = {
  id: 'employee-1',
  name: 'Test employee',
  systemPrompt: 'Test prompt',
  modelId: 'test-model',
  maxSteps: 3,
  bindings: ['cap-1', 'cap-2'].map((id, index) => ({
    capability: {
      id,
      name: `Tool ${index + 1}`,
      description: 'Test tool',
      inputSchema: {},
      type: 'SKILL',
    },
  })),
};

describe('DigitalEmployeeRunner execution context', () => {
  let prisma: any;
  let capabilityService: any;
  let runner: DigitalEmployeeRunner;
  let generateText: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    prisma = {
      digitalEmployee: {
        findUnique: jest.fn().mockResolvedValue(employee),
      },
      enterpriseMember: {
        findFirst: jest.fn().mockResolvedValue(member),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({ id: 'subscription-1' }),
      },
    };
    capabilityService = {
      execute: jest
        .fn()
        .mockResolvedValue({ success: true, output: 'tool result' }),
    };
    const configService = {
      get: jest.fn((_key: string, fallback: string) => fallback),
      getOrThrow: jest.fn().mockReturnValue('test-key'),
    };
    jest
      .spyOn(openAiCompatible, 'createOpenAICompatible')
      .mockReturnValue(jest.fn().mockReturnValue({}) as any);
    // 真正调用 runner 组装出的工具，但不调用模型、适配器或数据库。
    generateText = jest
      .spyOn(aiSdk, 'generateText')
      .mockImplementation(async (options: any) => {
        const outputs = [];
        for (const tool of Object.values(options.tools ?? {}) as any[]) {
          outputs.push(await tool.execute({ input: 'tool input' }));
        }
        return { text: outputs.join('|'), steps: [{}] } as any;
      });
    runner = new DigitalEmployeeRunner(
      prisma,
      capabilityService,
      configService as any,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('passes the authorized subscription and actual user to every bound tool', async () => {
    const result = await runner.run(
      'employee-1',
      'Hello',
      'session-1',
      'user-1',
    );

    expect(prisma.enterpriseMember.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, enterpriseId: true, role: true, departmentId: true },
    });
    expect(prisma.subscription.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
      where: {
        enterpriseId: 'enterprise-1',
        employeeId: 'employee-1',
        status: 'ACTIVE',
        OR: [{ endDate: null }, { endDate: { gt: now } }],
        grants: {
          some: {
            OR: [{ memberId: 'member-1' }, { departmentId: 'department-1' }],
            AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
          },
        },
      },
      select: { id: true },
    });
    for (const capabilityId of ['cap-1', 'cap-2']) {
      expect(capabilityService.execute).toHaveBeenCalledWith(
        capabilityId,
        {
          userMessage: JSON.stringify({ input: 'tool input' }),
          sessionId: 'session-1',
          userId: 'user-1',
        },
        { subscriptionId: 'subscription-1', userId: 'user-1' },
      );
    }
    expect(capabilityService.execute).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      text: 'tool result|tool result',
      stepsCount: 1,
      employeeId: 'employee-1',
      employeeName: 'Test employee',
    });
  });

  it('does not match null department grants for an unassigned member', async () => {
    prisma.enterpriseMember.findFirst.mockResolvedValue({
      ...member,
      departmentId: null,
    });

    await runner.run('employee-1', 'Hello', 'session-1', 'user-1');

    expect(
      prisma.subscription.findFirst.mock.calls[0][0].where.grants.some.OR,
    ).toEqual([{ memberId: 'member-1' }]);
  });

  it('does not give department managers the enterprise-admin grant exemption', async () => {
    prisma.enterpriseMember.findFirst.mockResolvedValue({
      ...member,
      role: 'DEPT_MANAGER',
    });

    await runner.run('employee-1', 'Hello', 'session-1', 'user-1');

    expect(
      prisma.subscription.findFirst.mock.calls[0][0].where.grants.some.OR,
    ).toEqual([{ memberId: 'member-1' }, { departmentId: 'department-1' }]);
  });

  it('allows enterprise admins to resolve an active subscription without a grant', async () => {
    prisma.enterpriseMember.findFirst.mockResolvedValue({
      ...member,
      role: 'ENTERPRISE_ADMIN',
    });

    await runner.run('employee-1', 'Hello', 'session-1', 'user-1');

    expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
      where: {
        enterpriseId: 'enterprise-1',
        employeeId: 'employee-1',
        status: 'ACTIVE',
        OR: [{ endDate: null }, { endDate: { gt: now } }],
      },
      select: { id: true },
    });
    expect(capabilityService.execute.mock.calls[0][2]).toEqual({
      subscriptionId: 'subscription-1',
      userId: 'user-1',
    });
  });

  it('preserves anonymous platform previews without enterprise or subscription queries', async () => {
    await runner.run('employee-1', 'Preview', 'session-1');

    expect(prisma.enterpriseMember.findFirst).not.toHaveBeenCalled();
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
    expect(
      capabilityService.execute.mock.calls.map((call: any[]) => call[2]),
    ).toEqual([{}, {}]);
  });

  it('preserves previews by authenticated users without an enterprise', async () => {
    prisma.enterpriseMember.findFirst.mockResolvedValue(null);

    await runner.run('employee-1', 'Preview', 'session-1', 'platform-user');

    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
    expect(
      capabilityService.execute.mock.calls.map((call: any[]) => call[2]),
    ).toEqual([{ userId: 'platform-user' }, { userId: 'platform-user' }]);
  });

  it('preserves previews without an eligible subscription and never borrows another tenant subscription', async () => {
    // findFirst 的条件已包含企业、员工、订阅期限和 Grant 期限。
    // 无订阅、订阅停用/过期、Grant 缺失/过期均由查询返回 null。
    prisma.subscription.findFirst.mockResolvedValue(null);

    await runner.run('employee-1', 'Preview', 'session-1', 'user-1');

    expect(prisma.subscription.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.findFirst.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        enterpriseId: 'enterprise-1',
        employeeId: 'employee-1',
      }),
    );
    expect(
      capabilityService.execute.mock.calls.map((call: any[]) => call[2]),
    ).toEqual([{ userId: 'user-1' }, { userId: 'user-1' }]);
  });

  it('does not swallow subscription lookup failures and fall back to preview', async () => {
    const error = new Error('Database unavailable');
    prisma.subscription.findFirst.mockRejectedValue(error);

    await expect(
      runner.run('employee-1', 'Hello', 'session-1', 'user-1'),
    ).rejects.toBe(error);

    expect(generateText).not.toHaveBeenCalled();
    expect(capabilityService.execute).not.toHaveBeenCalled();
  });

  it('retains the tool error response', async () => {
    capabilityService.execute.mockResolvedValue({
      success: false,
      error: 'Tool failed',
    });

    const result = await runner.run(
      'employee-1',
      'Hello',
      'session-1',
      'user-1',
    );

    expect(result.text).toBe('Error: Tool failed|Error: Tool failed');
  });

  it('retains employee-not-found behavior before looking up the execution context', async () => {
    prisma.digitalEmployee.findUnique.mockResolvedValue(null);

    await expect(
      runner.run('missing', 'Hello', 'session-1', 'user-1'),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.enterpriseMember.findFirst).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });
});
