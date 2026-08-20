import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { WalletService } from '../wallet/wallet.service';

export const ENTERPRISE_QUOTA_PACKAGES = [
  // 基于当前 MODEL_PRICING 的 7.2 汇率换算，并为输出 token、平台运维与波动预留安全边际。
  // Token 包是混合模型额度，不等同于某一个模型的公开单价；价格越大的包单价越低。
  { id: 'starter', name: '起步包', priceCny: 8, tokens: 100_000, detail: '适合试用与小团队' },
  { id: 'team', name: '团队包', priceCny: 50, tokens: 1_000_000, detail: '适合日常办公使用', recommended: true },
  { id: 'scale', name: '规模包', priceCny: 200, tokens: 5_000_000, detail: '适合高频调用与多人共享' },
] as const;

export interface QuotaCheckResult {
  allowed: boolean;
  tier?: 'USER' | 'SUBSCRIPTION' | 'ENTERPRISE';
  quotaId?: string;
  remaining?: number;
  reason?: string;
}

export interface QuotaConsumeResult {
  tier: 'USER' | 'SUBSCRIPTION' | 'ENTERPRISE';
  quotaId: string;
  quotaType: string;
  consumed: number;
  remaining: number;
}

const ALERT_THRESHOLD = 0.1; // 10% 剩余时告警

@Injectable()
export class ComputeQuotaService {
  constructor(
    private prisma: PrismaService,
    private enterpriseContext: EnterpriseContextService,
    private walletService: WalletService,
  ) {}

  /**
   * 三级配额检查（对话前乐观检查）
   * Priority 0: 用户个人配额 → Priority 1: 订阅自带配额 → Priority 2: 企业池
   */
  async checkQuotaBeforeConversation(userId: string): Promise<QuotaCheckResult> {
    const ctx = await this.enterpriseContext.resolve(userId);

    // 1️⃣ 检查用户个人配额
    const userQuota = await this.prisma.userQuota.findUnique({
      where: { userId_enterpriseId: { userId, enterpriseId: ctx.enterpriseId } },
    });
    if (userQuota && userQuota.status === 'ACTIVE') {
      const remaining = userQuota.totalTokens - userQuota.usedTokens;
      if (remaining > 0) {
        return { allowed: true, tier: 'USER', quotaId: userQuota.id, remaining };
      }
    }

    // 2️⃣ 检查订阅自带配额（当前企业所有ACTIVE订阅）
    const subQuota = await this.prisma.subscriptionQuota.findFirst({
      where: {
        enterpriseId: ctx.enterpriseId,
        status: 'ACTIVE',
        usedTokens: { lt: this.prisma.subscriptionQuota.fields.totalTokens },
      },
      include: { subscription: { include: { employee: true } } },
    });
    if (subQuota) {
      const remaining = subQuota.totalTokens - subQuota.usedTokens;
      if (remaining > 0) {
        return { allowed: true, tier: 'SUBSCRIPTION', quotaId: subQuota.id, remaining };
      }
    }

    // 3️⃣ 检查企业池
    const enterpriseQuotas = await this.prisma.computeQuota.findMany({
      where: { enterpriseId: ctx.enterpriseId, status: 'ACTIVE' },
      orderBy: { priority: 'asc' },
    });
    const availableEnterprise = enterpriseQuotas.find(
      (q) => q.usedTokens < q.totalTokens,
    );
    if (availableEnterprise) {
      const remaining = availableEnterprise.totalTokens - availableEnterprise.usedTokens;
      return { allowed: true, tier: 'ENTERPRISE', quotaId: availableEnterprise.id, remaining };
    }

    return { allowed: false, reason: '所有配额已耗尽，请联系管理员分配配额或充值' };
  }

  getQuotaPackages() {
    return ENTERPRISE_QUOTA_PACKAGES.map((item) => ({ ...item, unitPriceCnyPerMillion: item.priceCny / (item.tokens / 1_000_000) }));
  }

  async purchaseEnterpriseQuota(userId: string, packageId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    this.enterpriseContext.assertEnterpriseAdmin(ctx);
    const selected = ENTERPRISE_QUOTA_PACKAGES.find((item) => item.id === packageId);
    if (!selected) throw new BadRequestException('算力包不存在');

    return this.prisma.$transaction(async (tx) => {
      const walletTx = await this.walletService.consume(
        ctx.enterpriseId,
        selected.priceCny,
        'compute',
        null,
        `购买企业算力包「${selected.name}」：${selected.tokens.toLocaleString()} tokens`,
        tx,
      );
      const quota = await tx.computeQuota.create({
        data: {
          enterpriseId: ctx.enterpriseId,
          type: 'STANDARD',
          totalTokens: selected.tokens,
          priority: 2,
          status: 'ACTIVE',
        },
      });
      return { quota, walletTransaction: walletTx, package: selected };
    });
  }

