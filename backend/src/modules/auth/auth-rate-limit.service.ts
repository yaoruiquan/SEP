import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';

export interface AuthRateLimitOptions {
  limit: number;
  windowSeconds: number;
}

export interface AuthRateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

/** Redis-backed short-window limiter for authentication abuse controls. */
@Injectable()
export class AuthRateLimitService {
  private readonly logger = new Logger(AuthRateLimitService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly config: ConfigService,
  ) {}

  private key(scope: string, identity: string): string {
    const digest = createHash('sha256').update(identity).digest('hex');
    return `sep:auth:rate:${scope}:${digest}`;
  }

  private configured(scope: string, fallback: AuthRateLimitOptions): AuthRateLimitOptions {
    const prefix = scope.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    const limit = Number(this.config.get<string>(`AUTH_RATE_${prefix}_LIMIT`) ?? fallback.limit);
    const windowSeconds = Number(this.config.get<string>(`AUTH_RATE_${prefix}_WINDOW_SECONDS`) ?? fallback.windowSeconds);
    return {
      limit: Number.isInteger(limit) && limit > 0 ? limit : fallback.limit,
      windowSeconds: Number.isInteger(windowSeconds) && windowSeconds > 0 ? windowSeconds : fallback.windowSeconds,
    };
  }

  async consume(scope: string, identity: string, fallback: AuthRateLimitOptions): Promise<AuthRateLimitResult> {
    const options = this.configured(scope, fallback);
    try {
      const redis = this.redisService.redis;
      const redisKey = this.key(scope, identity || 'anonymous');
      const count = await redis.incr(redisKey);
      if (count === 1) await redis.expire(redisKey, options.windowSeconds);
      const ttl = await redis.ttl(redisKey);
      return {
        allowed: count <= options.limit,
        count,
        limit: options.limit,
        retryAfterSeconds: ttl > 0 ? ttl : options.windowSeconds,
      };
    } catch (error) {
      // Redis failure must not turn authentication into a global outage. The
      // in-process request limiter remains the fallback safety net.
      this.logger.warn(`认证限流 Redis 不可用，降级放行 scope=${scope}`, error instanceof Error ? error.message : String(error));
      return { allowed: true, count: 0, limit: options.limit, retryAfterSeconds: 0 };
    }
  }

  async isBlocked(scope: string, identity: string, fallback: AuthRateLimitOptions): Promise<AuthRateLimitResult> {
    const options = this.configured(scope, fallback);
    try {
      const redis = this.redisService.redis;
      const redisKey = this.key(scope, identity || 'anonymous');
      const [raw, ttl] = await Promise.all([redis.get(redisKey), redis.ttl(redisKey)]);
      const count = Number(raw ?? 0);
      return {
        allowed: count < options.limit,
        count,
        limit: options.limit,
        retryAfterSeconds: count >= options.limit ? (ttl > 0 ? ttl : options.windowSeconds) : 0,
      };
    } catch (error) {
      this.logger.warn(`认证限流 Redis 不可用，检查降级放行 scope=${scope}`, error instanceof Error ? error.message : String(error));
      return { allowed: true, count: 0, limit: options.limit, retryAfterSeconds: 0 };
    }
  }
}
