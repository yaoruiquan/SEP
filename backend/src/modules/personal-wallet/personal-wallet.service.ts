import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PayChannel,
  PersonalWalletTransactionType,
  Prisma,
  RechargeOrderStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { format } from 'date-fns';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  PersonalConsumeResult,
  PersonalWalletTransactionPage,
  PersonalWalletView,
} from './personal-wallet.types';

/** 账本精度 6 位小数，与企业钱包一致。 */
const MONEY_DP = 6;

function money(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(MONEY_DP, Decimal.ROUND_HALF_UP);
}

/**
 * 个人钱包 —— 成员自掏腰包继续对话的**兜底**资金。
 *
 * 在扣费链里排**最后一位**：
 *   赠送额度 → 企业钱包 → 个人钱包 → 欠费
 *
 * 排到第 2 位会让自掏钱的成员静默补贴公司：他一充值，公司的钱就永远花不到他头上。
 * 所以只在「企业资金用尽」或「企业给的分配额度用尽」时才动这里。
 *
 * 个人充值属个人行为：不进企业账、不计入分配额度的已用金额
 * （见 MemberAllowanceService 的已用口径），企业管理员看不到成员充了多少。
 */
/**
 * 1 分以下的金额保留 4 位小数。
 *
 * 自费一轮常花不到 1 分，四舍五入到分会让面板显示「已消费 ¥0.00」，
 * 而流水里明明有一笔 -¥0.0025 —— 同一个页面上两个自相矛盾的数字。
 * 与算力分配那边的取舍一致（见 member-allowance-query.service.ts）。
 */
function subCent(v: Decimal): string {
  return v.greaterThan(0) && v.lessThan(0.01) ? v.toFixed(4) : v.toFixed(2);
}

@Injectable()
export class PersonalWalletService {
  private readonly logger = new Logger(PersonalWalletService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 取钱包，不存在则建。余额 0 的钱包与「没有钱包」行为一致，所以建了也无副作用。 */
  async ensureWallet(userId: string) {
    const existing = await this.prisma.personalWallet.findUnique({
      where: { userId },
    });
    if (existing) return existing;
    return this.prisma.personalWallet.create({ data: { userId } });
  }

  /**
   * 只读余额，**不创建**钱包。
   *
   * 对话前的闸门每轮都要问一次「他有没有个人余额」，那条路径上不该写库 ——
   * 一次对话检查就建一行空钱包，等于给每个成员都发一个他没申请过的钱包。
   */
  async getBalance(userId: string): Promise<Decimal> {
    const wallet = await this.prisma.personalWallet.findUnique({
      where: { userId },
      select: { balance: true },
    });
    return wallet ? Decimal.max(0, wallet.balance) : new Decimal(0);
  }

  async getView(userId: string): Promise<PersonalWalletView> {
    const wallet = await this.ensureWallet(userId);
    return {
      balanceCNY: subCent(wallet.balance),
      // 充值金额是人手填的整数分，两位小数就够
      totalDepositCNY: wallet.totalDepositCNY.toFixed(2),
      totalConsumeCNY: subCent(wallet.totalConsumeCNY),
    };
  }

  // ── 充值（订单驱动） ──────────────────────────────────────────────────────

  /**
   * 创建个人充值订单。
   *
   * 这是个人余额增加的**唯一起点**，且它只产生一张 PENDING 订单 —— 不加钱。
   * 加钱只发生在 `fulfillRechargeOrder()`，而那个方法只被支付回调/对账调用。
   * 曾经这里是 `deposit()`：直接把金额加进余额，成员点一下就凭空多出算力，
   * 等于给每个人开了一台免费印钞机。
   *
   * 订单号前缀 `PRC`（企业充值 `RCH`、订阅 `ORD`）—— 支付宝异步通知只带
   * out_trade_no，回调靠前缀分流到对应履约链。
   */
  async createRechargeOrder(userId: string, amountCNY: number) {
    if (!Number.isFinite(amountCNY) || amountCNY <= 0) {
      throw new BadRequestException('充值金额必须大于 0');
    }
    // 支付渠道按分收款，落库前就抹掉更细的粒度，避免订单金额与实收金额不一致
    const amount = new Decimal(amountCNY).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('充值金额必须大于 0');
    }

    // 建订单前先确保钱包存在：履约时钱包缺失会让一笔已收的钱无处入账
    await this.ensureWallet(userId);

    return this.prisma.personalRechargeOrder.create({
      data: {
        orderNo: this.generateOrderNo(),
        userId,
        amount,
        status: RechargeOrderStatus.PENDING,
      },
    });
  }

