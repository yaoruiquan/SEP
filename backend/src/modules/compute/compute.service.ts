import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { WalletService } from '../wallet/wallet.service';
import type { RechargeCreateDto } from 'shared';
import { format } from 'date-fns';
import type {
  ConsumptionLogQuery,
  ConsumptionLog,
  ConsumptionLogResponse,
  TopConsumer,
  TopConsumersResponse,
} from './dto/consumption-log.dto';

const EMPTY_LOG_PAGE: { logs: ConsumptionLog[]; total: number } = {
  logs: [],
  total: 0,
};

type UsageRecordWithRelations = Prisma.ComputeUsageRecordGetPayload<{
  include: {
    employee: { select: { id: true; name: true } };
    user: { select: { id: true; name: true; email: true } };
    subscription: { select: { name: true } };
  };
}>;

type SubscriptionWithEmployee = Prisma.SubscriptionGetPayload<{
  include: { employee: { select: { id: true; name: true } } };
}>;

/**
 * 一次模型调用 → 一条消费日志。
 *
 * amount 用负数保持与钱包流水一致的符号约定（前端按 `Math.abs` 展示）。
 * creditPaid / walletPaid 拆开给出，回答用户最常问的「这笔钱从哪扣的」。
 */
function toComputeLog(record: UsageRecordWithRelations): ConsumptionLog {
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    type: 'COMPUTE',
    amount: record.costCNY.neg().toString(),
    employeeName:
      record.subscription?.name ?? record.employee?.name ?? '硅基员工',
    employeeId: record.employeeId ?? '',
    memberName: record.user?.name ?? record.user?.email ?? null,
    memberId: record.userId,
    detail: {
      sessionId: record.sessionId ?? undefined,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      tokenCount: record.inputTokens + record.outputTokens,
      modelName: record.modelId,
      creditPaidCNY: record.creditPaidCNY.toString(),
      walletPaidCNY: record.walletPaidCNY.toString(),
      unpaidCNY: record.unpaidCNY.toString(),
      fallbackPricing: record.fallbackPricing,
    },
  };
}

/** 一笔订阅费扣款 → 一条消费日志。 */
function toSubscriptionLog(
  tx: { id: string; createdAt: Date; amount: Prisma.Decimal; metadata: unknown },
  subscription: SubscriptionWithEmployee,
): ConsumptionLog {
  const metadata = (tx.metadata ?? {}) as { billingCycle?: string };
  return {
    id: tx.id,
    createdAt: tx.createdAt.toISOString(),
    type: 'SUBSCRIPTION',
    amount: tx.amount.toString(),
    employeeName: subscription.name ?? subscription.employee.name,
    employeeId: subscription.employeeId,
    memberName: null,
    memberId: null,
    detail: {
      subscriptionId: subscription.id,
      planName: subscription.employee.name,
      billingCycle: metadata.billingCycle,
    },
  };
}

