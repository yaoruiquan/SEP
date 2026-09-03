import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma, PersonalWalletTransactionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
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

  /**
   * 充值入账。
   *
   * 第一版是**演示口径**：直接加余额，不接支付渠道。真实支付接入后这里要改成
   * 由支付回调驱动（幂等键 = 支付单号），当前签名刻意保留 `relatedId` 以便那时复用。
   */
  async deposit(
    userId: string,
    amountCNY: number,
    meta?: { relatedId?: string | null; description?: string },
  ): Promise<PersonalWalletView> {
    if (!Number.isFinite(amountCNY) || amountCNY <= 0) {
      throw new BadRequestException('充值金额必须大于 0');
    }
    const amount = money(amountCNY);
    const wallet = await this.ensureWallet(userId);

    await this.prisma.$transaction(async (tx) => {
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
        throw new ConflictException('个人余额更新冲突，请重试');
      }
      await tx.personalWalletTransaction.create({
        data: {
          walletId: wallet.id,
          type: PersonalWalletTransactionType.DEPOSIT,
          amount,
          balanceBefore: before,
          balanceAfter: after,
          relatedType: meta?.relatedId ? 'recharge_order' : null,
          relatedId: meta?.relatedId ?? null,
          description: meta?.description ?? `个人充值 ¥${amount.toFixed(2)}`,
        },
      });
    });

    return this.getView(userId);
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
