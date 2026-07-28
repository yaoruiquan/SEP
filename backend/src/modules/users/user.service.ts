import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateProfileDto, ChangePasswordDto, UserProfileResponse } from 'shared';
import * as bcrypt from 'bcrypt';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private enterpriseContext: EnterpriseContextService,
  ) {}

  async getProfile(userId: string): Promise<UserProfileResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserProfileResponse> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return user;
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const isValid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isValid) throw new UnauthorizedException('Current password is incorrect');

    const hashed = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });
  }

  /**
   * 企业算力用量。账户主体是【企业】（套餐含算力额度，按企业结算）。
   *
   * ⚠️ 多租户要点：ComputeTransaction 自身没有 enterpriseId，
   * 归属只能经 accountId → ComputeAccount.enterpriseId 确认。
   * 这里先由 userId 解析出企业、再取该企业的账户，
   * 因此后续所有按 accountId 的查询天然限定在本企业内。
   */
  async getComputeUsage(userId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);

    // 获取或创建企业计费账户
    const account = await this.prisma.computeAccount.upsert({
      where: { enterpriseId: ctx.enterpriseId },
      create: { enterpriseId: ctx.enterpriseId, balance: 0 },
      update: {},
    });

    // 交易列表只展示最近 100 条
    const transactions = await this.prisma.computeTransaction.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // 汇总必须基于【全部】交易，不能只统计上面这 100 条。
    // 原实现用同一个 take(100) 的结果集算 totalCost，用户交易超过 100 笔后
    // 「累计消费」会停止增长（静默少算），与前端「累计消费」的语义不符。
    // 同时原实现要求 tx.metadata 存在才计入 totalCost，导致无 metadata 的
    // 消费记录被漏掉；金额统计不应依赖 metadata 是否齐全。
    const costAgg = await this.prisma.computeTransaction.aggregate({
      where: { accountId: account.id, type: 'CONSUME' },
      _sum: { amount: true },
    });
    const totalCost = Math.abs(costAgg._sum.amount ?? 0);

    // token 数存在 metadata 里，无法用 SQL 聚合，需遍历全部消费记录。
    const allConsume = await this.prisma.computeTransaction.findMany({
      where: { accountId: account.id, type: 'CONSUME' },
      select: { metadata: true },
    });
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    for (const tx of allConsume) {
      const meta = tx.metadata as { inputTokens?: number; outputTokens?: number } | null;
      if (!meta) continue;
      totalInputTokens += meta.inputTokens ?? 0;
      totalOutputTokens += meta.outputTokens ?? 0;
    }

    return {
      balance: account.balance,
      totalCost,
      totalInputTokens,
      totalOutputTokens,
      transactions: transactions.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        description: tx.description,
        metadata: tx.metadata,
        createdAt: tx.createdAt,
      })),
    };
  }
}