  /**
   * 三级配额消费
   * 先扣用户个人配额 → 再扣订阅配额 → 最后扣企业池
   */
  async consumeQuota(
    userId: string,
    tokens: number,
    sessionId: string,
  ): Promise<QuotaConsumeResult[]> {
    const ctx = await this.enterpriseContext.resolve(userId);

    const account = await this.prisma.computeAccount.findUnique({
      where: { enterpriseId: ctx.enterpriseId },
    });
    if (!account) throw new NotFoundException('企业算力账户不存在');

    let remainingTokens = tokens;
    const results: QuotaConsumeResult[] = [];

    // 1️⃣ 用户个人配额（priority=0）
    if (remainingTokens > 0) {
      const userQuota = await this.prisma.userQuota.findUnique({
        where: { userId_enterpriseId: { userId, enterpriseId: ctx.enterpriseId } },
        include: { user: { select: { name: true } } },
      });

      if (userQuota && userQuota.status === 'ACTIVE') {
        const available = userQuota.totalTokens - userQuota.usedTokens;
        if (available > 0) {
          const toConsume = Math.min(remainingTokens, available);
          const newUsed = userQuota.usedTokens + toConsume;

          await this.prisma.userQuota.update({
            where: { id: userQuota.id },
            data: {
              usedTokens: newUsed,
              status: newUsed >= userQuota.totalTokens ? 'EXHAUSTED' : 'ACTIVE',
            },
          });

          await this.prisma.computeTransaction.create({
            data: {
              accountId: account.id,
              type: 'CONSUME',
              amount: toConsume * -1,
              sessionId,
              userQuotaId: userQuota.id,
              quotaTier: 'USER',
              quotaType: `${userQuota.user?.name ?? '成员'}个人配额`,
              tokens: toConsume,
              description: `对话消费 ${toConsume} tokens（个人配额）`,
              metadata: { enterpriseId: ctx.enterpriseId, memberId: ctx.memberId },
            },
          });

          results.push({
            tier: 'USER',
            quotaId: userQuota.id,
            quotaType: `${userQuota.user?.name ?? '成员'}个人配额`,
            consumed: toConsume,
            remaining: Math.max(0, userQuota.totalTokens - newUsed),
          });
          remainingTokens -= toConsume;
        }
      }
    }

    // 2️⃣ 订阅自带配额（priority=1）
    if (remainingTokens > 0) {
      const subQuotas = await this.prisma.subscriptionQuota.findMany({
        where: { enterpriseId: ctx.enterpriseId, status: 'ACTIVE' },
        include: { subscription: { include: { employee: true } } },
        orderBy: { createdAt: 'asc' },
      });

      for (const sq of subQuotas) {
        if (remainingTokens <= 0) break;
        const available = sq.totalTokens - sq.usedTokens;
        if (available <= 0) continue;

        const toConsume = Math.min(remainingTokens, available);
        const newUsed = sq.usedTokens + toConsume;
        const employeeName = sq.subscription?.employee?.name ?? '硅基员工';

        await this.prisma.subscriptionQuota.update({
          where: { id: sq.id },
          data: {
            usedTokens: newUsed,
            status: newUsed >= sq.totalTokens ? 'EXHAUSTED' : 'ACTIVE',
          },
        });

        await this.prisma.computeTransaction.create({
          data: {
            accountId: account.id,
            type: 'CONSUME',
            amount: toConsume * -1,
            sessionId,
            subscriptionQuotaId: sq.id,
            quotaTier: 'SUBSCRIPTION',
            quotaType: `${employeeName}订阅配额`,
            tokens: toConsume,
            description: `对话消费 ${toConsume} tokens（订阅配额）`,
            metadata: { enterpriseId: ctx.enterpriseId, memberId: ctx.memberId },
          },
        });

        results.push({
          tier: 'SUBSCRIPTION',
          quotaId: sq.id,
          quotaType: `${employeeName}订阅配额`,
          consumed: toConsume,
          remaining: Math.max(0, sq.totalTokens - newUsed),
        });
        remainingTokens -= toConsume;
      }
    }

    // 3️⃣ 企业池（priority=2，兜底）
    if (remainingTokens > 0) {
      const enterpriseQuotas = await this.prisma.computeQuota.findMany({
        where: { enterpriseId: ctx.enterpriseId, status: 'ACTIVE' },
        orderBy: { priority: 'asc' },
      });

      for (const eq of enterpriseQuotas) {
        if (remainingTokens <= 0) break;
        const available = eq.totalTokens - eq.usedTokens;
        if (available <= 0) continue;

        const toConsume = Math.min(remainingTokens, available);
        const newUsed = eq.usedTokens + toConsume;

        await this.prisma.computeQuota.update({
          where: { id: eq.id },
          data: {
            usedTokens: newUsed,
            status: newUsed >= eq.totalTokens ? 'EXHAUSTED' : 'ACTIVE',
          },
        });

        await this.prisma.computeTransaction.create({
          data: {
            accountId: account.id,
            type: 'CONSUME',
            amount: toConsume * -1,
            sessionId,
            quotaId: eq.id,
            quotaTier: 'ENTERPRISE',
            quotaType: `${eq.type}企业池`,
            tokens: toConsume,
            description: `对话消费 ${toConsume} tokens（企业池）`,
            metadata: { enterpriseId: ctx.enterpriseId, memberId: ctx.memberId },
          },
        });

        results.push({
          tier: 'ENTERPRISE',
          quotaId: eq.id,
          quotaType: `${eq.type}企业池`,
          consumed: toConsume,
          remaining: Math.max(0, eq.totalTokens - newUsed),
        });
        remainingTokens -= toConsume;
      }
    }

    return results;
  }