@Injectable()
export class ComputeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enterpriseCtx: EnterpriseContextService,
    private readonly walletService: WalletService,
  ) {}

  // ── 账户信息 ──────────────────────────────────────────────────────────────

  /**
   * 取（或建）企业的 ComputeAccount。
   *
   * ⚠️ 它的 `balance` 已是废弃字段，**不要读它当余额** —— 真实余额在
   * EnterpriseWallet。这里只是因为 RechargeOrder.accountId 外键指向它，
   * 充值订单仍需要一个 accountId。余额查询请用 WalletService.getBalance()。
   */
  async getAccount(userId: string) {
    const { enterpriseId } = await this.enterpriseCtx.resolve(userId);

    let account = await this.prisma.computeAccount.findUnique({
      where: { enterpriseId },
    });

    if (!account) {
      account = await this.prisma.computeAccount.create({
        data: { enterpriseId, balance: 0 },
      });
    }

    return account;
  }

  // ── 统计数据 ──────────────────────────────────────────────────────────────

  /**
   * 企业算力统计。
   *
   * 余额读钱包，消费读 ComputeUsageRecord —— 后者是全量的。若消费也读钱包流水，
   * 由订阅赠送余额承担的那部分对话不会产生流水，统计出来的消费会系统性偏低。
   */
  async getStats(userId: string) {
    const { enterpriseId } = await this.enterpriseCtx.resolve(userId);

    const walletBalance = await this.walletService.getBalance(enterpriseId);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [today, month, trendData] = await Promise.all([
      this.prisma.computeUsageRecord.aggregate({
        where: { enterpriseId, createdAt: { gte: todayStart } },
        _sum: { costCNY: true },
      }),
      this.prisma.computeUsageRecord.aggregate({
        where: { enterpriseId, createdAt: { gte: monthStart } },
        _sum: { costCNY: true },
      }),
      this.prisma.$queryRaw<Array<{ date: string; amount: string }>>`
        SELECT
          DATE(cur."createdAt") as date,
          SUM(cur."costCNY") as amount
        FROM compute_usage_records cur
        WHERE
          cur."enterpriseId" = ${enterpriseId}
          AND cur."createdAt" >= ${last30Days}
        GROUP BY DATE(cur."createdAt")
        ORDER BY date ASC
      `,
    ]);

    return {
      balance: walletBalance.balance,
      todayConsume: Number(today._sum.costCNY ?? 0),
      monthConsume: Number(month._sum.costCNY ?? 0),
      trendData: trendData.map((d) => ({
        date: d.date,
        amount: Number(d.amount),
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
   * 模拟充值接口，已停用。
   *
   * 它往 ComputeAccount.balance 写数 —— 那已经不是真实余额了。留着会让人以为
   * 充值成功，实际余额（EnterpriseWallet）分文未动。走 createRechargeOrder()。
   */
  async recharge(_userId: string, _data: RechargeCreateDto): Promise<never> {
    throw new BadRequestException(
      '该充值接口已停用，请通过 /wallet/recharge 创建支付订单充值企业钱包',
    );
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

  // ── 消费日志 ──────────────────────────────────────────────────────────────

  /**
   * 消费日志：算力消费 + 订阅消费，统一以人民币金额为主口径。
   *
   * 两类消费来自不同的表，这是刻意的：
   *  - 算力消费读 ComputeUsageRecord。**不能读钱包流水** —— 由赠送余额全额承担的
   *    对话不产生钱包流水，那样会让一整批消费从日志里消失。
   *  - 订阅消费读 WalletTransaction(relatedType='subscription')，那本来就是钱包支出。
   *
   * 合并分页的做法：各取到当前页深度后在内存里归并排序再切片。SQL 层做 UNION
   * 才能真正流式分页，但两张表的形状差异大，为一个明细页引入裸 SQL 不值得。
   */
  async getConsumptionLogs(
    userId: string,
    query: ConsumptionLogQuery,
  ): Promise<ConsumptionLogResponse> {
    const { enterpriseId } = await this.enterpriseCtx.resolve(userId);
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
    const createdAt = this.buildDateRange(query.startDate, query.endDate);
    const depth = page * pageSize;

    const wantCompute = query.type !== 'SUBSCRIPTION';
    // 订阅费是企业级支出，没有具体使用成员。按成员筛选时它必然不匹配，
    // 直接跳过查询而不是查回来再过滤掉。
    const wantSubscription = query.type !== 'COMPUTE' && !query.memberId;

    const [compute, subscription] = await Promise.all([
      wantCompute
        ? this.loadComputeLogs(enterpriseId, query, createdAt, depth)
        : EMPTY_LOG_PAGE,
      wantSubscription
        ? this.loadSubscriptionLogs(enterpriseId, query, createdAt, depth)
        : EMPTY_LOG_PAGE,
    ]);

    const merged = [...compute.logs, ...subscription.logs].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
    const total = compute.total + subscription.total;

    return {
      logs: merged.slice((page - 1) * pageSize, page * pageSize),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** 起止日期转成覆盖整天的区间；两者都缺时返回 undefined 以免多加一个空条件。 */
  private buildDateRange(
    startDate?: string,
    endDate?: string,
  ): Prisma.DateTimeFilter | undefined {
    if (!startDate && !endDate) return undefined;
    const filter: Prisma.DateTimeFilter = {};
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      filter.gte = start;
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter.lte = end;
    }
    return filter;
  }

  /** 算力消费：一行 = 一次模型调用。金额是真实成本，Token 是明细。 */
  private async loadComputeLogs(
    enterpriseId: string,
    query: ConsumptionLogQuery,
    createdAt: Prisma.DateTimeFilter | undefined,
    depth: number,
  ): Promise<{ logs: ConsumptionLog[]; total: number }> {
    const where: Prisma.ComputeUsageRecordWhereInput = {
      enterpriseId,
      ...(query.employeeId && { employeeId: query.employeeId }),
      ...(query.memberId && { userId: query.memberId }),
      ...(createdAt && { createdAt }),
    };

    const [total, records] = await Promise.all([
      this.prisma.computeUsageRecord.count({ where }),
      this.prisma.computeUsageRecord.findMany({
        where,
        include: {
          employee: { select: { id: true, name: true } },
          user: { select: { id: true, name: true, email: true } },
          subscription: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: depth,
      }),
    ]);

    return { total, logs: records.map((r) => toComputeLog(r)) };
  }

  /** 订阅消费：一行 = 一笔订阅费扣款，来源是钱包流水。 */
  private async loadSubscriptionLogs(
    enterpriseId: string,
    query: ConsumptionLogQuery,
    createdAt: Prisma.DateTimeFilter | undefined,
    depth: number,
  ): Promise<{ logs: ConsumptionLog[]; total: number }> {
    const where: Prisma.WalletTransactionWhereInput = {
      wallet: { enterpriseId },
      type: 'CONSUME',
      relatedType: 'subscription',
      ...(createdAt && { createdAt }),
    };

    const transactions = await this.prisma.walletTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: depth,
    });

    const subscriptionIds = transactions
      .map((tx) => tx.relatedId)
      .filter((id): id is string => !!id);

    const subscriptions = subscriptionIds.length
      ? await this.prisma.subscription.findMany({
          where: { id: { in: subscriptionIds } },
          include: { employee: { select: { id: true, name: true } } },
        })
      : [];
    const byId = new Map(subscriptions.map((s) => [s.id, s]));

    // 员工筛选只能在拿到订阅后做（钱包流水上没有 employeeId），
    // 所以 total 也要按过滤后的结果算，否则分页数字对不上。
    const logs = transactions
      .map((tx) => {
        const sub = tx.relatedId ? byId.get(tx.relatedId) : undefined;
        if (!sub) return null;
        if (query.employeeId && sub.employeeId !== query.employeeId) return null;
        return toSubscriptionLog(tx, sub);
      })
      .filter((log): log is ConsumptionLog => log !== null);

    return { total: logs.length, logs };
  }

  // ── Top 消费排行 ──────────────────────────────────────────────────────────

  /**
   * 消费排行（近 30 天，按员工聚合人民币成本）。
   *
   * 数据源是 ComputeUsageRecord：它自带 enterpriseId 与 employeeId，
   * 不用像旧实现那样从钱包流水绕 relatedId → session → employee 三跳，
   * 也不会漏掉由赠送余额承担的消费。
   */
  async getTopConsumers(userId: string, limit = 5): Promise<TopConsumersResponse> {
    const { enterpriseId } = await this.enterpriseCtx.resolve(userId);

    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);

    const result = await this.prisma.$queryRaw<
      Array<{
        employeeId: string;
        employeeName: string;
        employeeAvatar: string | null;
        totalAmount: string;
        callCount: string;
      }>
    >`
      SELECT
        de.id as "employeeId",
        de.name as "employeeName",
        de.avatar as "employeeAvatar",
        SUM(cur."costCNY") as "totalAmount",
        COUNT(*) as "callCount"
      FROM compute_usage_records cur
      INNER JOIN digital_employees de ON cur."employeeId" = de.id
      WHERE
        cur."enterpriseId" = ${enterpriseId}
        AND cur."createdAt" >= ${last30Days}
      GROUP BY de.id, de.name, de.avatar
      ORDER BY "totalAmount" DESC
      LIMIT ${limit}
    `;

    // 计算总消费
    const totalAmount = result.reduce(
      (sum, item) => sum + Math.abs(Number(item.totalAmount)),
      0,
    );

    // 计算百分比
    const consumers: TopConsumer[] = result.map((item) => ({
      employeeId: item.employeeId,
      employeeName: item.employeeName,
      employeeAvatar: item.employeeAvatar,
      totalAmount: Math.abs(Number(item.totalAmount)).toFixed(2),
      callCount: Number(item.callCount),
      percentage: totalAmount > 0 ? (Math.abs(Number(item.totalAmount)) / totalAmount) * 100 : 0,
    }));

    return {
      consumers,
      totalAmount: totalAmount.toFixed(2),
    };
  }
}
