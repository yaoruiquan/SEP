import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { TransactionType } from '@prisma/client';
import { DICEBEAR_STYLES, generateAvatarUrl, generateSeedFromName } from '../../shared/dicebear-styles';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
  ) {}

  /**
   * 获取企业详情（运营端视角）
   */
  async getEnterpriseDetail(enterpriseId: string) {
    const enterprise = await this.prisma.enterprise.findUnique({
      where: { id: enterpriseId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                avatar: true,
                role: true,
              }
            },
            department: {
              select: {
                id: true,
                name: true,
              }
            }
          },
        },
        subscriptions: {
          include: {
            employee: {
              select: {
                id: true,
                name: true,
                description: true,
              }
            },
          },
        },
        wallet: {
          include: {
            transactions: {
              orderBy: { createdAt: 'desc' },
              take: 20,
            },
          },
        },
        departments: {
          select: {
            id: true,
            name: true,
            parentId: true,
          }
        }
      },
    });

    if (!enterprise) {
      throw new NotFoundException('企业不存在');
    }

    // 余额与流水统一读钱包（EnterpriseWallet / WalletTransaction）。
    // 原先这里 include 的是 ComputeAccount + ComputeTransaction —— 前者是
    // schema 里标注废弃的字段，后者只剩 gateway 链路在写，运营端看到的
    // 余额和流水都对不上企业自己看到的数。
    const { wallet, ...rest } = enterprise;
    return {
      ...rest,
      balance: Number(wallet?.balance ?? 0),
      computeReservedCNY: Number(wallet?.computeReservedCNY ?? 0),
      transactions: (wallet?.transactions ?? []).map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: Number(tx.amount),
        balanceAfter: Number(tx.balanceAfter),
        description: tx.description,
        metadata: tx.metadata,
        createdAt: tx.createdAt,
      })),
    };
  }

  /**
   * 充值/扣减算力
   */
  async creditAdjustment(params: {
    enterpriseId: string;
    amount: number;
    type: 'RECHARGE' | 'DEDUCT';
    note: string;
    operatorId: string;
  }) {
    const { enterpriseId, amount, type, note, operatorId } = params;

    if (amount <= 0) {
      throw new BadRequestException('金额必须大于0');
    }

    // 确保企业存在
    const enterprise = await this.prisma.enterprise.findUnique({
      where: { id: enterpriseId },
    });

    if (!enterprise) {
      throw new NotFoundException('企业不存在');
    }

    // 使用新的钱包系统
    let newBalance: number;

    if (type === 'RECHARGE') {
      // 充值
      const result = await this.walletService.adminDeposit(
        enterpriseId,
        amount,
        note,
        operatorId,
      );
      newBalance = result.balance;
    } else {
      // 扣减
      const result = await this.walletService.adminDeduct(
        enterpriseId,
        amount,
        note,
        operatorId,
      );
      newBalance = result.balance;
    }

    return {
      success: true,
      newBalance,
    };
  }

  /**
   * 冻结企业
   */
  async suspendEnterprise(enterpriseId: string, reason: string, operatorId: string) {
    const enterprise = await this.prisma.enterprise.findUnique({
      where: { id: enterpriseId },
    });

    if (!enterprise) {
      throw new NotFoundException('企业不存在');
    }

    // 检查是否已经被冻结
    const metadata = enterprise.metadata as any;
    if (metadata?.suspended === true) {
      throw new BadRequestException('企业已被冻结');
    }

    await this.prisma.enterprise.update({
      where: { id: enterpriseId },
      data: {
        metadata: {
          ...(metadata || {}),
          suspended: true,
          suspendReason: reason,
          suspendedAt: new Date().toISOString(),
          suspendedBy: operatorId,
        },
      },
    });

    return { success: true };
  }

  /**
   * 解冻企业
   */
  async resumeEnterprise(enterpriseId: string, operatorId: string) {
    const enterprise = await this.prisma.enterprise.findUnique({
      where: { id: enterpriseId },
    });

    if (!enterprise) {
      throw new NotFoundException('企业不存在');
    }

    // 检查是否被冻结
    const metadata = enterprise.metadata as any;
    if (metadata?.suspended !== true) {
      throw new BadRequestException('企业未被冻结');
    }

    await this.prisma.enterprise.update({
      where: { id: enterpriseId },
      data: {
        metadata: {
          ...(metadata || {}),
          suspended: false,
          resumedAt: new Date().toISOString(),
          resumedBy: operatorId,
        },
      },
    });

    return { success: true };
  }

  /**
   * 获取所有企业列表（运营端）
   */
  async listEnterprises(params?: {
    page?: number;
    pageSize?: number;
    keyword?: string;
  }) {
    const { page = 1, pageSize = 20, keyword } = params || {};
    const skip = (page - 1) * pageSize;

    const where = keyword
      ? {
          OR: [
            { name: { contains: keyword, mode: 'insensitive' as const } },
            { description: { contains: keyword, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [enterprises, total] = await Promise.all([
      this.prisma.enterprise.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          // 余额读钱包，不读 ComputeAccount.balance —— 后者已停止写入，
          // 继续读它会让运营端看到一个永远不变的假余额。
          wallet: {
            select: { balance: true },
          },
          _count: {
            select: {
              members: true,
              subscriptions: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.enterprise.count({ where }),
    ]);

    return {
      data: enterprises.map((e) => ({
        ...e,
        balance: Number(e.wallet?.balance ?? 0),
        memberCount: e._count.members,
        subscriptionCount: e._count.subscriptions,
        suspended: (e.metadata as any)?.suspended === true,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取平台级算力交易记录
   */
  /**
   * 平台级资金流水。数据源是 WalletTransaction（唯一主账本），
   * 不再是 ComputeTransaction —— 后者已停止写入。
   *
   * 对外的 type 参数保持 RECHARGE / CONSUME / REFUND 不变，内部映射到钱包类型，
   * 这样运营端筛选器不用跟着改。金额单位是元。
   */
  async getComputeTransactions(params: {
    type?: 'RECHARGE' | 'CONSUME' | 'REFUND';
    enterpriseId?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    pageSize?: number;
  }) {
    const {
      type,
      enterpriseId,
      startDate,
      endDate,
      page = 1,
      pageSize = 20,
    } = params;

    const typeMap = {
      RECHARGE: 'DEPOSIT',
      CONSUME: 'CONSUME',
      REFUND: 'REFUND',
    } as const;

    const where: Prisma.WalletTransactionWhereInput = {
      ...(type && { type: typeMap[type] }),
      ...(enterpriseId && { wallet: { enterpriseId } }),
    };

    if (startDate || endDate) {
      where.createdAt = {
        ...(startDate && { gte: startDate }),
        ...(endDate && { lte: endDate }),
      };
    }

    const [transactions, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        include: {
          wallet: {
            select: {
              enterprise: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.walletTransaction.count({ where }),
    ]);

    const reverseTypeMap: Record<string, 'RECHARGE' | 'CONSUME' | 'REFUND'> = {
      DEPOSIT: 'RECHARGE',
      CONSUME: 'CONSUME',
      REFUND: 'REFUND',
      ADJUSTMENT: 'RECHARGE',
    };

    return {
      data: transactions.map((t) => ({
        id: t.id,
        type: reverseTypeMap[t.type] ?? t.type,
        amount: Number(t.amount),
        balanceAfter: Number(t.balanceAfter),
        description: t.description,
        metadata: t.metadata,
        createdAt: t.createdAt,
        // 算力消费的 relatedId 就是会话 ID（见 WalletService.consumeComputeUpTo）
        sessionId: t.relatedType === 'compute' ? t.relatedId : null,
        enterprise: t.wallet.enterprise,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取员工列表（运营端）
   */
  async listEmployees(params?: {
    status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'DRAFT' | 'ARCHIVED';
    page?: number;
    pageSize?: number;
  }) {
    const { status, page = 1, pageSize = 20 } = params || {};
    const skip = (page - 1) * pageSize;

    const where = status ? { status } : {};

    const [employees, total] = await Promise.all([
      this.prisma.digitalEmployee.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          bindings: {
            include: {
              capability: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                  status: true,
                },
              },
            },
          },
          _count: {
            select: {
              bindings: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.digitalEmployee.count({ where }),
    ]);

    return {
      data: employees,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 审核通过员工模板
   */
  async approveEmployee(employeeId: string, operatorId: string, note?: string) {
    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('员工模板不存在');
    }
    if (employee.status !== 'PENDING') {
      throw new BadRequestException('只能审核待审核状态的员工');
    }

    await this.prisma.digitalEmployee.update({
      where: { id: employeeId },
      data: {
        status: 'APPROVED',
        publishedAt: new Date(),
      },
    });

    return { success: true };
  }

  /**
   * 拒绝员工模板
   */
  async rejectEmployee(employeeId: string, operatorId: string, reason: string) {
    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('员工模板不存在');
    }
    if (employee.status !== 'PENDING') {
      throw new BadRequestException('只能审核待审核状态的员工');
    }

    await this.prisma.digitalEmployee.update({
      where: { id: employeeId },
      data: {
        status: 'REJECTED',
      },
    });

    return { success: true };
  }

  /**
   * 创建员工（运营）
   */
  async createEmployee(data: {
    name: string;
    description?: string;
    industry?: string;
    position?: string;
    avatar?: string;
    systemPrompt?: string;
    modelId?: string;
    maxSteps?: number;
    price?: number;
    annualPriceCNY?: number;
    includedComputeCNY?: number | null;
    operatorId: string;
  }) {
    const employee = await this.prisma.digitalEmployee.create({
      data: {
        name: data.name,
        description: data.description || '',
        industry: data.industry || '通用',
        position: data.position || '通用',
        avatar: data.avatar,
        systemPrompt: data.systemPrompt || '你是一位专业的数字员工，随时准备协助用户完成各项任务。',
        modelId: data.modelId || 'gpt-4o',
        maxSteps: data.maxSteps || 10,
        price: data.price,
        annualPriceCNY: data.annualPriceCNY,
        // null/undefined 都落成 NULL = 「未配置，订阅时取系统默认赠送金额」。
        // 不要 `|| 0`：那会把「未配置」变成运营明确的「不赠送」。
        includedComputeCNY: data.includedComputeCNY ?? undefined,
        status: 'DRAFT',
        version: '1.0.0',
      },
    });

    return employee;
  }

  /**
   * 更新员工
   */
  async updateEmployee(
    employeeId: string,
    data: {
      name?: string;
      description?: string;
      industry?: string;
      position?: string;
      avatar?: string;
      systemPrompt?: string;
      modelId?: string;
      maxSteps?: number;
      price?: number;
      annualPriceCNY?: number;
      includedComputeCNY?: number | null;
    },
    operatorId: string,
  ) {
    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('员工不存在');
    }

    return this.prisma.digitalEmployee.update({
      where: { id: employeeId },
      data: {
        name: data.name,
        description: data.description,
        industry: data.industry,
        position: data.position,
        avatar: data.avatar,
        systemPrompt: data.systemPrompt,
        modelId: data.modelId,
        maxSteps: data.maxSteps,
        price: data.price,
        annualPriceCNY: data.annualPriceCNY,
        // 显式传 null 表示「清除员工级覆盖，回落系统默认值」；
        // 省略字段（undefined）表示不改动。这两者必须区分开。
        includedComputeCNY: data.includedComputeCNY,
      },
    });
  }

  /**
   * 发布员工（运营直接发布，跳过审核）
   */
  async publishEmployee(employeeId: string, operatorId: string) {
    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('员工不存在');
    }
    if (employee.status !== 'DRAFT') {
      throw new BadRequestException('只能发布草稿状态的员工');
    }

    return this.prisma.digitalEmployee.update({
      where: { id: employeeId },
      data: {
        status: 'APPROVED',
        publishedAt: new Date(),
      },
    });
  }

  /**
   * 下架员工
   */
  async archiveEmployee(employeeId: string, operatorId: string) {
    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('员工不存在');
    }
    if (employee.status !== 'APPROVED') {
      throw new BadRequestException('只能下架已发布的员工');
    }

    return this.prisma.digitalEmployee.update({
      where: { id: employeeId },
      data: {
        status: 'ARCHIVED',
      },
    });
  }

  /**
   * 删除员工（仅草稿可删除）
   */
  async deleteEmployee(employeeId: string) {
    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('员工不存在');
    }
    if (employee.status !== 'DRAFT') {
      throw new BadRequestException('只能删除草稿状态的员工');
    }

    await this.prisma.digitalEmployee.delete({
      where: { id: employeeId },
    });

    return { success: true };
  }

  /**
   * 获取员工详情（运营端）
   */
  async getEmployeeDetail(employeeId: string) {
    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: employeeId },
      include: {
        bindings: {
          include: {
            capability: {
              select: {
                id: true,
                name: true,
                type: true,
                status: true,
              },
            },
          },
        },
        _count: {
          select: {
            subscriptions: true,
            sessions: true,
          },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException('员工不存在');
    }

    return employee;
  }

  /**
   * 获取员工的能力绑定列表
   */
  async getEmployeeBindings(employeeId: string) {
    return this.prisma.employeeCapabilityBinding.findMany({
      where: { employeeId },
      include: {
        capability: {
          select: {
            id: true,
            name: true,
            type: true,
            description: true,
            status: true,
          },
        },
      },
      orderBy: { priority: 'desc' },
    });
  }

  /**
   * 批量绑定能力到员工
   */
  async bindCapabilities(employeeId: string, capabilityIds: string[], operatorId: string) {
    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('员工不存在');

    // 验证所有能力都存在
    const capabilities = await this.prisma.capability.findMany({
      where: { id: { in: capabilityIds } },
    });
    if (capabilities.length !== capabilityIds.length) {
      throw new BadRequestException('部分能力不存在');
    }

    const approvedSkillVersions = await this.prisma.skillVersion.findMany({
      where: {
        capabilityId: { in: capabilityIds },
        scope: 'PLATFORM',
        status: 'PLATFORM_APPROVED',
      },
      select: { id: true, capabilityId: true },
      orderBy: { createdAt: 'desc' },
    });
    const defaultVersions = new Map<string, string>();
    for (const version of approvedSkillVersions) {
      if (!defaultVersions.has(version.capabilityId)) {
        defaultVersions.set(version.capabilityId, version.id);
      }
    }

    // 删除现有绑定
    await this.prisma.employeeCapabilityBinding.deleteMany({
      where: { employeeId },
    });

    // 创建新绑定
    const bindings = capabilityIds.map((capabilityId, index) => ({
      employeeId,
      capabilityId,
      priority: capabilityIds.length - index, // 按顺序设置优先级
      enabled: true,
      defaultSkillVersionId: defaultVersions.get(capabilityId),
    }));

    await this.prisma.employeeCapabilityBinding.createMany({
      data: bindings,
    });

    return { success: true, count: bindings.length };
  }

  /**
   * 更新单个绑定的配置
   */
  async updateBinding(bindingId: string, data: {
    priority?: number;
    enabled?: boolean;
    config?: any;
  }) {
    return this.prisma.employeeCapabilityBinding.update({
      where: { id: bindingId },
      data,
    });
  }

  /**
   * 删除绑定
   */
  async removeBinding(bindingId: string) {
    await this.prisma.employeeCapabilityBinding.delete({
      where: { id: bindingId },
    });
    return { success: true };
  }

  /**
   * 获取可用能力列表（用于绑定选择）
   */
  async getAvailableCapabilities() {
    return this.prisma.capability.findMany({
      where: { status: 'APPROVED' }, // 只显示已审核的能力
      select: {
        id: true,
        name: true,
        type: true,
        description: true,
        industry: true,
        position: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * 创建能力（运营）
   */
  async createCapability(data: {
    name: string;
    description: string;
    type: 'AGENT' | 'RPA' | 'SKILL' | 'AI_APP';
    industry: string[];
    position: string[];
    inputSchema: any;
    outputSchema: any;
    agentConfig?: {
      platform: 'COZE' | 'DIFY' | 'N8N' | 'OPENCODE';
      region?: string;
      runtimeKind?: string;
      botId?: string;
      workflowId?: string;
      apiKey?: string;
      workflowUrl?: string;
      webUrl?: string;
      skillName?: string;
    };
    // SKILL 类型专用字段
    zipPath?: string;
    sha256?: string;
    fileCount?: number;
    totalSize?: number;
    operatorId: string;
  }) {
    // 构建 metadata（用于存储 SKILL 类型的文件信息）
    const metadata: any = {};
    if (data.type === 'SKILL' && data.zipPath) {
      metadata.zipPath = data.zipPath;
      metadata.sha256 = data.sha256;
      metadata.fileCount = data.fileCount;
      metadata.totalSize = data.totalSize;
    }

    // 如果是 AGENT 类型且提供了 agentConfig，创建关联的 AgentConfig
    const capability = await this.prisma.capability.create({
      data: {
        name: data.name,
        description: data.description,
        type: data.type,
        industry: data.industry,
        position: data.position,
        inputSchema: data.inputSchema,
        outputSchema: data.outputSchema,
        status: 'PENDING', // 初始为待审核
        contributorId: data.operatorId, // 运营人员作为贡献者
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        ...(data.type === 'AGENT' && data.agentConfig && {
          agentConfig: {
            create: {
              platform: data.agentConfig.platform,
              region: data.agentConfig.region,
              runtimeKind: data.agentConfig.runtimeKind,
              botId: data.agentConfig.botId,
              workflowId: data.agentConfig.workflowId,
              apiKey: data.agentConfig.apiKey,
              workflowUrl: data.agentConfig.workflowUrl,
              webUrl: data.agentConfig.webUrl,
              skillName: data.agentConfig.skillName,
            },
          },
        }),
      },
      include: {
        agentConfig: true,
      },
    });

    return capability;
  }

  /**
   * 获取能力列表（运营端）
   */
  async listCapabilities(params?: {
    status?: 'PENDING' | 'APPROVED' | 'REJECTED';
    type?: 'AGENT' | 'RPA' | 'SKILL' | 'AI_APP';
    page?: number;
    pageSize?: number;
  }) {
    const { status, type, page = 1, pageSize = 20 } = params || {};
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (status) {
      if (status === 'PENDING') {
        // 贡献中心的企业私有草稿也保留 status=PENDING，但不能进入平台审核队列。
        // 只有已获企业管理员授权的投稿（PENDING_REVIEW）或历史无企业能力可见。
        where.OR = [
          { enterpriseId: null, status: 'PENDING' },
          { platformReviewStatus: 'PENDING_REVIEW' },
        ];
      } else if (status === 'APPROVED') {
        where.OR = [
          { visibility: 'MARKET_PUBLIC', platformReviewStatus: 'APPROVED' },
          { enterpriseId: null, status: 'APPROVED' },
        ];
      } else {
        where.status = status;
      }
    }
    if (type) where.type = type;

    const [items, total] = await Promise.all([
      this.prisma.capability.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          contributor: {
            select: { id: true, email: true, name: true },
          },
        },
      }),
      this.prisma.capability.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /**
   * 获取能力详情（运营端）
   */
  async getCapabilityDetail(capabilityId: string) {
    const capability = await this.prisma.capability.findUnique({
      where: { id: capabilityId },
      include: {
        contributor: {
          select: { id: true, email: true, name: true },
        },
        bindings: {
          include: {
            employee: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    if (!capability) throw new NotFoundException('能力不存在');
    return capability;
  }

  /**
   * 更新能力
   */
  async updateCapability(
    capabilityId: string,
    data: {
      name?: string;
      description?: string;
      type?: 'AGENT' | 'RPA' | 'SKILL' | 'AI_APP';
      industry?: string[];
      position?: string[];
      inputSchema?: any;
      outputSchema?: any;
    },
    operatorId: string,
  ) {
    const capability = await this.prisma.capability.findUnique({
      where: { id: capabilityId },
    });

    if (!capability) throw new NotFoundException('能力不存在');

    return this.prisma.capability.update({
      where: { id: capabilityId },
      data: {
        name: data.name,
        description: data.description,
        type: data.type,
        industry: data.industry,
        position: data.position,
        inputSchema: data.inputSchema,
        outputSchema: data.outputSchema,
      },
    });
  }

  /**
   * 提交能力审核
   */
  async submitCapabilityForReview(capabilityId: string, operatorId: string) {
    const capability = await this.prisma.capability.findUnique({
      where: { id: capabilityId },
    });

    if (!capability) throw new NotFoundException('能力不存在');
    if (capability.status === 'APPROVED') {
      throw new BadRequestException('已审核通过的能力无需重新提交');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.capability.update({
        where: { id: capabilityId },
        data: { status: 'PENDING' },
      });
      if (capability.type === 'SKILL') {
        await tx.skillVersion.updateMany({
          where: {
            capabilityId,
            scope: 'PLATFORM',
            status: { in: ['DRAFT', 'PLATFORM_REJECTED'] },
          },
          data: {
            status: 'PENDING_PLATFORM_REVIEW',
            submittedAt: new Date(),
            rejectionReason: null,
          },
        });
      }
      return updated;
    });
  }

  /**
   * 审核通过能力
   */
  async approveCapability(capabilityId: string, operatorId: string, note?: string) {
    const capability = await this.prisma.capability.findUnique({
      where: { id: capabilityId },
    });

    if (!capability) throw new NotFoundException('能力不存在');
    if (capability.status !== 'PENDING') {
      throw new BadRequestException('只能审核待审核状态的能力');
    }

    return this.prisma.$transaction(async (tx) => {
      const reviewedAt = new Date();
      const isContributionSubmission = capability.platformReviewStatus === 'PENDING_REVIEW';
      const updated = await tx.capability.update({
        where: { id: capabilityId },
        data: {
          status: 'APPROVED',
          approvedAt: reviewedAt,
          ...(isContributionSubmission && {
            platformReviewStatus: 'APPROVED',
            visibility: 'MARKET_PUBLIC',
            platformRejectionReason: null,
          }),
        },
      });
      if (capability.type === 'SKILL') {
        const versions = await tx.skillVersion.findMany({
          where: {
            capabilityId,
            scope: 'PLATFORM',
            status: { in: ['DRAFT', 'PENDING_PLATFORM_REVIEW'] },
          },
          select: { id: true },
        });
        if (versions.length > 0) {
          await tx.skillVersion.updateMany({
            where: { id: { in: versions.map(({ id }) => id) } },
            data: {
              status: 'PLATFORM_APPROVED',
              platformReviewedById: operatorId,
              platformReviewedAt: reviewedAt,
              rejectionReason: null,
            },
          });
          await tx.skillVersionReview.createMany({
            data: versions.map(({ id }) => ({
              versionId: id,
              actorType: 'PLATFORM',
              decision: 'APPROVE',
              reviewerId: operatorId,
              comment: note,
            })),
          });
        }
      }
      if (isContributionSubmission) {
        await tx.contributionRewardEvent.createMany({
          data: [{
            recipientId: capability.contributorId,
            enterpriseId: capability.enterpriseId,
            capabilityId: capability.id,
            eventType: 'PLATFORM_APPROVED',
            points: 50,
            dedupeKey: `platform-approved:${capability.id}`,
            metadata: { reviewerId: operatorId },
          }],
          skipDuplicates: true,
        });
      }
      return updated;
    });
  }

  /**
   * 拒绝能力
   */
  async rejectCapability(capabilityId: string, operatorId: string, reason: string) {
    const capability = await this.prisma.capability.findUnique({
      where: { id: capabilityId },
    });

    if (!capability) throw new NotFoundException('能力不存在');
    if (capability.status !== 'PENDING') {
      throw new BadRequestException('只能审核待审核状态的能力');
    }

    return this.prisma.$transaction(async (tx) => {
      const reviewedAt = new Date();
      const isContributionSubmission = capability.platformReviewStatus === 'PENDING_REVIEW';
      const updated = await tx.capability.update({
        where: { id: capabilityId },
        data: {
          status: 'REJECTED',
          ...(isContributionSubmission && {
            platformReviewStatus: 'REJECTED',
            visibility: 'ENTERPRISE_PRIVATE',
            platformRejectionReason: reason,
          }),
        },
      });
      if (capability.type === 'SKILL') {
        const versions = await tx.skillVersion.findMany({
          where: {
            capabilityId,
            scope: 'PLATFORM',
            status: { in: ['DRAFT', 'PENDING_PLATFORM_REVIEW'] },
          },
          select: { id: true },
        });
        if (versions.length > 0) {
          await tx.skillVersion.updateMany({
            where: { id: { in: versions.map(({ id }) => id) } },
            data: {
              status: 'PLATFORM_REJECTED',
              platformReviewedById: operatorId,
              platformReviewedAt: reviewedAt,
              rejectionReason: reason,
            },
          });
          await tx.skillVersionReview.createMany({
            data: versions.map(({ id }) => ({
              versionId: id,
              actorType: 'PLATFORM',
              decision: 'REJECT',
              reviewerId: operatorId,
              comment: reason,
            })),
          });
        }
      }
      return updated;
    });
  }

  /**
   * 删除能力（仅待审核或已拒绝可删除）
   */
  async deleteCapability(capabilityId: string) {
    const capability = await this.prisma.capability.findUnique({
      where: { id: capabilityId },
      include: { bindings: true },
    });

    if (!capability) throw new NotFoundException('能力不存在');
    if (capability.status === 'APPROVED') {
      throw new BadRequestException('已审核通过的能力无法删除，请先将其从所有员工中解绑');
    }
    if (capability.bindings?.length > 0) {
      throw new BadRequestException('能力已被员工绑定，无法删除');
    }

    await this.prisma.capability.delete({
      where: { id: capabilityId },
    });

    return { success: true };
  }

  /**
   * 运营仪表盘统计数据
   */
  async getStats() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    // 上月末（用于 MoM 环比）
    const prevMonthEnd = new Date();
    prevMonthEnd.setDate(0);
    prevMonthEnd.setHours(23, 59, 59, 999);

    const yesterdayStart = new Date(todayStart.getTime() - 86400000);

    const [
      totalEnterprises,
      suspendedEnterprises,
      totalEmployees,
      pendingEmployees,
      todayConsumeTx,
      yesterdayConsumeTx,
      todayConversations,
      yesterdayConversations,
      prevMonthEnterprises,
      prevMonthEmployees,
      pendingCapabilities,
      computeTx30,
      enterprises30,
      topAccountsRaw,
      topEmployeesRaw,
    ] = await Promise.all([
      this.prisma.enterprise.count(),
      // 冻结状态存在 metadata JSON 里，不是独立字段
      this.prisma.enterprise.count({
        where: { metadata: { path: ['suspended'], equals: true } },
      }),
      this.prisma.digitalEmployee.count({ where: { status: 'APPROVED' } }),
      this.prisma.digitalEmployee.count({ where: { status: 'PENDING' } }),
      // 今日算力消费。统一人民币口径后数据源是 ComputeUsageRecord ——
      // ComputeTransaction 已停止写入，继续读它会让运营看板从改版当天起冻结。
      this.prisma.computeUsageRecord.aggregate({
        where: { createdAt: { gte: todayStart, lte: todayEnd } },
        _sum: { costCNY: true, inputTokens: true, outputTokens: true },
      }),
      // 昨日算力消费（用于趋势比较）
      this.prisma.computeUsageRecord.aggregate({
        where: { createdAt: { gte: yesterdayStart, lt: todayStart } },
        _sum: { costCNY: true, inputTokens: true, outputTokens: true },
      }),
      // 今日活跃用户（有会话的不重复用户数）
      this.prisma.conversationSession.findMany({
        where: { createdAt: { gte: todayStart, lte: todayEnd } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      // 昨日活跃用户
      this.prisma.conversationSession.findMany({
        where: { createdAt: { gte: yesterdayStart, lt: todayStart } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      // 上月企业总数（用于 MoM 趋势）
      this.prisma.enterprise.count({
        where: { createdAt: { lte: prevMonthEnd } },
      }),
      // 上月员工数
      this.prisma.digitalEmployee.count({
        where: { status: 'APPROVED', createdAt: { lte: prevMonthEnd } },
      }),
      // 待审核能力
      this.prisma.capability.count({ where: { status: 'PENDING' } }),
      // 近 30 天按日汇总的算力消费
      this.prisma.computeUsageRecord.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: {
          costCNY: true,
          inputTokens: true,
          outputTokens: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      // 近 30 天企业注册记录
      this.prisma.enterprise.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      // Top 10 企业（按算力消费金额）。ComputeUsageRecord 自带 enterpriseId，
      // 不必再像旧的 ComputeTransaction 那样绕 accountId 回查。
      this.prisma.computeUsageRecord.groupBy({
        by: ['enterpriseId'],
        _sum: { costCNY: true, inputTokens: true, outputTokens: true },
        orderBy: { _sum: { costCNY: 'desc' } },
        take: 10,
      }),
      // Top 10 员工（按会话数）
      this.prisma.conversationSession.groupBy({
        by: ['employeeId'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
    ]);

    // ── 计算 KPI trends ────────────────────────────────────────────
    const enterpriseTrendPct =
      prevMonthEnterprises > 0
        ? +((((totalEnterprises - prevMonthEnterprises) / prevMonthEnterprises) * 100).toFixed(1))
        : 0;

    const employeeTrendPct =
      prevMonthEmployees > 0
        ? +((((totalEmployees - prevMonthEmployees) / prevMonthEmployees) * 100).toFixed(1))
        : 0;

    // Token 仍作为用量指标展示（它反映调用规模），但趋势按**人民币成本**算 ——
    // 换模型会让同样的 token 数对应完全不同的成本，token 趋势会误导。
    const todayTokens =
      (todayConsumeTx._sum.inputTokens ?? 0) +
      (todayConsumeTx._sum.outputTokens ?? 0);
    const yesterdayTokens =
      (yesterdayConsumeTx._sum.inputTokens ?? 0) +
      (yesterdayConsumeTx._sum.outputTokens ?? 0);
    const todayCostCNY = Number(todayConsumeTx._sum.costCNY ?? 0);
    const yesterdayCostCNY = Number(yesterdayConsumeTx._sum.costCNY ?? 0);
    const tokenTrendPct =
      yesterdayCostCNY > 0
        ? +(((todayCostCNY - yesterdayCostCNY) / yesterdayCostCNY) * 100).toFixed(1)
        : 0;

    const todayActiveUsers = todayConversations.length;
    const yesterdayActiveUsers = yesterdayConversations.length;
    const userTrendPct =
      yesterdayActiveUsers > 0
        ? +(((todayActiveUsers - yesterdayActiveUsers) / yesterdayActiveUsers) * 100).toFixed(1)
        : 0;

    // ── 近 30 天趋势：按日汇总 ──────────────────────────────────────
    const dayMap = new Map<string, { tokens: number; costCNY: number }>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo.getTime() + i * 86400000);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      dayMap.set(key, { tokens: 0, costCNY: 0 });
    }
    for (const usage of computeTx30) {
      const d = usage.createdAt;
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      const bucket = dayMap.get(key) ?? { tokens: 0, costCNY: 0 };
      bucket.tokens += usage.inputTokens + usage.outputTokens;
      bucket.costCNY += Number(usage.costCNY);
      dayMap.set(key, bucket);
    }
    const computeTrend = Array.from(dayMap.entries()).map(([date, bucket]) => ({
      date,
      tokens: bucket.tokens,
      costCNY: +bucket.costCNY.toFixed(2),
    }));

    const entDayMap = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo.getTime() + i * 86400000);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      entDayMap.set(key, 0);
    }
    for (const ent of enterprises30) {
      const d = ent.createdAt;
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      entDayMap.set(key, (entDayMap.get(key) ?? 0) + 1);
    }
    const enterpriseTrend = Array.from(entDayMap.entries()).map(([date, count]) => ({
      date,
      count,
    }));

    // ── Top 10 企业：enterpriseId → 企业名称 ──────────────────────
    const topEnterpriseIds = topAccountsRaw.map((r) => r.enterpriseId);

    const topEnterpriseRows = await this.prisma.enterprise.findMany({
      where: { id: { in: topEnterpriseIds } },
      select: { id: true, name: true },
    });
    const enterpriseNameMap = new Map(
      topEnterpriseRows.map((e) => [e.id, e.name]),
    );

    const topEnterprises = topAccountsRaw.map((r) => ({
      id: r.enterpriseId,
      name: enterpriseNameMap.get(r.enterpriseId) ?? '未知企业',
      tokens: (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0),
      costCNY: +Number(r._sum.costCNY ?? 0).toFixed(2),
    }));

    // ── Top 10 员工：补全名称 ──────────────────────────────────────
    const topEmployeeIds = topEmployeesRaw.map((r) => r.employeeId);
    const topEmployeeDetails = await this.prisma.digitalEmployee.findMany({
      where: { id: { in: topEmployeeIds } },
      select: { id: true, name: true, bindings: { select: { capability: { select: { type: true } } }, take: 1 } },
    });
    const empDetailMap = new Map(topEmployeeDetails.map((e) => [e.id, e]));

    const topEmployees = topEmployeesRaw.map((r) => {
      const detail = empDetailMap.get(r.employeeId);
      const firstType = detail?.bindings?.[0]?.capability?.type ?? 'AGENT';
      return {
        id: r.employeeId,
        name: detail?.name ?? '未知员工',
        type: firstType,
        calls: r._count.id,
      };
    });

    return {
      kpi: {
        totalEnterprises,
        suspendedEnterprises,
        enterpriseTrendPct,
        totalEmployees,
        pendingEmployees,
        employeeTrendPct,
        pendingCapabilities,
        todayTokens,
        /** 今日算力消费（元）—— 财务口径的主指标 */
        todayCostCNY: +todayCostCNY.toFixed(2),
        /** 趋势按人民币成本算，见上方注释 */
        tokenTrendPct,
        todayActiveUsers,
        userTrendPct,
      },
      computeTrend,
      enterpriseTrend,
      topEnterprises,
      topEmployees,
    };
  }

  /**
   * 提交员工审核（替代原 publishEmployee）
   */
  async submitEmployeeForReview(employeeId: string, operatorId: string) {
    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) throw new NotFoundException('员工不存在');
    if (employee.status !== 'DRAFT') {
      throw new BadRequestException('只能提交草稿状态的员工');
    }

    return this.prisma.digitalEmployee.update({
      where: { id: employeeId },
      data: {
        status: 'PENDING', // 进入待审核
      },
    });
  }

  /**
   * 获取所有可用的头像风格列表
   */
  async getAvatarStyles() {
    // 为每个风格生成3个示例头像
    const stylesWithExamples = DICEBEAR_STYLES.map(style => ({
      ...style,
      examples: [
        generateAvatarUrl(style.id, `example-1-${style.id}`),
        generateAvatarUrl(style.id, `example-2-${style.id}`),
        generateAvatarUrl(style.id, `example-3-${style.id}`),
      ],
    }));

    return {
      styles: stylesWithExamples,
      total: stylesWithExamples.length,
      recommended: stylesWithExamples.filter(s => s.recommended),
    };
  }

  /**
   * 批量更新所有员工的头像风格
   */
  async batchUpdateAvatarStyle(styleId: string, operatorId: string) {
    // 验证风格是否存在
    const style = DICEBEAR_STYLES.find(s => s.id === styleId);
    if (!style) {
      throw new BadRequestException(`头像风格 ${styleId} 不存在`);
    }

    // 获取所有员工
    const employees = await this.prisma.digitalEmployee.findMany({
      select: { id: true, name: true, position: true },
    });

    if (employees.length === 0) {
      return { success: true, updated: 0 };
    }

    // 批量更新
    const updatePromises = employees.map(emp => {
      const seed = generateSeedFromName(emp.position || emp.name);
      const avatarUrl = generateAvatarUrl(styleId, seed);

      return this.prisma.digitalEmployee.update({
        where: { id: emp.id },
        data: { avatar: avatarUrl },
      });
    });

    await Promise.all(updatePromises);

    return {
      success: true,
      updated: employees.length,
      style: style.name,
    };
  }

  /**
   * 更新单个员工的头像风格
   */
  async updateEmployeeAvatarStyle(
    employeeId: string,
    styleId: string,
    operatorId: string,
  ) {
    // 验证风格是否存在
    const style = DICEBEAR_STYLES.find(s => s.id === styleId);
    if (!style) {
      throw new BadRequestException(`头像风格 ${styleId} 不存在`);
    }

    // 验证员工是否存在
    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: employeeId },
      select: { id: true, name: true, position: true },
    });

    if (!employee) {
      throw new NotFoundException('员工不存在');
    }

    // 生成新头像 URL
    const seed = generateSeedFromName(employee.position || employee.name);
    const avatarUrl = generateAvatarUrl(styleId, seed);

    // 更新
    return this.prisma.digitalEmployee.update({
      where: { id: employeeId },
      data: { avatar: avatarUrl },
    });
  }
}
