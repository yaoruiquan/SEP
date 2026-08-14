import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { WalletService } from '../wallet/wallet.service';
import type { RechargeCreateDto } from 'shared';
import { format } from 'date-fns';

@Injectable()
export class ComputeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enterpriseCtx: EnterpriseContextService,
    private readonly walletService: WalletService,
  ) {}

  // ── 账户信息 ──────────────────────────────────────────────────────────────

  /**
   * @deprecated 使用 WalletService.getBalance() 替代
   */
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
    const { enterpriseId } = await this.enterpriseCtx.resolve(userId);

    // 从钱包获取余额
    const walletBalance = await this.walletService.getBalance(enterpriseId);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 今日消费 - 从钱包交易记录统计
    const todayTransactions = await this.prisma.walletTransaction.findMany({
      where: {
        wallet: { enterpriseId },
        type: 'CONSUME',
        relatedType: 'compute',
        createdAt: { gte: todayStart },
      },
    });

    // 本月消费
    const monthTransactions = await this.prisma.walletTransaction.findMany({
      where: {
        wallet: { enterpriseId },
        type: 'CONSUME',
        relatedType: 'compute',
        createdAt: { gte: monthStart },
      },
    });

    // 最近30天趋势
    const trendData = await this.prisma.$queryRaw<Array<{ date: string; amount: string }>>`
      SELECT
        DATE("createdAt") as date,
        SUM(ABS(amount)) as amount
      FROM wallet_transactions wt
      INNER JOIN enterprise_wallets ew ON wt."walletId" = ew.id
      WHERE
        ew."enterpriseId" = ${enterpriseId}
        AND wt.type = 'CONSUME'
        AND wt."relatedType" = 'compute'
        AND wt."createdAt" >= ${last30Days}
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `;

    return {
      balance: walletBalance.balance,
      todayConsume: todayTransactions.reduce((sum, tx) => sum + Math.abs(Number(tx.amount)), 0),
      monthConsume: monthTransactions.reduce((sum, tx) => sum + Math.abs(Number(tx.amount)), 0),
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
    const { enterpriseId } = await this.enterpriseCtx.resolve(userId);

    // 将类型映射到钱包交易类型
    const typeMap = {
      RECHARGE: 'DEPOSIT',
      CONSUME: 'CONSUME',
      REFUND: 'REFUND',
    };

    // 构建查询条件
    const where: any = {
      wallet: { enterpriseId },
      relatedType: 'compute', // 只查算力相关的交易
    };

    if (params?.type) {
      where.type = typeMap[params.type];
    }

    if (params?.startDate || params?.endDate) {
      where.createdAt = {};
      if (params.startDate) {
        where.createdAt.gte = new Date(params.startDate);
      }
      if (params?.endDate) {
        const end = new Date(params.endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const page = params?.page || 1;
    const pageSize = params?.pageSize || 20;

    const [total, transactions] = await Promise.all([
      this.prisma.walletTransaction.count({ where }),
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
    ]);

    return { total, page, pageSize, transactions };
  }

  // ── 充值 ──────────────────────────────────────────────────────────────────

  /**
   * @deprecated 旧的模拟充值接口，已废弃。请使用 createRechargeOrder() 创建支付订单。
   */
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

  // ── 充值订单（新接口） ────────────────────────────────────────────────────

  /**
   * 创建充值订单（生成订单号，返回给 PaymentService 生成支付 URL）
   */
  async createRechargeOrder(userId: string, amount: number) {
    const account = await this.getAccount(userId);

    // 生成订单号：RCH + yyyyMMddHHmmss + 6位随机数
    const orderNo = this.generateRechargeOrderNo();

    const order = await this.prisma.rechargeOrder.create({
      data: {
        orderNo,
        accountId: account.id,
        amount,
        status: 'PENDING',
      },
    });

    return order;
  }

  /**
   * 查询充值订单（支持订单号或订单ID）
   */
  async getRechargeOrder(userId: string, orderNoOrId: string) {
    const account = await this.getAccount(userId);

    const order = await this.prisma.rechargeOrder.findFirst({
      where: {
        OR: [{ id: orderNoOrId }, { orderNo: orderNoOrId }],
        accountId: account.id,
      },
    });

    if (!order) {
      throw new NotFoundException('充值订单不存在');
    }

    return order;
  }

  /**
   * 充值订单履约（支付回调成功后调用）
   */
  async fulfillRechargeOrder(orderNo: string, payTradeNo: string, payChannel: 'ALIPAY' | 'WECHAT') {
    const order = await this.prisma.rechargeOrder.findUnique({
      where: { orderNo },
      include: { account: { include: { enterprise: true } } },
    });

    if (!order) {
      throw new NotFoundException(`充值订单不存在: ${orderNo}`);
    }

    if (order.status === 'PAID') {
      // 幂等：已支付的订单不重复处理
      return order;
    }

    // 事务：更新订单状态 + 钱包充值
    return this.prisma.$transaction(async (tx) => {
      // 1. 更新订单状态
      const updatedOrder = await tx.rechargeOrder.update({
        where: { id: order.id },
        data: {
          status: 'PAID',
          payChannel,
          payTradeNo,
          paidAt: new Date(),
        },
      });

      // 2. 通过 WalletService 处理充值（统一入口）
      // 注意：tx 是 Prisma 事务上下文，WalletService 内部会使用同一个事务
      await this.walletService.deposit(
        order.account.enterpriseId,
        Number(order.amount),
        order.id,
        `充值订单 ${orderNo}`,
      );

      return updatedOrder;
    });
  }

  /**
   * 生成充值订单号
   */
  private generateRechargeOrderNo(): string {
    const timestamp = format(new Date(), 'yyyyMMddHHmmss');
    const random = Math.floor(Math.random() * 1000000)
      .toString()
      .padStart(6, '0');
    return `RCH${timestamp}${random}`;
  }

  // ── 消费（内部调用，由对话服务调用）─────────────────────────────────────

  async consume(
    enterpriseId: string,
    amount: number,
    sessionId?: string,
    description?: string,
  ) {
    // 使用钱包服务消费
    return this.walletService.consume(
      enterpriseId,
      amount,
      'compute',
      sessionId || null,
      description || '对话消费',
    );
  }
}
