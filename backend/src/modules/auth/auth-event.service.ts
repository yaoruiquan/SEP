import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface RecordAuthEventInput {
  userId?: string;
  action: string;
  success?: boolean;
  provider?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuthEventService {
  private readonly logger = new Logger(AuthEventService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuthEventInput): Promise<void> {
    try {
      const metadata = this.sanitizeMetadata(input.metadata);
      await this.prisma.authEvent.create({
        data: {
          userId: input.userId,
          action: input.action,
          success: input.success ?? true,
          provider: input.provider,
          sessionId: input.sessionId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          metadata,
        },
      });
    } catch (error) {
      // 安全事件不能阻断登录、登出或密码操作主流程；记录失败供运维排查。
      this.logger.warn(`认证事件写入失败: ${input.action}`, error instanceof Error ? error.message : String(error));
    }
  }

  private sanitizeMetadata(metadata: Prisma.InputJsonValue | undefined): Prisma.InputJsonValue | undefined {
    if (metadata === undefined || metadata === null) return metadata;

    const blocked = new Set([
      'password',
      'token',
      'code',
      'secret',
      'accesstoken',
      'refreshtoken',
      'authorization',
    ]);
    const sanitize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sanitize);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => !blocked.has(key.toLowerCase().replace(/[_-]/g, '')))
          .map(([key, child]) => [key, sanitize(child)]),
      );
    };

    return sanitize(metadata) as Prisma.InputJsonValue;
  }

  async listForUser(userId: string, limit = 30) {
    return this.prisma.authEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        action: true,
        success: true,
        provider: true,
        sessionId: true,
        ipAddress: true,
        userAgent: true,
        metadata: true,
        createdAt: true,
      },
    });
  }
}
