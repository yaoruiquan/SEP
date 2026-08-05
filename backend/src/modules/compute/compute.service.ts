import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import type { RechargeCreateDto } from 'shared';

@Injectable()
export class ComputeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enterpriseCtx: EnterpriseContextService,
  ) {}

  // ── 账户信息 ──────────────────────────────────────────────────────────────

  async getAccount(userId: string) {
    const { enterpriseId } = await this.enterpriseCtx.resolve(userId);

    let account = await this.prisma.computeAccount.findUnique({
      where: { enterpriseId },
    });

    // 自动创建账户（如果不存在）
    if (!account) {
      account = await this.prisma.computeAccount.create({
        data: { enterpriseId, balance: 0 },
      });
    }

    return account;
  }

  // ── 统计数据 ──────────────────────────────────────────────────────────────

  async getStats(userId: string) {
    const account = await this.getAccount(userId);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 今日消费
    const todayConsumeResult = await this.prisma.computeTransaction.aggregate({
      where: {
        accountId: account.id,
        type: 'CONSUME',
        createdAt: { gte: todayStart },
      },
      _sum: { amount: true },
    });

    // 本月消费
    const monthConsumeResult = await this.prisma.computeTransaction.aggregate({
      where: {
        accountId: account.id,
        type: 'CONSUME',
        createdAt: { gte: monthStart },
      },
      _sum: { amount: true },
    });

    // 最近30天趋势
    const trendData = await this.prisma.$queryRaw<Array<{ date: string; amount: string }>>`
      SELECT
        DATE("createdAt") as date,
        SUM(ABS(amount)) as amount
      FROM compute_transactions
      WHERE
        "accountId" = ${account.id}
        AND type = 'CONSUME'
        AND "createdAt" >= ${last30Days}
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `;

    return {
      balance: account.balance,
      todayConsume: Math.abs(todayConsumeResult._sum.amount || 0),
      monthConsume: Math.abs(monthConsumeResult._sum.amount || 0),
      trendData: trendData.map((d) => ({
        date: d.date,
        amount: Math.abs(Number(d.amount)),
      })),
    };
  }

  // ── 交易记录 ──────────────────────────────────────────────────────────────

  async listTransactions(
    userId: string,
    params?: {
      type?: 'RECHARGE' | 'CONSUME' | 'REFUND';
      startDate?: string;
      endDate?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const account = await this.getAccount(userId);

    const where: any = { accountId: account.id };
    if (params?.type) {
      where.type = params.type;
    }
    if (params?.startDate || params?.endDate) {
      where.createdAt = {};
      if (params.startDate) {
        where.createdAt.gte = new Date(params.startDate);
      }
      if (params?.endDate) {
        // include the full end day
        const end = new Date(params.endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const page = params?.page || 1;
    const pageSize = params?.pageSize || 20;

    const [total, transactions] = await Promise.all([
      this.prisma.computeTransaction.count({ where }),
      this.prisma.computeTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
    ]);

    return { total, page, pageSize, transactions };
  }

  // ── 充值 ──────────────────────────────────────────────────────────────────

  async recharge(userId: string, data: RechargeCreateDto) {
    const account = await this.getAccount(userId);

    // 创建充值交易记录
    const transaction = await this.prisma.computeTransaction.create({
      data: {
        accountId: account.id,
        type: 'RECHARGE',
        amount: data.amount,
        description: data.description || '账户充值',
      },
    });

    // 更新余额
    await this.prisma.computeAccount.update({
      where: { id: account.id },
      data: { balance: { increment: data.amount } },
    });

    return transaction;
  }

  // ── 消费（内部调用，由对话服务调用）─────────────────────────────────────

  async consume(
    enterpriseId: string,
    amount: number,
    sessionId?: string,
    description?: string,
  ) {
    let account = await this.prisma.computeAccount.findUnique({
      where: { enterpriseId },
    });

    if (!account) {
      account = await this.prisma.computeAccount.create({
        data: { enterpriseId, balance: 0 },
      });
    }

    // 创建消费记录（金额为负数）
    const transaction = await this.prisma.computeTransaction.create({
      data: {
        accountId: account.id,
        type: 'CONSUME',
        amount: -Math.abs(amount),
        sessionId,
        description: description || '对话消费',
      },
    });

    // 更新余额（可以为负数，允许透支）
    await this.prisma.computeAccount.update({
      where: { id: account.id },
      data: { balance: { decrement: amount } },
    });

    return transaction;
  }
}
