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
}
