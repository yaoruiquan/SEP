import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';

/**
 * 旧 Token 配额体系的**只读**视图。
 *
 * 统一人民币口径后，算力的唯一账本是 EnterpriseWallet + SubscriptionCredit
 * （见 ComputeCreditService）。本模块保留下来只为让历史数据可查、可对账：
 *
 *  - 不再有任何写入路径。企业充值只进钱包，赠送额度只由订阅履约发放。
 *  - 不再参与对话扣减。对话前的余额闸门与对话后的扣费都走人民币账本。
 *
 * 刻意删掉了 `consumeQuota` / `checkQuotaBeforeConversation` /
 * `purchaseEnterpriseQuota` / `allocate*`：留着写入能力会生成永远花不掉的
 * Token 余额，比没有这个功能更让人误解。
 */
@Injectable()
export class ComputeQuotaService {
  constructor(
    private prisma: PrismaService,
    private enterpriseContext: EnterpriseContextService,
  ) {}

  /** 历史订阅 Token 配额（迁移期展示用）。 */
  async listSubscriptionQuotas(userId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);

    const quotas = await this.prisma.subscriptionQuota.findMany({
      where: { enterpriseId: ctx.enterpriseId },
      include: {
        subscription: {
          include: {
            employee: { select: { id: true, name: true, avatar: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return quotas.map((quota) => ({
      id: quota.id,
      subscriptionId: quota.subscriptionId,
      employeeId: quota.subscription.employee.id,
      employeeName: quota.subscription.name ?? quota.subscription.employee.name,
      employeeAvatar: quota.subscription.employee.avatar,
      totalTokens: quota.totalTokens,
      usedTokens: quota.usedTokens,
      status: quota.status,
      createdAt: quota.createdAt,
      /** 提醒调用方：这是历史数据，不是可用余额 */
      legacy: true as const,
    }));
  }

  /** 历史成员个人 Token 配额（迁移期展示用）。 */
  async listUserQuotas(userId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);

    const quotas = await this.prisma.userQuota.findMany({
      where: { enterpriseId: ctx.enterpriseId },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
      orderBy: { allocatedAt: 'desc' },
    });

    return quotas.map((q) => ({
      id: q.id,
      userId: q.userId,
      name: q.user.name,
      email: q.user.email,
      avatar: q.user.avatar,
      totalTokens: q.totalTokens,
      usedTokens: q.usedTokens,
      status: q.status,
      allocatedAt: q.allocatedAt,
      notes: q.notes,
      legacy: true as const,
    }));
  }

  /** 历史企业 Token 池（迁移期展示用）。 */
  async listEnterpriseQuotas(userId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    const quotas = await this.prisma.computeQuota.findMany({
      where: { enterpriseId: ctx.enterpriseId },
      orderBy: { createdAt: 'desc' },
    });
    return quotas.map((q) => ({ ...q, legacy: true as const }));
  }

  /**
   * 历史 Token 配额汇总。这些数字只用于「你还有一批旧额度没处理」的提示，
   * 不能当成余额展示 —— 前端必须显式标注它已停用。
   */
  async getLegacyQuotaSummary(userId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);

    const [userQuotas, subQuotas, enterpriseQuotas] = await Promise.all([
      this.prisma.userQuota.aggregate({
        where: { enterpriseId: ctx.enterpriseId },
        _sum: { totalTokens: true, usedTokens: true },
      }),
      this.prisma.subscriptionQuota.aggregate({
        where: { enterpriseId: ctx.enterpriseId },
        _sum: { totalTokens: true, usedTokens: true },
      }),
      this.prisma.computeQuota.aggregate({
        where: { enterpriseId: ctx.enterpriseId },
        _sum: { totalTokens: true, usedTokens: true },
      }),
    ]);

    const remaining = (agg: { _sum: { totalTokens: number | null; usedTokens: number | null } }) =>
      Math.max(0, (agg._sum.totalTokens ?? 0) - (agg._sum.usedTokens ?? 0));

    return {
      deprecated: true as const,
      user: {
        totalTokens: userQuotas._sum.totalTokens ?? 0,
        usedTokens: userQuotas._sum.usedTokens ?? 0,
        remainingTokens: remaining(userQuotas),
      },
      subscription: {
        totalTokens: subQuotas._sum.totalTokens ?? 0,
        usedTokens: subQuotas._sum.usedTokens ?? 0,
        remainingTokens: remaining(subQuotas),
      },
      enterprise: {
        totalTokens: enterpriseQuotas._sum.totalTokens ?? 0,
        usedTokens: enterpriseQuotas._sum.usedTokens ?? 0,
        remainingTokens: remaining(enterpriseQuotas),
      },
    };
  }

  /** 单个历史企业配额详情（含旧交易记录）。 */
  async getQuotaDetail(userId: string, quotaId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);

    const quota = await this.prisma.computeQuota.findUnique({
      where: { id: quotaId },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });

    if (!quota) throw new NotFoundException(`Quota ${quotaId} not found`);
    if (quota.enterpriseId !== ctx.enterpriseId) {
      throw new ForbiddenException('无权访问该配额');
    }

    return quota;
  }
}
