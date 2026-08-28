import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Prisma, WalletTransactionType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取企业钱包余额
   */
  async getBalance(enterpriseId: string) {
    const wallet = await this.ensureWallet(enterpriseId);
    return {
      balance: wallet.balance,
      frozenAmount: wallet.frozenAmount,
      totalDeposit: wallet.totalDeposit,
      totalConsume: wallet.totalConsume,
      totalRefund: wallet.totalRefund,
    };
  }

  /**
   * 充值（支付宝回调时调用）
   */
  async deposit(
    enterpriseId: string,
    amount: number,
    paymentOrderId: string,
    description?: string,
  ) {
    if (amount <= 0) {
      throw new BadRequestException("充值金额必须大于 0");
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. 获取钱包（行锁）
      const wallet = await tx.enterpriseWallet.findUnique({
        where: { enterpriseId },
      });

      if (!wallet) {
        throw new NotFoundException(`企业钱包不存在: ${enterpriseId}`);
      }

      const balanceBefore = wallet.balance;
      const amountDecimal = new Decimal(amount);
      const balanceAfter = balanceBefore.add(amountDecimal);

      // 2. 更新余额（乐观锁）
      const updated = await tx.enterpriseWallet.updateMany({
        where: {
          enterpriseId,
          version: wallet.version, // 乐观锁：只有版本号匹配才更新
        },
        data: {
          balance: balanceAfter,
          totalDeposit: { increment: amountDecimal },
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw new ConflictException("余额更新冲突，请重试");
      }

      // 3. 记录交易
      return tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.DEPOSIT,
          amount: amountDecimal,
          balanceBefore,
          balanceAfter,
          paymentMethod: "alipay",
          paymentOrderId,
          description: description || `充值 ¥${amount}`,
        },
      });
    });
  }

  /**
   * 消费（订阅员工、算力消耗）
   */
  async consume(
    enterpriseId: string,
    amount: number,
    relatedType: "subscription" | "compute",
    relatedId: string | null,
    description?: string,
    tx?: Prisma.TransactionClient,
  ) {
    if (amount <= 0) {
      throw new BadRequestException("消费金额必须大于 0");
    }

    const consume = async (client: Prisma.TransactionClient) => {
      // 1. 获取钱包
      const wallet = await client.enterpriseWallet.findUnique({
        where: { enterpriseId },
      });

      if (!wallet) {
        throw new NotFoundException(`企业钱包不存在: ${enterpriseId}`);
      }

      const balanceBefore = wallet.balance;
      const amountDecimal = new Decimal(amount);

      // 2. 检查余额
      if (balanceBefore.lessThan(amountDecimal)) {
        throw new BadRequestException(
          `余额不足。当前余额: ¥${balanceBefore}，需要: ¥${amount}`,
        );
      }

      const balanceAfter = balanceBefore.sub(amountDecimal);

      // 3. 更新余额（乐观锁）
      const updated = await client.enterpriseWallet.updateMany({
        where: {
          enterpriseId,
          version: wallet.version,
        },
        data: {
          balance: balanceAfter,
          totalConsume: { increment: amountDecimal },
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw new ConflictException("余额更新冲突，请重试");
      }

      // 4. 记录交易（负数表示扣款）
      return client.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.CONSUME,
          amount: amountDecimal.neg(), // 负数
          balanceBefore,
          balanceAfter,
          relatedType,
          relatedId,
          description,
        },
      });
    };

    return tx ? consume(tx) : this.prisma.$transaction(consume);
  }

  /**
   * 退款（解雇员工、取消订阅）
   */
  async refund(
    enterpriseId: string,
    amount: number,
    relatedType: "subscription" | "compute",
    relatedId: string,
    description?: string,
  ) {
    if (amount <= 0) {
      throw new BadRequestException("退款金额必须大于 0");
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. 获取钱包
      const wallet = await tx.enterpriseWallet.findUnique({
        where: { enterpriseId },
      });

      if (!wallet) {
        throw new NotFoundException(`企业钱包不存在: ${enterpriseId}`);
      }

      const balanceBefore = wallet.balance;
      const amountDecimal = new Decimal(amount);
      const balanceAfter = balanceBefore.add(amountDecimal);

      // 2. 更新余额（乐观锁）
      const updated = await tx.enterpriseWallet.updateMany({
        where: {
          enterpriseId,
          version: wallet.version,
        },
        data: {
          balance: balanceAfter,
          totalRefund: { increment: amountDecimal },
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw new ConflictException("余额更新冲突，请重试");
      }

      // 3. 记录交易
      return tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.REFUND,
          amount: amountDecimal, // 正数
          balanceBefore,
          balanceAfter,
          relatedType,
          relatedId,
          description,
        },
      });
    });
  }

  /**
   * 获取交易记录
   */
  async getTransactions(
    enterpriseId: string,
    options: {
      type?: WalletTransactionType;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const { type, page = 1, limit = 20 } = options;

    const wallet = await this.ensureWallet(enterpriseId);

    const where: Prisma.WalletTransactionWhereInput = {
      walletId: wallet.id,
      ...(type && { type }),
    };

    const [items, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.walletTransaction.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * 管理员手动调整余额（补偿、赠送等）
   */
  async adjust(
    enterpriseId: string,
    amount: number,
    reason: string,
    operatorId: string,
  ) {
    if (amount === 0) {
      throw new BadRequestException("调整金额不能为 0");
    }

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.enterpriseWallet.findUnique({
        where: { enterpriseId },
      });

      if (!wallet) {
        throw new NotFoundException(`企业钱包不存在: ${enterpriseId}`);
      }

      const balanceBefore = wallet.balance;
      const amountDecimal = new Decimal(amount);
      const balanceAfter = balanceBefore.add(amountDecimal);

      if (balanceAfter.lessThan(0)) {
        throw new BadRequestException(
          `调整后余额不能为负数。当前: ¥${balanceBefore}，调整: ¥${amount}`,
        );
      }

      // 更新余额
      const updated = await tx.enterpriseWallet.updateMany({
        where: {
          enterpriseId,
          version: wallet.version,
        },
        data: {
          balance: balanceAfter,
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw new ConflictException("余额更新冲突，请重试");
      }

      // 记录交易
      return tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.ADJUSTMENT,
          amount: amountDecimal,
          balanceBefore,
          balanceAfter,
          description: reason,
          createdBy: operatorId,
        },
      });
    });
  }

  /**
   * 管理员充值（后台运营充值）
   */
  async adminDeposit(
    enterpriseId: string,
    amount: number,
    reason: string,
    operatorId: string,
  ) {
    if (amount <= 0) {
      throw new BadRequestException("充值金额必须大于 0");
    }

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.enterpriseWallet.findUnique({
        where: { enterpriseId },
      });

      if (!wallet) {
        throw new NotFoundException(`企业钱包不存在: ${enterpriseId}`);
      }

      const balanceBefore = wallet.balance;
      const amountDecimal = new Decimal(amount);
      const balanceAfter = balanceBefore.add(amountDecimal);

      // 更新余额
      const updated = await tx.enterpriseWallet.updateMany({
        where: {
          enterpriseId,
          version: wallet.version,
        },
        data: {
          balance: balanceAfter,
          totalDeposit: { increment: amountDecimal },
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw new ConflictException("余额更新冲突，请重试");
      }

      // 记录交易
      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.DEPOSIT,
          amount: amountDecimal,
          balanceBefore,
          balanceAfter,
          paymentMethod: "admin",
          description: reason,
          createdBy: operatorId,
        },
      });

      return {
        ...transaction,
        balance: balanceAfter.toNumber(),
      };
    });
  }

  /**
   * 管理员扣减（后台运营扣款）
   */
  async adminDeduct(
    enterpriseId: string,
    amount: number,
    reason: string,
    operatorId: string,
  ) {
    if (amount <= 0) {
      throw new BadRequestException("扣减金额必须大于 0");
    }

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.enterpriseWallet.findUnique({
        where: { enterpriseId },
      });

      if (!wallet) {
        throw new NotFoundException(`企业钱包不存在: ${enterpriseId}`);
      }

      const balanceBefore = wallet.balance;
      const amountDecimal = new Decimal(amount);

      // 检查余额
      if (balanceBefore.lessThan(amountDecimal)) {
        throw new BadRequestException(
          `余额不足。当前余额: ¥${balanceBefore}，需要扣减: ¥${amount}`,
        );
      }

      const balanceAfter = balanceBefore.sub(amountDecimal);

      // 更新余额
      const updated = await tx.enterpriseWallet.updateMany({
        where: {
          enterpriseId,
          version: wallet.version,
        },
        data: {
          balance: balanceAfter,
          totalConsume: { increment: amountDecimal },
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw new ConflictException("余额更新冲突，请重试");
      }

      // 记录交易（负数）
      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.CONSUME,
          amount: amountDecimal.neg(),
          balanceBefore,
          balanceAfter,
          relatedType: "compute",
          description: reason,
          createdBy: operatorId,
        },
      });

      return {
        ...transaction,
        balance: balanceAfter.toNumber(),
      };
    });
  }

  /**
   * 算力消费扣款：「有多少扣多少」，不足的差额如实返回给调用方。
   *
   * 与 consume() 的区别是刻意的 —— consume() 面向订阅付费这类「付不起就不该成交」
   * 的场景，余额不足直接抛错；本方法面向**已经发生**的模型调用：对话已经产生了
   * 真实成本，抛错会连事实一起回滚。所以这里扣到 0 为止，把差额交给
   * ComputeUsageRecord.unpaidCNY 记账，由对话前的余额检查负责拦下后续调用。
   *
   * 必须在调用方事务内执行：赠送余额扣减与钱包扣减要么同时成立，要么同时失败。
   */
  async consumeComputeUpTo(
    client: Prisma.TransactionClient,
    enterpriseId: string,
    amount: Decimal,
    meta: { relatedId?: string | null; description: string },
  ): Promise<{
    transactionId: string | null;
    paid: Decimal;
    unpaid: Decimal;
  }> {
    if (amount.lessThanOrEqualTo(0)) {
      return { transactionId: null, paid: new Decimal(0), unpaid: new Decimal(0) };
    }

    const wallet = await client.enterpriseWallet.findUnique({
      where: { enterpriseId },
    });
    if (!wallet) {
      throw new NotFoundException(`企业钱包不存在: ${enterpriseId}`);
    }

    const balanceBefore = wallet.balance;
    const paid = Decimal.min(balanceBefore, amount);
    const unpaid = amount.sub(paid);

    if (paid.lessThanOrEqualTo(0)) {
      return { transactionId: null, paid: new Decimal(0), unpaid: amount };
    }

    const balanceAfter = balanceBefore.sub(paid);

    const updated = await client.enterpriseWallet.updateMany({
      where: { enterpriseId, version: wallet.version },
      data: {
        balance: balanceAfter,
        totalConsume: { increment: paid },
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      // 让调用方重试整笔扣费；幂等键保证重试不会重复入账
      throw new ConflictException("余额更新冲突，请重试");
    }

    const transaction = await client.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: WalletTransactionType.CONSUME,
        amount: paid.neg(),
        balanceBefore,
        balanceAfter,
        relatedType: "compute",
        relatedId: meta.relatedId ?? null,
        description: meta.description,
      },
    });

    return { transactionId: transaction.id, paid, unpaid };
  }

  /**
   * 确保企业钱包存在（不存在则创建）。
   * 公开是因为扣费链路必须在进入事务前保证钱包存在 ——
   * 事务内再建钱包会和乐观锁的版本比对纠缠在一起。
   */
  async ensureWalletExists(enterpriseId: string) {
    return this.ensureWallet(enterpriseId);
  }

  /**
   * 确保企业钱包存在（不存在则创建）
   */
  private async ensureWallet(enterpriseId: string) {
    let wallet = await this.prisma.enterpriseWallet.findUnique({
      where: { enterpriseId },
    });

    if (!wallet) {
      wallet = await this.prisma.enterpriseWallet.create({
        data: { enterpriseId },
      });
    }

    return wallet;
  }
}
