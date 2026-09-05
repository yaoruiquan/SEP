import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    private readonly config?: ConfigService,
  ) {}

  private getEffectiveEmbeddingConfig() {
    const model = this.config?.get<string>('EMBEDDING_MODEL') ?? 'bge-m3:latest';
    const batchSize = Number(this.config?.get<string>('EMBEDDING_BATCH_SIZE') ?? 32);
    const timeoutMs = Number(this.config?.get<string>('EMBEDDING_TIMEOUT_MS') ?? 30000);
    return {
      embeddingModel: model,
      embeddingBatchSize: Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 32,
      embeddingTimeoutMs: Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000,
    };
  }

  private serializeConfig(config: any) {
    return {
      ...config,
      ...this.getEffectiveEmbeddingConfig(),
      embeddingModelSource: 'platform' as const,
      monthlyBudgetCNY: config.monthlyBudgetCNY?.toString() ?? null,
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    };
  }

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
          ...this.getEffectiveEmbeddingConfig(),
          employeeModelPolicy: 'FOLLOW_TEMPLATE',
          alertThreshold: 0.8,
          hardStopOnBudget: false,
        },
      });
    }

    return this.serializeConfig(config);
  }

  async update(userId: string, dto: UpdateEnterpriseModelConfigDto) {
    const context = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(context);

    await this.get(userId);
    await this.assertSelectableModels(dto);

    const updated = await this.prisma.enterpriseModelConfig.update({
      where: { enterpriseId: context.enterpriseId },
      data: {
        ...(dto.defaultChatModel !== undefined && { defaultChatModel: dto.defaultChatModel }),
        ...(dto.allowedChatModels !== undefined && { allowedChatModels: dto.allowedChatModels }),
        ...(dto.allowUserSwitchModel !== undefined && { allowUserSwitchModel: dto.allowUserSwitchModel }),
        ...(dto.rerankModel !== undefined && { rerankModel: dto.rerankModel }),
        ...(dto.employeeModelPolicy !== undefined && { employeeModelPolicy: dto.employeeModelPolicy }),
        ...(dto.employeeDefaultModel !== undefined && { employeeDefaultModel: dto.employeeDefaultModel }),
        ...(dto.monthlyBudgetCNY !== undefined && {
          monthlyBudgetCNY: dto.monthlyBudgetCNY !== null ? dto.monthlyBudgetCNY : null,
        }),
        ...(dto.alertThreshold !== undefined && { alertThreshold: dto.alertThreshold }),
        ...(dto.hardStopOnBudget !== undefined && { hardStopOnBudget: dto.hardStopOnBudget }),
      },
    });

    return this.serializeConfig(updated);
  }

  /**
   * 把「默认模型 / 白名单」限制在平台已启用且上游仍在的模型内。
   *
   * 不校验的代价是真实的：某企业的 defaultChatModel 曾被设成 `gemini-3.5-flash`，
   * 而中转对它的流式请求一个字节都不回 —— 该企业每次对话都停在「正在输入」，
   * 而配置页看不出任何异常。写入时挡住，比事后从日志里刨要便宜得多。
   *
   * 只校验「是不是平台启用的模型」这一层：具体能不能跑由
   * `POST /models/:id/test`（按流式测）回答，那是运营启用模型时的关卡。
   */
  private async assertSelectableModels(dto: UpdateEnterpriseModelConfigDto) {
    const wanted = [
      dto.defaultChatModel,
      dto.employeeDefaultModel,
      ...(dto.allowedChatModels ?? []),
    ].filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (wanted.length === 0) return;

    const rows = await this.prisma.platformModel.findMany({
      where: { modelId: { in: [...new Set(wanted)] } },
      select: { modelId: true, enabled: true, isStale: true },
    });
    const byId = new Map(rows.map((r) => [r.modelId, r]));

    for (const id of new Set(wanted)) {
      const row = byId.get(id);
      if (!row) {
        throw new BadRequestException(
          `模型 ${id} 不在平台模型库中。请先在运营端「系统设置 → 模型管理」同步上游并启用。`,
        );
      }
      if (row.isStale) {
        throw new BadRequestException(`模型 ${id} 已从上游下架，不能再选用。`);
      }
      if (!row.enabled) {
        throw new BadRequestException(`模型 ${id} 未被平台启用，请联系平台运营。`);
      }
    }
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
      ...this.getEffectiveEmbeddingConfig(),
      rerankModel: config.rerankModel,
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
