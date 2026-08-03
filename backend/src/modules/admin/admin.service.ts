import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TransactionType } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

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
        instances: {
          select: {
            id: true,
            name: true,
            status: true,
            templateId: true,
            templateVersion: true,
            createdAt: true,
            template: {
              select: {
                id: true,
                name: true,
                description: true,
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
        computeAccount: {
          include: {
            transactions: {
              orderBy: { createdAt: 'desc' },
              take: 20,
            },
          }
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

    return enterprise;
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
      include: {
        computeAccount: true,
      }
    });

    if (!enterprise) {
      throw new NotFoundException('企业不存在');
    }

    // 如果企业还没有算力账户，先创建
    let computeAccount = enterprise.computeAccount;
    if (!computeAccount) {
      computeAccount = await this.prisma.computeAccount.create({
        data: {
          enterpriseId,
          balance: 0,
        }
      });
    }

    // 扣减时检查余额是否足够
    if (type === 'DEDUCT' && computeAccount.balance < amount) {
      throw new BadRequestException('余额不足');
    }

    const actualAmount = type === 'RECHARGE' ? amount : -amount;
    const transactionType: TransactionType = type === 'RECHARGE' ? 'RECHARGE' : 'CONSUME';

    // 使用事务确保一致性
    const result = await this.prisma.$transaction(async (tx) => {
      // 记录交易
      await tx.computeTransaction.create({
        data: {
          accountId: computeAccount.id,
          amount: actualAmount,
          type: transactionType,
          description: note,
          metadata: { operatorId, operatedAt: new Date().toISOString() },
        },
      });

      // 更新余额
      const updatedAccount = await tx.computeAccount.update({
        where: { id: computeAccount.id },
        data: { balance: { increment: actualAmount } },
      });

      return updatedAccount;
    });

    return {
      success: true,
      newBalance: result.balance,
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
          computeAccount: {
            select: {
              balance: true,
            },
          },
          _count: {
            select: {
              members: true,
              instances: true,
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
        balance: e.computeAccount?.balance || 0,
        memberCount: e._count.members,
        instanceCount: e._count.instances,
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

    const where: any = {};

    // Filter by transaction type
    if (type) {
      where.type = type;
    }

    // Filter by enterprise (through account relationship)
    if (enterpriseId) {
      where.account = {
        enterpriseId,
      };
    }

    // Filter by date range
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = startDate;
      }
      if (endDate) {
        where.createdAt.lte = endDate;
      }
    }

    const [transactions, total] = await Promise.all([
      this.prisma.computeTransaction.findMany({
        where,
        include: {
          account: {
            include: {
              enterprise: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.computeTransaction.count({ where }),
    ]);

    return {
      data: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        description: t.description,
        metadata: t.metadata,
        createdAt: t.createdAt,
        sessionId: t.sessionId,
        enterprise: t.account.enterprise,
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
            instances: true,
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
    operatorId: string;
  }) {
    return this.prisma.capability.create({
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
      },
    });
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
    if (status) where.status = status;
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

    return this.prisma.capability.update({
      where: { id: capabilityId },
      data: { status: 'PENDING' },
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

    return this.prisma.capability.update({
      where: { id: capabilityId },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
      },
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

    return this.prisma.capability.update({
      where: { id: capabilityId },
      data: {
        status: 'REJECTED',
      },
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
      // 今日算力消费
      this.prisma.computeTransaction.aggregate({
        where: { type: 'CONSUME', createdAt: { gte: todayStart, lte: todayEnd } },
        _sum: { amount: true },
      }),
      // 昨日算力消费（用于趋势比较）
      this.prisma.computeTransaction.aggregate({
        where: {
          type: 'CONSUME',
          createdAt: { gte: yesterdayStart, lt: todayStart },
        },
        _sum: { amount: true },
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
      this.prisma.computeTransaction.findMany({
        where: { type: 'CONSUME', createdAt: { gte: thirtyDaysAgo } },
        select: { amount: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      // 近 30 天企业注册记录
      this.prisma.enterprise.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      // Top 10 企业（按算力消费 sum）
      // ComputeTransaction 没有 enterpriseId，只能按 accountId 聚合后再回查企业
      this.prisma.computeTransaction.groupBy({
        by: ['accountId'],
        where: { type: 'CONSUME' },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'asc' } }, // 消费是负数，升序 = 消费最多
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

    const todayTokens = Math.abs(Number(todayConsumeTx._sum.amount ?? 0));
    const yesterdayTokens = Math.abs(Number(yesterdayConsumeTx._sum.amount ?? 0));
    const tokenTrendPct =
      yesterdayTokens > 0
        ? +(((todayTokens - yesterdayTokens) / yesterdayTokens) * 100).toFixed(1)
        : 0;

    const todayActiveUsers = todayConversations.length;
    const yesterdayActiveUsers = yesterdayConversations.length;
    const userTrendPct =
      yesterdayActiveUsers > 0
        ? +(((todayActiveUsers - yesterdayActiveUsers) / yesterdayActiveUsers) * 100).toFixed(1)
        : 0;

    // ── 近 30 天趋势：按日汇总 ──────────────────────────────────────
    const dayMap = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo.getTime() + i * 86400000);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      dayMap.set(key, 0);
    }
    for (const tx of computeTx30) {
      const d = tx.createdAt;
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      dayMap.set(key, (dayMap.get(key) ?? 0) + Math.abs(Number(tx.amount)));
    }
    const computeTrend = Array.from(dayMap.entries()).map(([date, tokens]) => ({
      date,
      tokens: Math.round(tokens),
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

    // ── Top 10 企业：accountId → 企业名称 ─────────────────────────
    const topAccountIds = topAccountsRaw.map((r) => r.accountId);

    const topAccounts = await this.prisma.computeAccount.findMany({
      where: { id: { in: topAccountIds } },
      select: { id: true, enterpriseId: true, enterprise: { select: { name: true } } },
    });
    const accountMap = new Map(topAccounts.map((a) => [a.id, a]));

    const topEnterprises = topAccountsRaw.map((r) => {
      const acc = accountMap.get(r.accountId);
      return {
        id: acc?.enterpriseId ?? r.accountId,
        name: acc?.enterprise?.name ?? '未知企业',
        tokens: Math.abs(Number(r._sum.amount ?? 0)),
      };
    });

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
}
