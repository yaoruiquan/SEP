/**
 * 企业模型配置服务测试。
 *
 * 重点覆盖两处**容易悄悄错掉、且错了不会报错只会用错模型**的逻辑：
 *   ① 优先级链：用户选择 > 员工实例 > 部门 > 企业 > 系统兜底。
 *      每层还要各自受白名单和开关约束 —— 少判一个条件不会抛异常，
 *      只会安静地用错模型，线上很难发现。
 *   ② 预算：checkBudgetExceeded 是**事实判断**，与 hardStopOnBudget 无关。
 *      两者合并会让只告警的企业永远读到 false，前端就没法提示。
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EnterpriseModelConfigService } from './enterprise-model-config.service';

const ACME = {
  enterpriseId: 'ent-acme',
  memberId: 'mem-boss',
  role: 'ENTERPRISE_ADMIN' as const,
  departmentId: null,
};

/** 企业配置默认值，各测试按需覆盖字段 */
function makeConfig(over: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1',
    enterpriseId: 'ent-acme',
    defaultChatModel: 'gemini-3.5-flash-high',
    allowedChatModels: [] as string[],
    allowUserSwitchModel: true,
    embeddingModel: 'text-embedding-3-small',
    rerankModel: null,
    embeddingBatchSize: 32,
    embeddingTimeoutMs: 30000,
    employeeModelPolicy: 'FOLLOW_TEMPLATE',
    employeeDefaultModel: null,
    monthlyBudgetCNY: null,
    alertThreshold: 0.8,
    hardStopOnBudget: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

describe('EnterpriseModelConfigService', () => {
  let prisma: any;
  let ctxSvc: any;
  let svc: EnterpriseModelConfigService;

  beforeEach(() => {
    prisma = {
      enterpriseModelConfig: {
        findUnique: jest.fn().mockResolvedValue(makeConfig()),
        create: jest.fn(),
        update: jest.fn(),
      },
      departmentModelPolicy: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      department: {
        findUnique: jest.fn().mockResolvedValue({ enterpriseId: 'ent-acme' }),
      },
      subscription: { findUnique: jest.fn().mockResolvedValue(null) },
      platformModel: { findMany: jest.fn().mockResolvedValue([]) },
      computeAccount: { findUnique: jest.fn().mockResolvedValue({ id: 'acct-1' }) },
      computeTransaction: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
    };
    ctxSvc = {
      resolve: jest.fn().mockResolvedValue(ACME),
      assertEnterpriseAdmin: jest.fn(),
    };
    svc = new EnterpriseModelConfigService(prisma, ctxSvc);
  });

  describe('get', () => {
    it('配置不存在时按系统默认建一条，而不是返回 null', async () => {
      prisma.enterpriseModelConfig.findUnique.mockResolvedValue(null);
      prisma.enterpriseModelConfig.create.mockResolvedValue(makeConfig());

      const cfg = await svc.get('u1');

      expect(prisma.enterpriseModelConfig.create).toHaveBeenCalled();
      expect(cfg.defaultChatModel).toBe('gemini-3.5-flash-high');
    });

    it('Decimal 预算序列化成字符串下发', async () => {
      prisma.enterpriseModelConfig.findUnique.mockResolvedValue(
        makeConfig({ monthlyBudgetCNY: { toString: () => '5000' } }),
      );

      const cfg = await svc.get('u1');
      expect(cfg.monthlyBudgetCNY).toBe('5000');
    });
  });

  describe('getAvailableModels', () => {
    it('返回 modelId 而非主键 —— 调用模型用的是 modelId', async () => {
      prisma.platformModel.findMany.mockResolvedValue([
        {
          modelId: 'claude-sonnet-5',
          label: 'Claude Sonnet 5',
          vendor: null,
          category: null,
          contextLength: null,
          maxOutputTokens: null,
          pricingInputPer1M: null,
          pricingOutputPer1M: null,
          supportedFeatures: null,
          description: null,
        },
      ]);

      const models = await svc.getAvailableModels('u1');

      expect(models[0].modelId).toBe('claude-sonnet-5');
      // 元数据列目前大多为空，必须原样透传 null 让前端降级，不能塞 0 / ''
      expect(models[0].contextLength).toBeNull();
      expect(models[0].pricingInputPer1M).toBeNull();
    });

    it('只取 enabled 的模型', async () => {
      await svc.getAvailableModels('u1');
      expect(prisma.platformModel.findMany.mock.calls[0][0].where).toEqual({
        enabled: true,
      });
    });
  });

  describe('resolveEffectiveModel 优先级链', () => {
    it('① 用户选择在白名单内 → USER_CHOICE', async () => {
      prisma.enterpriseModelConfig.findUnique.mockResolvedValue(
        makeConfig({ allowedChatModels: ['claude-sonnet-5', 'gpt-4o'] }),
      );

      const r = await svc.resolveEffectiveModel({
        userId: 'u1',
        userSelectedModel: 'claude-sonnet-5',
      });

      expect(r.chatModel).toBe('claude-sonnet-5');
      expect(r.source).toBe('USER_CHOICE');
    });

    it('用户选择**不在**白名单内 → 忽略，回落企业默认', async () => {
      prisma.enterpriseModelConfig.findUnique.mockResolvedValue(
        makeConfig({ allowedChatModels: ['gpt-4o'] }),
      );

      const r = await svc.resolveEffectiveModel({
        userId: 'u1',
        userSelectedModel: 'claude-opus-5', // 白名单外
      });

      expect(r.chatModel).toBe('gemini-3.5-flash-high');
      expect(r.source).toBe('ENTERPRISE');
    });

    it('白名单为空 = 不限制，用户任选都算 USER_CHOICE', async () => {
      const r = await svc.resolveEffectiveModel({
        userId: 'u1',
        userSelectedModel: 'claude-opus-5',
      });

      expect(r.source).toBe('USER_CHOICE');
      expect(r.chatModel).toBe('claude-opus-5');
    });

    it('allowUserSwitchModel=false → 忽略用户和员工模型并强制使用企业默认', async () => {
      prisma.enterpriseModelConfig.findUnique.mockResolvedValue(
        makeConfig({ allowUserSwitchModel: false }),
      );

      const r = await svc.resolveEffectiveModel({
        userId: 'u1',
        userSelectedModel: 'claude-sonnet-5',
        employeeTemplateModel: 'gpt-4o',
      });

      expect(r.source).toBe('ENTERPRISE');
      expect(r.chatModel).toBe('gemini-3.5-flash-high');
      expect(r.allowUserSwitchModel).toBe(false);
    });

    it('allowUserSwitchModel=false → 部门默认仍覆盖企业默认', async () => {
      prisma.enterpriseModelConfig.findUnique.mockResolvedValue(
        makeConfig({ allowUserSwitchModel: false }),
      );
      prisma.departmentModelPolicy.findUnique.mockResolvedValue({
        defaultChatModel: 'claude-sonnet-5',
        allowedChatModels: [],
      });

      const r = await svc.resolveEffectiveModel({
        userId: 'u1',
        employeeTemplateModel: 'gpt-4o',
        departmentId: 'dept-tech',
      });

      expect(r.source).toBe('DEPARTMENT');
      expect(r.chatModel).toBe('claude-sonnet-5');
    });

    it('② FOLLOW_TEMPLATE 下走雇佣关系自带模型', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        config: { modelId: 'gpt-4o-mini' },
      });

      const r = await svc.resolveEffectiveModel({
        userId: 'u1',
        subscriptionId: 'sub-1',
      });

      expect(r.chatModel).toBe('gpt-4o-mini');
      expect(r.source).toBe('EMPLOYEE_INSTANCE');
    });

    it('FORCE_DEFAULT 下忽略雇佣关系模型，强制企业默认', async () => {
      prisma.enterpriseModelConfig.findUnique.mockResolvedValue(
        makeConfig({ employeeModelPolicy: 'FORCE_DEFAULT' }),
      );
      prisma.subscription.findUnique.mockResolvedValue({
        config: { modelId: 'gpt-4o-mini' },
      });

      const r = await svc.resolveEffectiveModel({
        userId: 'u1',
        subscriptionId: 'sub-1',
      });

      expect(r.chatModel).toBe('gemini-3.5-flash-high');
      expect(r.source).toBe('ENTERPRISE');
    });

    it('FORCE_DEFAULT 配置了指定模型时优先使用该模型', async () => {
      prisma.enterpriseModelConfig.findUnique.mockResolvedValue(
        makeConfig({
          employeeModelPolicy: 'FORCE_DEFAULT',
          employeeDefaultModel: 'claude-sonnet-5',
        }),
      );

      const r = await svc.resolveEffectiveModel({
        userId: 'u1',
        employeeTemplateModel: 'gpt-4o',
      });

      expect(r.chatModel).toBe('claude-sonnet-5');
      expect(r.source).toBe('ENTERPRISE');
    });

    it('雇佣关系 config 里 modelId 不是字符串时不当成有效值', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        config: { modelId: 42 },
      });

      const r = await svc.resolveEffectiveModel({
        userId: 'u1',
        subscriptionId: 'sub-1',
      });

      expect(r.source).toBe('ENTERPRISE');
    });

    it('③ 部门策略覆盖企业默认', async () => {
      prisma.departmentModelPolicy.findUnique.mockResolvedValue({
        defaultChatModel: 'gemini-3.5-flash',
        allowedChatModels: [],
      });

      const r = await svc.resolveEffectiveModel({
        userId: 'u1',
        departmentId: 'dept-tech',
      });

      expect(r.chatModel).toBe('gemini-3.5-flash');
      expect(r.source).toBe('DEPARTMENT');
    });

    it('部门白名单收窄企业白名单', async () => {
      prisma.enterpriseModelConfig.findUnique.mockResolvedValue(
        makeConfig({ allowedChatModels: ['gpt-4o', 'claude-sonnet-5'] }),
      );
      prisma.departmentModelPolicy.findUnique.mockResolvedValue({
        defaultChatModel: null,
        allowedChatModels: ['gpt-4o'],
      });

      const r = await svc.resolveEffectiveModel({
        userId: 'u1',
        departmentId: 'dept-tech',
      });

      expect(r.allowedChatModels).toEqual(['gpt-4o']);
    });

    it('部门白名单收窄后，原本合法的用户选择被拒', async () => {
      prisma.enterpriseModelConfig.findUnique.mockResolvedValue(
        makeConfig({ allowedChatModels: ['gpt-4o', 'claude-sonnet-5'] }),
      );
      prisma.departmentModelPolicy.findUnique.mockResolvedValue({
        defaultChatModel: 'gpt-4o',
        allowedChatModels: ['gpt-4o'],
      });

      const r = await svc.resolveEffectiveModel({
        userId: 'u1',
        departmentId: 'dept-tech',
        userSelectedModel: 'claude-sonnet-5', // 企业允许，但部门收窄后不允许
      });

      expect(r.source).toBe('DEPARTMENT');
      expect(r.chatModel).toBe('gpt-4o');
    });

    it('部门只设白名单不设默认模型时，不算 DEPARTMENT 来源', async () => {
      prisma.departmentModelPolicy.findUnique.mockResolvedValue({
        defaultChatModel: null,
        allowedChatModels: ['gpt-4o'],
      });

      const r = await svc.resolveEffectiveModel({
        userId: 'u1',
        departmentId: 'dept-tech',
      });

      expect(r.source).toBe('ENTERPRISE');
      expect(r.allowedChatModels).toEqual(['gpt-4o']);
    });

    it('每层都带上知识库字段，不只是 chatModel', async () => {
      prisma.enterpriseModelConfig.findUnique.mockResolvedValue(
        makeConfig({ embeddingModel: 'bge-m3', embeddingBatchSize: 64 }),
      );

      const r = await svc.resolveEffectiveModel({ userId: 'u1' });

      expect(r.embeddingModel).toBe('bge-m3');
      expect(r.embeddingBatchSize).toBe(64);
    });
  });

  describe('预算', () => {
    it('未设预算 = 不限额', async () => {
      const exceeded = await svc.checkBudgetExceeded('ent-acme');
      expect(exceeded).toBe(false);
    });

    it('超预算即为 true —— 与 hardStopOnBudget 无关', async () => {
      prisma.enterpriseModelConfig.findUnique.mockResolvedValue(
        makeConfig({ monthlyBudgetCNY: '1000', hardStopOnBudget: false }),
      );
      // CONSUME 存负数
      prisma.computeTransaction.aggregate.mockResolvedValue({
        _sum: { amount: -1200 },
      });

      expect(await svc.checkBudgetExceeded('ent-acme')).toBe(true);
    });

    it('未超预算为 false', async () => {
      prisma.enterpriseModelConfig.findUnique.mockResolvedValue(
        makeConfig({ monthlyBudgetCNY: '1000' }),
      );
      prisma.computeTransaction.aggregate.mockResolvedValue({
        _sum: { amount: -300 },
      });

      expect(await svc.checkBudgetExceeded('ent-acme')).toBe(false);
    });

    it('没有算力账户时消费按 0 算', async () => {
      prisma.computeAccount.findUnique.mockResolvedValue(null);
      expect(await svc.getMonthlySpentCNY('ent-acme')).toBe(0);
    });

    it('hardStop 开启且超预算 → 抛 403', async () => {
      prisma.enterpriseModelConfig.findUnique.mockResolvedValue(
        makeConfig({ monthlyBudgetCNY: '1000', hardStopOnBudget: true }),
      );
      prisma.computeTransaction.aggregate.mockResolvedValue({
        _sum: { amount: -1500 },
      });

      await expect(svc.assertBudgetAllowsNewSession('ent-acme')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('hardStop 关闭时超预算也放行（只告警）', async () => {
      prisma.enterpriseModelConfig.findUnique.mockResolvedValue(
        makeConfig({ monthlyBudgetCNY: '1000', hardStopOnBudget: false }),
      );
      prisma.computeTransaction.aggregate.mockResolvedValue({
        _sum: { amount: -1500 },
      });

      await expect(
        svc.assertBudgetAllowsNewSession('ent-acme'),
      ).resolves.toBeUndefined();
    });
  });

  describe('权限与租户隔离', () => {
    it('update 要求企业管理员', async () => {
      ctxSvc.assertEnterpriseAdmin.mockImplementation(() => {
        throw new ForbiddenException('仅企业管理员可执行此操作');
      });

      await expect(svc.update('u1', { alertThreshold: 0.5 })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('setDepartmentPolicy 要求企业管理员', async () => {
      ctxSvc.assertEnterpriseAdmin.mockImplementation(() => {
        throw new ForbiddenException('仅企业管理员可执行此操作');
      });

      await expect(
        svc.setDepartmentPolicy('u1', 'dept-tech', { defaultChatModel: 'gpt-4o' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('操作别家企业的部门 → 404（不泄露存在性）', async () => {
      prisma.department.findUnique.mockResolvedValue({
        enterpriseId: 'ent-globex',
      });

      await expect(
        svc.setDepartmentPolicy('u1', 'dept-other', { defaultChatModel: 'gpt-4o' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.departmentModelPolicy.upsert).not.toHaveBeenCalled();
    });

    it('部门不存在 → 404', async () => {
      prisma.department.findUnique.mockResolvedValue(null);

      await expect(
        svc.getDepartmentPolicy('u1', 'nope'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDepartmentPolicy', () => {
    it('未设置策略时返回空策略而非 404，方便前端直接渲染表单', async () => {
      prisma.departmentModelPolicy.findUnique.mockResolvedValue(null);

      const p = await svc.getDepartmentPolicy('u1', 'dept-tech');

      expect(p.id).toBeNull();
      expect(p.departmentId).toBe('dept-tech');
      expect(p.defaultChatModel).toBeNull();
      expect(p.allowedChatModels).toEqual([]);
    });
  });
});
