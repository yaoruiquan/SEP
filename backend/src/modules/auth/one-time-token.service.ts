import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type OneTimeTokenKind = 'PASSWORD_RESET' | 'EMAIL_VERIFICATION' | 'EMAIL_CHANGE';

export interface ConsumedOneTimeToken {
  id: string;
  userId: string;
  type: OneTimeTokenKind;
  metadata: Record<string, unknown> | null;
}

/** 一次性认证令牌：只把 SHA-256 摘要落库，明文只在邮件链接中短暂存在。 */
@Injectable()
export class OneTimeTokenService {
  private readonly ttlSeconds = 20 * 60;

  constructor(private readonly prisma: PrismaService) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  issueTtlSeconds(): number {
    return this.ttlSeconds;
  }

  async issue(input: {
    userId: string;
    type: OneTimeTokenKind;
    metadata?: Record<string, unknown>;
  }): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.authOneTimeToken.updateMany({
        where: {
          userId: input.userId,
          type: input.type,
          consumedAt: null,
        },
        data: { consumedAt: new Date() },
      });
      await tx.authOneTimeToken.create({
        data: {
          userId: input.userId,
          type: input.type,
          tokenHash: this.hash(token),
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
          expiresAt,
        },
      });
    });

    return { token, expiresAt };
  }

  async consume(token: string, type: OneTimeTokenKind): Promise<ConsumedOneTimeToken> {
    if (!token) throw new BadRequestException('令牌无效或已过期');
    const record = await this.prisma.authOneTimeToken.findUnique({
      where: { tokenHash: this.hash(token) },
    });
    if (!record || record.type !== type || record.consumedAt || record.expiresAt <= new Date()) {
      throw new BadRequestException('令牌无效或已过期');
    }

    const consumed = await this.prisma.authOneTimeToken.updateMany({
      where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new BadRequestException('令牌无效或已过期');

    return {
      id: record.id,
      userId: record.userId,
      type: record.type,
      metadata: record.metadata as Record<string, unknown> | null,
    };
  }
}