  // ── 用户个人配额管理 ────────────────────────────────────────────────────────

  /** 管理员为碳基员工分配/修改个人配额 */
  async allocateUserQuota(
    adminUserId: string,
    targetUserId: string,
    totalTokens: number,
    notes?: string,
  ) {
    const ctx = await this.enterpriseContext.resolve(adminUserId);
    this.enterpriseContext.assertEnterpriseAdmin(ctx);

    // 确认目标用户在同一企业
    const targetMember = await this.prisma.enterpriseMember.findFirst({
      where: { userId: targetUserId, enterpriseId: ctx.enterpriseId },
    });
    if (!targetMember) throw new NotFoundException('目标用户不在当前企业');

    return this.prisma.userQuota.upsert({
      where: { userId_enterpriseId: { userId: targetUserId, enterpriseId: ctx.enterpriseId } },
      create: {
        userId: targetUserId,
        enterpriseId: ctx.enterpriseId,
        totalTokens,
        usedTokens: 0,
        status: 'ACTIVE',
        allocatedBy: adminUserId,
        notes,
      },
      update: {
        totalTokens,
        status: 'ACTIVE', // 重新分配时恢复active
        allocatedBy: adminUserId,
        allocatedAt: new Date(),
        notes,
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }

  /** 查询企业所有成员的个人配额 */
  async listUserQuotas(adminUserId: string) {
    const ctx = await this.enterpriseContext.resolve(adminUserId);

    const members = await this.prisma.enterpriseMember.findMany({
      where: { enterpriseId: ctx.enterpriseId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            userQuotas: {
              where: { enterpriseId: ctx.enterpriseId },
            },
          },
        },
      },
    });

    return members.map((m) => ({
      memberId: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      avatar: m.user.avatar,
      role: m.role,
      quota: m.user.userQuotas[0] ?? null,
    }));
  }

  // ── 订阅配额管理 ────────────────────────────────────────────────────────────

  /** 创建订阅时自动创建订阅配额（由订阅服务调用） */
  async createSubscriptionQuota(
    subscriptionId: string,
    enterpriseId: string,
    totalTokens: number,
  ) {
    return this.prisma.subscriptionQuota.upsert({
      where: { subscriptionId },
      create: {
        subscriptionId,
        enterpriseId,
        totalTokens,
        usedTokens: 0,
        status: 'ACTIVE',
      },
      update: {},
    });
  }

  /** 查询企业所有订阅配额 */
  async listSubscriptionQuotas(userId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);

    return this.prisma.subscriptionQuota.findMany({
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
  }

  // ── 企业池配额管理 ──────────────────────────────────────────────────────────

  /** 管理员分配企业配额池 */
  async allocateEnterpriseQuota(
    userId: string,
    data: { type: string; totalTokens: number; priority?: number; expiresAt?: Date },
  ) {
    const ctx = await this.enterpriseContext.resolve(userId);
    this.enterpriseContext.assertEnterpriseAdmin(ctx);

    return this.prisma.computeQuota.create({
      data: {
        enterpriseId: ctx.enterpriseId,
        type: data.type,
        totalTokens: data.totalTokens,
        priority: data.priority ?? 2,
        expiresAt: data.expiresAt,
        status: 'ACTIVE',
      },
    });
  }

  /** 查询企业配额池列表 */
  async listEnterpriseQuotas(userId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    return this.prisma.computeQuota.findMany({
      where: { enterpriseId: ctx.enterpriseId },
      orderBy: { priority: 'asc' },
    });
  }

  /** 查询企业配额总览（三层汇总） */
  async getQuotaSummary(userId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);

    const [userQuotas, subQuotas, enterpriseQuotas] = await Promise.all([
      this.prisma.userQuota.aggregate({
        where: { enterpriseId: ctx.enterpriseId, status: 'ACTIVE' },
        _sum: { totalTokens: true, usedTokens: true },
      }),
      this.prisma.subscriptionQuota.aggregate({
        where: { enterpriseId: ctx.enterpriseId, status: 'ACTIVE' },
        _sum: { totalTokens: true, usedTokens: true },
      }),
      this.prisma.computeQuota.aggregate({
        where: { enterpriseId: ctx.enterpriseId, status: 'ACTIVE' },
        _sum: { totalTokens: true, usedTokens: true },
      }),
    ]);

    return {
      user: {
        totalTokens: userQuotas._sum.totalTokens ?? 0,
        usedTokens: userQuotas._sum.usedTokens ?? 0,
      },
      subscription: {
        totalTokens: subQuotas._sum.totalTokens ?? 0,
        usedTokens: subQuotas._sum.usedTokens ?? 0,
      },
      enterprise: {
        totalTokens: enterpriseQuotas._sum.totalTokens ?? 0,
        usedTokens: enterpriseQuotas._sum.usedTokens ?? 0,
      },
    };
  }

  /** 配额告警检查 */
  async checkQuotaAlerts(enterpriseId: string) {
    const [userQuotas, subQuotas, enterpriseQuotas] = await Promise.all([
      this.prisma.userQuota.findMany({ where: { enterpriseId, status: 'ACTIVE' } }),
      this.prisma.subscriptionQuota.findMany({ where: { enterpriseId, status: 'ACTIVE' } }),
      this.prisma.computeQuota.findMany({ where: { enterpriseId, status: 'ACTIVE' } }),
    ]);

    const alerts: Array<{ tier: string; quotaId: string; name: string; remaining: number; percentage: number }> = [];

    for (const q of [...userQuotas, ...subQuotas, ...enterpriseQuotas]) {
      const remaining = q.totalTokens - q.usedTokens;
      const percentage = q.totalTokens > 0 ? remaining / q.totalTokens : 0;
      if (percentage <= ALERT_THRESHOLD && percentage > 0) {
        const tier = 'userId' in q ? 'USER' : 'subscriptionId' in q ? 'SUBSCRIPTION' : 'ENTERPRISE';
        alerts.push({
          tier,
          quotaId: q.id,
          name: q.id,
          remaining,
          percentage: Math.round(percentage * 100),
        });
      }
    }

    return alerts;
  }

  // ── 兼容旧接口（compute-quota.controller 调用的） ─────────────────────────

  /** @deprecated 使用 listEnterpriseQuotas + listUserQuotas + listSubscriptionQuotas */
  async listQuotas(userId: string) {
    return this.listEnterpriseQuotas(userId);
  }

  async getQuotaDetail(userId: string, quotaId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);

    const quota = await this.prisma.computeQuota.findUnique({
      where: { id: quotaId },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });

    if (!quota) throw new NotFoundException(`Quota ${quotaId} not found`);
    if (quota.enterpriseId !== ctx.enterpriseId) throw new ForbiddenException('无权访问该配额');

    return quota;
  }

  async allocateQuota(
    userId: string,
    data: { type: string; totalTokens: number; priority?: number; expiresAt?: Date },
  ) {
    return this.allocateEnterpriseQuota(userId, data);
  }
}
