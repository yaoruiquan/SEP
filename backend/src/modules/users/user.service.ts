import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateProfileDto, ChangePasswordDto, UserProfileResponse } from 'shared';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

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

  async getComputeUsage(userId: string) {
    // 获取或创建计费账户
    const account = await this.prisma.computeAccount.upsert({
      where: { userId },
      create: { userId, balance: 0 },
      update: {},
    });

    // 获取最近的交易记录（最多 100 条）
    const transactions = await this.prisma.computeTransaction.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // 统计总消费和总 token 使用量
    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const tx of transactions) {
      if (tx.type === 'CONSUME' && tx.metadata) {
        const meta = tx.metadata as any;
        totalCost += Math.abs(tx.amount);
        totalInputTokens += meta.inputTokens || 0;
        totalOutputTokens += meta.outputTokens || 0;
      }
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
