import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthEventService } from './auth-event.service';
import { Optional } from '@nestjs/common';
import { SettingService } from '../setting/setting.service';
import { SETTING_KEYS } from 'shared';

export interface LoginAuditContext {
  provider: 'password' | 'desktop-password';
  ipAddress?: string;
  userAgent?: string;
  emailHash?: string;
}

export interface PasswordCredentialSnapshot {
  passwordHash: string | null;
  failedCount: number;
  lockedUntil: Date | null;
}

@Injectable()
export class AuthRiskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: AuthEventService,
    @Optional() private readonly settings?: SettingService,
  ) {}

  private async maxFailedAttempts(): Promise<number> {
    const raw = this.settings ? await this.settings.getEffectiveValue(SETTING_KEYS.AUTH_MAX_FAILED_ATTEMPTS) : this.config.get<string>('AUTH_MAX_FAILED_ATTEMPTS');
    const value = Number(raw ?? 5);
    return Number.isInteger(value) && value >= 3 && value <= 20 ? value : 5;
  }

  private async lockMinutes(): Promise<number> {
    const raw = this.settings ? await this.settings.getEffectiveValue(SETTING_KEYS.AUTH_LOCK_MINUTES) : this.config.get<string>('AUTH_LOCK_MINUTES');
    const value = Number(raw ?? 15);
    return Number.isInteger(value) && value >= 1 && value <= 1440 ? value : 15;
  }

  private auditMetadata(context: LoginAuditContext, extra?: Record<string, string | number | boolean>) {
    return {
      ...(context.emailHash ? { emailHash: context.emailHash } : {}),
      ...extra,
    };
  }

  async assertLoginAllowed(
    userId: string,
    credential: PasswordCredentialSnapshot | undefined,
    context: LoginAuditContext,
  ): Promise<void> {
    const lockedUntil = credential?.lockedUntil;
    if (lockedUntil && lockedUntil > new Date()) {
      await this.events.record({
        userId,
        action: 'LOGIN_FAILED',
        success: false,
        provider: context.provider,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: this.auditMetadata(context, { reason: 'account_locked' }),
      });
      throw new UnauthorizedException('邮箱或密码错误');
    }
  }

  async recordPasswordFailure(
    userId: string,
    passwordHash: string | null,
    context: LoginAuditContext,
  ): Promise<void> {
    const current = await this.prisma.authCredential.findUnique({
      where: { userId_type: { userId, type: 'LOCAL_PASSWORD' } },
      select: { failedCount: true, lockedUntil: true },
    });
    const previousCount = current?.lockedUntil && current.lockedUntil <= new Date()
      ? 0
      : current?.failedCount ?? 0;
    const failedCount = previousCount + 1;
    const [maxFailedAttempts, lockMinutes] = await Promise.all([this.maxFailedAttempts(), this.lockMinutes()]);
    const locked = failedCount >= maxFailedAttempts;
    const lockedUntil = locked
      ? new Date(Date.now() + lockMinutes * 60 * 1000)
      : null;

    await this.prisma.authCredential.upsert({
      where: { userId_type: { userId, type: 'LOCAL_PASSWORD' } },
      create: {
        userId,
        type: 'LOCAL_PASSWORD',
        passwordHash,
        failedCount,
        lockedUntil,
      },
      update: {
        failedCount,
        lockedUntil,
      },
    });

    await this.events.record({
      userId,
      action: 'LOGIN_FAILED',
      success: false,
      provider: context.provider,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: this.auditMetadata(context, { reason: 'invalid_password', failedCount }),
    });
    if (locked) {
      await this.events.record({
        userId,
        action: 'ACCOUNT_LOCKED',
        success: true,
        provider: context.provider,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: this.auditMetadata(context, { failedCount, lockMinutes }),
      });
    }
  }

  async recordPasswordSuccess(userId: string): Promise<void> {
    await this.prisma.authCredential.updateMany({
      where: { userId, type: 'LOCAL_PASSWORD' },
      data: { failedCount: 0, lockedUntil: null, lastUsedAt: new Date() },
    });
  }

  async recordAnonymousFailure(context: LoginAuditContext, reason = 'invalid_credentials'): Promise<void> {
    await this.events.record({
      action: 'LOGIN_FAILED',
      success: false,
      provider: context.provider,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: this.auditMetadata(context, { reason }),
    });
  }
}
