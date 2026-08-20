import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import {
  UpdateEnterpriseModelConfigDto,
  UpdateDepartmentModelPolicyDto,
  EffectiveModelConfig,
  AvailableModel,
} from '../../shared/model-config.dto';
import { DEFAULT_MODEL_ID } from '../../shared';


@Injectable()
export class EnterpriseModelConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: EnterpriseContextService,
  ) {}

  async get(userId: string) {
    const context = await this.ctx.resolve(userId);

    let config = await this.prisma.enterpriseModelConfig.findUnique({
      where: { enterpriseId: context.enterpriseId },
    });

    if (!config) {
      config = await this.prisma.enterpriseModelConfig.create({
        data: {
          enterpriseId: context.enterpriseId,
          defaultChatModel: DEFAULT_MODEL_ID,
          allowedChatModels: [],
          allowUserSwitchModel: true,
          embeddingModel: 'text-embedding-3-small',
          embeddingBatchSize: 32,
          embeddingTimeoutMs: 30000,
          employeeModelPolicy: 'FOLLOW_TEMPLATE',
          alertThreshold: 0.8,
          hardStopOnBudget: false,
        },
      });
    }

    return {
      ...config,
      monthlyBudgetCNY: config.monthlyBudgetCNY?.toString() ?? null,
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    };
  }

  async update(userId: string, dto: UpdateEnterpriseModelConfigDto) {
    const context = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(context);

    await this.get(userId);

    const updated = await this.prisma.enterpriseModelConfig.update({
      where: { enterpriseId: context.enterpriseId },
      data: {
        ...(dto.defaultChatModel !== undefined && { defaultChatModel: dto.defaultChatModel }),
        ...(dto.allowedChatModels !== undefined && { allowedChatModels: dto.allowedChatModels }),
        ...(dto.allowUserSwitchModel !== undefined && { allowUserSwitchModel: dto.allowUserSwitchModel }),
        ...(dto.embeddingModel !== undefined && { embeddingModel: dto.embeddingModel }),
        ...(dto.rerankModel !== undefined && { rerankModel: dto.rerankModel }),
        ...(dto.embeddingBatchSize !== undefined && { embeddingBatchSize: dto.embeddingBatchSize }),
        ...(dto.embeddingTimeoutMs !== undefined && { embeddingTimeoutMs: dto.embeddingTimeoutMs }),
        ...(dto.employeeModelPolicy !== undefined && { employeeModelPolicy: dto.employeeModelPolicy }),
        ...(dto.employeeDefaultModel !== undefined && { employeeDefaultModel: dto.employeeDefaultModel }),
        ...(dto.monthlyBudgetCNY !== undefined && {
          monthlyBudgetCNY: dto.monthlyBudgetCNY !== null ? dto.monthlyBudgetCNY : null,
        }),
        ...(dto.alertThreshold !== undefined && { alertThreshold: dto.alertThreshold }),
        ...(dto.hardStopOnBudget !== undefined && { hardStopOnBudget: dto.hardStopOnBudget }),
      },
    });

    return {
      ...updated,
      monthlyBudgetCNY: updated.monthlyBudgetCNY?.toString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async getAvailableModels(userId: string): Promise<AvailableModel[]> {
    await this.ctx.resolve(userId);

    const models = await this.prisma.platformModel.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      select: {
        modelId: true,
        label: true,
        vendor: true,
        category: true,
        contextLength: true,
        maxOutputTokens: true,
        pricingInputPer1M: true,
        pricingOutputPer1M: true,
        supportedFeatures: true,
        description: true,
      },
    });

    // modelId 是调用模型时的标识，不能用主键 cuid 代替。
    // 元数据列大多为空（等同步任务补齐），保持 null 让前端降级展示。
    return models.map((m) => ({
      modelId: m.modelId,
      label: m.label,
      vendor: m.vendor,
      category: m.category,
      contextLength: m.contextLength,
      maxOutputTokens: m.maxOutputTokens,
      pricingInputPer1M: m.pricingInputPer1M?.toString() ?? null,
      pricingOutputPer1M: m.pricingOutputPer1M?.toString() ?? null,
      supportedFeatures:
        m.supportedFeatures && typeof m.supportedFeatures === 'object'
          ? (m.supportedFeatures as Record<string, unknown>)
          : null,
      description: m.description,
    }));
  }

  async resolveEffectiveModel(opts: {
    userId: string;
    userSelectedModel?: string;
    /** 雇佣关系 id。收敛前是 employeeInstanceId。 */
    subscriptionId?: string;
    /** 员工模板自带模型：订阅未单独配置时的兜底（FOLLOW_TEMPLATE 语义） */
    employeeTemplateModel?: string | null;
    departmentId?: string;
  }): Promise<EffectiveModelConfig> {
    const context = await this.ctx.resolve(opts.userId);
    const config = await this.get(opts.userId);
    const budgetExceeded = await this.checkBudgetExceeded(context.enterpriseId);

    // 所有分支共享的知识库/开关字段，只有 chatModel 与 allowedChatModels 会被覆盖
    const base = {
      allowedChatModels: config.allowedChatModels,
      allowUserSwitchModel: config.allowUserSwitchModel,
      embeddingModel: config.embeddingModel,
      rerankModel: config.rerankModel,
      embeddingBatchSize: config.embeddingBatchSize,
      embeddingTimeoutMs: config.embeddingTimeoutMs,
      budgetExceeded,
    };

    // 部门策略先解析：它同时影响用户可选范围（白名单收窄）
    let deptPolicy: { defaultChatModel: string | null; allowedChatModels: string[] } | null =
      null;
    if (opts.departmentId) {
      deptPolicy = await this.prisma.departmentModelPolicy.findUnique({
        where: { departmentId: opts.departmentId },
        select: { defaultChatModel: true, allowedChatModels: true },
      });
    }

    const allowed =
      deptPolicy && deptPolicy.allowedChatModels.length > 0
        ? deptPolicy.allowedChatModels
        : config.allowedChatModels;

    // 1. 用户显式选择（需开关允许且落在白名单内）
    if (opts.userSelectedModel && config.allowUserSwitchModel) {
      const isAllowed = allowed.length === 0 || allowed.includes(opts.userSelectedModel);
      if (isAllowed) {
        return {
          ...base,
          chatModel: opts.userSelectedModel,
          allowedChatModels: allowed,
          source: 'USER_CHOICE',
        };
      }
    }

    // 管理员关闭会话模型切换时，配置页承诺强制使用默认模型。
    // 此时不能继续落到员工模板，否则界面虽已锁定，实际请求仍可能走模板里的模型。
    if (!config.allowUserSwitchModel) {
      if (deptPolicy?.defaultChatModel) {
        return {
          ...base,
          chatModel: deptPolicy.defaultChatModel,
          allowedChatModels: allowed,
          source: 'DEPARTMENT',
        };
      }

      return {
        ...base,
        chatModel: config.defaultChatModel || DEFAULT_MODEL_ID,
        allowedChatModels: allowed,
        source: config.defaultChatModel ? 'ENTERPRISE' : 'SYSTEM_DEFAULT',
      };
    }

    // 2. 员工自带模型（仅 FOLLOW_TEMPLATE 策略下生效）
    //    订阅 config.modelId 优先于模板 modelId：订阅是管理员对单个员工的微调。
    //    FORCE_DEFAULT 时整段跳过，使用员工策略中指定的统一模型。
    if (config.employeeModelPolicy === 'FOLLOW_TEMPLATE') {
      let modelId: string | null = null;

      if (opts.subscriptionId) {
        const subscription = await this.prisma.subscription.findUnique({
          where: { id: opts.subscriptionId },
          select: { config: true },
        });
        const raw = subscription?.config as { modelId?: unknown } | null;
        if (typeof raw?.modelId === 'string') modelId = raw.modelId;
      }

      if (!modelId && opts.employeeTemplateModel) {
        modelId = opts.employeeTemplateModel;
      }

      if (modelId) {
        return {
          ...base,
          chatModel: modelId,
          allowedChatModels: allowed,
          source: 'EMPLOYEE_INSTANCE',
        };
      }
    }

    if (config.employeeModelPolicy === 'FORCE_DEFAULT' && config.employeeDefaultModel) {
      return {
        ...base,
        chatModel: config.employeeDefaultModel,
        allowedChatModels: allowed,
        source: 'ENTERPRISE',
      };
    }

    // 3. 部门默认模型
    if (deptPolicy?.defaultChatModel) {
      return {
        ...base,
        chatModel: deptPolicy.defaultChatModel,
        allowedChatModels: allowed,
        source: 'DEPARTMENT',
      };
    }

    // 4. 企业默认模型
    if (config.defaultChatModel) {
      return {
        ...base,
        chatModel: config.defaultChatModel,
        allowedChatModels: allowed,
        source: 'ENTERPRISE',
      };
    }

    // 5. 系统兜底
    return {
      ...base,
      chatModel: DEFAULT_MODEL_ID,
      allowedChatModels: allowed,
      source: 'SYSTEM_DEFAULT',
    };
  }

  /** 读取部门模型策略；未设置时返回空策略而非 404，方便前端直接渲染表单。 */
  async getDepartmentPolicy(userId: string, departmentId: string) {
    const context = await this.ctx.resolve(userId);
    await this.assertDepartmentInEnterprise(departmentId, context.enterpriseId);

    const policy = await this.prisma.departmentModelPolicy.findUnique({
      where: { departmentId },
    });

    if (!policy) {
      return {
        id: null,
        departmentId,
        defaultChatModel: null,
        allowedChatModels: [] as string[],
        createdAt: null,
        updatedAt: null,
      };
    }

    return {
      ...policy,
      createdAt: policy.createdAt.toISOString(),
      updatedAt: policy.updatedAt.toISOString(),
    };
  }

  /** 设置部门模型策略（仅企业管理员）。defaultChatModel=null 表示回退到企业配置。 */
  async setDepartmentPolicy(
    userId: string,
    departmentId: string,
    dto: UpdateDepartmentModelPolicyDto,
  ) {
    const context = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(context);
    await this.assertDepartmentInEnterprise(departmentId, context.enterpriseId);

    const policy = await this.prisma.departmentModelPolicy.upsert({
      where: { departmentId },
      create: {
        departmentId,
        defaultChatModel: dto.defaultChatModel ?? null,
        allowedChatModels: dto.allowedChatModels ?? [],
      },
      update: {
        ...(dto.defaultChatModel !== undefined && {
          defaultChatModel: dto.defaultChatModel,
        }),
        ...(dto.allowedChatModels !== undefined && {
          allowedChatModels: dto.allowedChatModels,
        }),
      },
    });

    return {
      ...policy,
      createdAt: policy.createdAt.toISOString(),
      updatedAt: policy.updatedAt.toISOString(),
    };
  }

  /** 防止跨企业越权操作别人的部门。 */
  private async assertDepartmentInEnterprise(departmentId: string, enterpriseId: string) {
    const dept = await this.prisma.department.findUnique({
      where: { id: departmentId },
      select: { enterpriseId: true },
    });

    if (!dept || dept.enterpriseId !== enterpriseId) {
      throw new NotFoundException(`部门 ${departmentId} 不存在`);
    }
  }

  /**
   * 本月消费额（元）。CONSUME 的 amount 存的是负数，这里取绝对值。
   *
   * 用聚合而不是把当月流水全查回来再 reduce —— 单个企业一个月的调用量
   * 可以到几十万条，全量载入内存没有必要。
   */
  async getMonthlySpentCNY(enterpriseId: string): Promise<number> {
    const account = await this.prisma.computeAccount.findUnique({
      where: { enterpriseId },
      select: { id: true },
    });
    if (!account) return 0;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const agg = await this.prisma.computeTransaction.aggregate({
      where: {
        accountId: account.id,
        type: 'CONSUME',
        createdAt: { gte: startOfMonth },
      },
      _sum: { amount: true },
    });

    return Math.abs(agg._sum.amount ?? 0);
  }

  /**
   * 本月是否已超预算 —— 这是**事实判断**，与 hardStopOnBudget 无关。
   *
   * 故意不在这里合并 hardStop：调用方需要区分「超了但只告警」和
   * 「超了且要拦截」。把两件事塞进一个 boolean 会让 budgetExceeded
   * 在只告警的企业里永远是 false，前端就没法提示了。
   * 需要拦截判断的走 assertBudgetAllowsNewSession()。
   */
  async checkBudgetExceeded(enterpriseId: string): Promise<boolean> {
    const config = await this.prisma.enterpriseModelConfig.findUnique({
      where: { enterpriseId },
      select: { monthlyBudgetCNY: true },
    });

    // 没设预算 = 不限额
    if (!config?.monthlyBudgetCNY) return false;

    const spent = await this.getMonthlySpentCNY(enterpriseId);
    return spent >= Number(config.monthlyBudgetCNY);
  }

  /**
   * 超预算且开启硬性阻断时抛 403，供会话入口调用。
   */
  async assertBudgetAllowsNewSession(enterpriseId: string): Promise<void> {
    const config = await this.prisma.enterpriseModelConfig.findUnique({
      where: { enterpriseId },
      select: { monthlyBudgetCNY: true, hardStopOnBudget: true },
    });

    if (!config?.monthlyBudgetCNY || !config.hardStopOnBudget) return;

    const spent = await this.getMonthlySpentCNY(enterpriseId);
    if (spent >= Number(config.monthlyBudgetCNY)) {
      throw new ForbiddenException('企业本月算力预算已用尽');
    }
  }
}