  /**
   * 查自己的充值订单。
   *
   * `userId` 写在 where 里而不是查完再比 —— 不存在与不属于我返回同一个 404，
   * 别人的订单号也就问不出「这个号存在」这条信息。
   */
  async getRechargeOrder(userId: string, orderNo: string) {
    const order = await this.prisma.personalRechargeOrder.findFirst({
      where: { orderNo, userId },
    });
    if (!order) {
      throw new NotFoundException('充值订单不存在');
    }
    return order;
  }

  /**
   * 履约：把已支付的订单变成余额。**幂等** —— 支付宝会重复推同一条通知，
   * 对账任务也可能和通知撞在一起，重复入账就是白送钱。
   *
   * 幂等靠两层：
   *   1. `status === 'PAID'` 直接返回（通知重推的常见情况）
   *   2. 状态翻转用 `updateMany({ where: { status: PENDING } })`，
   *      拿到 0 行说明另一路已经处理完了，这条就什么都不做
   *
   * 订单翻 PAID 与钱包入账在**同一个** $transaction 里 ——
   * 分成两个事务的话，中间崩一次就会出现「订单已付但余额没加」的黑洞。
   */
  async fulfillRechargeOrder(
    orderNo: string,
    payTradeNo: string,
    payChannel: PayChannel,
  ) {
    const existing = await this.prisma.personalRechargeOrder.findUnique({
      where: { orderNo },
    });
    if (!existing) {
      throw new NotFoundException(`个人充值订单不存在: ${orderNo}`);
    }
    if (existing.status === RechargeOrderStatus.PAID) {
      return existing;
    }
    if (existing.status === RechargeOrderStatus.CLOSED) {
      // 已关闭的订单不再入账：钱若真的收到了，走人工对账退款，不能默默加余额
      throw new BadRequestException(`充值订单已关闭: ${orderNo}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const flipped = await tx.personalRechargeOrder.updateMany({
        where: { id: existing.id, status: RechargeOrderStatus.PENDING },
        data: {
          status: RechargeOrderStatus.PAID,
          payChannel,
          payTradeNo,
          paidAt: new Date(),
        },
      });
      if (flipped.count === 0) {
        // 另一路（通知 or 对账）已经履约完了，这次是重复投递
        const current = await tx.personalRechargeOrder.findUnique({
          where: { id: existing.id },
        });
        return current!;
      }

      await this.creditInTx(tx, existing.userId, new Decimal(existing.amount), {
        relatedId: existing.id,
        description: `个人充值 ${existing.orderNo}`,
      });

      this.logger.log(
        `个人充值到账: ${existing.orderNo} ¥${existing.amount.toFixed(2)} user=${existing.userId}`,
      );

      const paid = await tx.personalRechargeOrder.findUnique({
        where: { id: existing.id },
      });
      return paid!;
    });
  }

  /** 订单号：PRC + yyyyMMddHHmmss + 6 位随机数，同时用作支付宝 out_trade_no。 */
  private generateOrderNo(): string {
    const timestamp = format(new Date(), 'yyyyMMddHHmmss');
    const random = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0');
    return `PRC${timestamp}${random}`;
  }

  /**
   * 入账，必须在调用方的事务里执行。
   *
   * 不做成 public 的 `deposit()`：任何「不带支付单号就能加余额」的入口
   * 都是印钞机。想加钱只有一条路 —— 先有一张已支付的订单。
   */
  private async creditInTx(
    tx: Prisma.TransactionClient,
    userId: string,
    amountCNY: Decimal,
    meta: { relatedId: string; description: string },
  ): Promise<void> {
    const amount = money(amountCNY);
    // 事务内重新取一次：version 必须是本事务看到的值，用外面读到的会误判冲突
    const wallet = await tx.personalWallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });

    const before = wallet.balance;
    const after = before.add(amount);
    const updated = await tx.personalWallet.updateMany({
      where: { id: wallet.id, version: wallet.version },
      data: {
        balance: after,
        totalDepositCNY: { increment: amount },
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      // 抛出去让整笔事务回滚：订单会留在 PENDING，等下一次通知/对账重试
      throw new ConflictException('个人余额更新冲突，请重试');
    }

    await tx.personalWalletTransaction.create({
      data: {
        walletId: wallet.id,
        type: PersonalWalletTransactionType.DEPOSIT,
        amount,
        balanceBefore: before,
        balanceAfter: after,
        relatedType: 'recharge_order',
        relatedId: meta.relatedId,
        description: meta.description,
      },
    });
  }

  /**
   * 从个人钱包扣「最多 amount」，返回实扣与差额。
   *
   * 与 `WalletService.consumeComputeUpTo` 同形（同签名、同返回结构、同乐观锁与
   * 冲突处理），扣费链才能把三个资金来源用一套代码串起来。余额永不为负：
   * 不够就扣到 0，差额作为 unpaid 交回调用方如实记账。
   */
  async consumeUpTo(
    client: Prisma.TransactionClient,
    userId: string,
    amount: Decimal,
    meta: { relatedId?: string | null; description: string },
  ): Promise<PersonalConsumeResult> {
    if (amount.lessThanOrEqualTo(0)) {
      return { transactionId: null, paid: new Decimal(0), unpaid: new Decimal(0) };
    }

    const wallet = await client.personalWallet.findUnique({ where: { userId } });
    // 没有钱包 = 没充过钱。这不是错误，只是这一腿付不了钱 ——
    // 抛异常会让「公司额度用尽且没自付」的正常场景变成 500。
    if (!wallet) {
      return { transactionId: null, paid: new Decimal(0), unpaid: amount };
    }

    const balanceBefore = wallet.balance;
    const paid = money(Decimal.min(Decimal.max(0, balanceBefore), amount));
    if (paid.lessThanOrEqualTo(0)) {
      return { transactionId: null, paid: new Decimal(0), unpaid: amount };
    }
    const balanceAfter = balanceBefore.sub(paid);
    const unpaid = amount.sub(paid);

    const updated = await client.personalWallet.updateMany({
      where: { id: wallet.id, version: wallet.version },
      data: {
        balance: balanceAfter,
        totalConsumeCNY: { increment: paid },
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      // 让调用方重试整笔扣费；账单幂等键保证重试不会重复入账
      throw new ConflictException('个人余额更新冲突，请重试');
    }

    const transaction = await client.personalWalletTransaction.create({
      data: {
        walletId: wallet.id,
        type: PersonalWalletTransactionType.CONSUME,
        amount: paid.neg(),
        balanceBefore,
        balanceAfter,
        relatedType: 'compute',
        relatedId: meta.relatedId ?? null,
        description: meta.description,
      },
    });

    return { transactionId: transaction.id, paid, unpaid };
  }

  /** 个人钱包流水（成员端「我的消费记录」）。 */
  async listTransactions(
    userId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<PersonalWalletTransactionPage> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const wallet = await this.prisma.personalWallet.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!wallet) {
      return { total: 0, page, pageSize, totalPages: 1, records: [] };
    }

    const where = { walletId: wallet.id };
    const [total, records] = await Promise.all([
      this.prisma.personalWalletTransaction.count({ where }),
      this.prisma.personalWalletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
      records: records.map((r) => ({
        id: r.id,
        type: r.type,
        // 单次对话常花不到 1 分，两位小数会把一整页流水显示成 ¥0.00
        amountCNY: r.amount.toFixed(4),
        balanceAfterCNY: r.balanceAfter.toFixed(4),
        description: r.description,
        relatedType: r.relatedType,
        relatedId: r.relatedId,
        createdAt: r.createdAt,
      })),
    };
  }
}
