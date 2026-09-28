import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { OAuthIntent, OAuthProviderId } from './oauth.types';
import { Optional } from '@nestjs/common';
import { SettingService } from '../setting/setting.service';
import { SETTING_KEYS } from 'shared';

export interface OAuthTransactionResult {
  id: string;
  state: string;
  nonce: string;
  expiresAt: Date;
}

export interface ConsumedOAuthTransaction {
  id: string;
  provider: string;
  intent: string;
  redirectUri: string;
  userId: string | null;
  metadata: unknown;
}

@Injectable()
export class OAuthStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional() private readonly settings?: SettingService,
  ) {}

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private async ttlSeconds(): Promise<number> {
    const raw = this.settings
      ? await this.settings.getEffectiveValue(SETTING_KEYS.OAUTH_TRANSACTION_TTL_SECONDS)
      : this.config.get<string>('OAUTH_TRANSACTION_TTL_SECONDS');
    const configured = Number(raw ?? 300);
    return Number.isInteger(configured) && configured >= 60 && configured <= 900 ? configured : 300;
  }

  async create(input: {
    provider: OAuthProviderId;
    intent?: OAuthIntent;
    redirectUri: string;
    userId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<OAuthTransactionResult> {
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + (await this.ttlSeconds()) * 1000);
    const row = await this.prisma.authOAuthTransaction.create({
      data: {
        provider: input.provider,
        intent: input.intent ?? 'LOGIN',
        stateHash: this.hash(state),
        nonceHash: this.hash(nonce),
        redirectUri: input.redirectUri,
        userId: input.userId,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    });
    return { id: row.id, state, nonce, expiresAt: row.expiresAt };
  }

  async consume(input: {
    provider: OAuthProviderId;
    state: string;
    redirectUri: string;
  }): Promise<ConsumedOAuthTransaction> {
    if (!input.state || input.state.length < 20) {
      throw new BadRequestException('OAuth state 无效');
    }
    const row = await this.prisma.authOAuthTransaction.findUnique({
      where: { stateHash: this.hash(input.state) },
    });
    const now = new Date();
    if (
      !row ||
      row.provider !== input.provider ||
      row.redirectUri !== input.redirectUri ||
      row.expiresAt <= now ||
      row.consumedAt
    ) {
      throw new BadRequestException('OAuth state 无效或已过期');
    }
    const claimed = await this.prisma.authOAuthTransaction.updateMany({
      where: { id: row.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) throw new BadRequestException('OAuth state 无效或已被使用');
    return {
      id: row.id,
      provider: row.provider,
      intent: row.intent,
      redirectUri: row.redirectUri,
      userId: row.userId,
      metadata: row.metadata,
    };
  }
}
