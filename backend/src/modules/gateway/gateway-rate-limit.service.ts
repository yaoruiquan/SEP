import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { RedisService } from '../../redis/redis.service';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';

// Check, increment and expire together; denied retries never extend the window.
export const GATEWAY_RATE_LIMIT_SCRIPT = `
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then
  redis.call('SET', KEYS[1], 1, 'PX', window)
  return {1, 1, window, now + window}
end
if count >= limit then
  return {0, count, ttl, now + ttl}
end
count = redis.call('INCR', KEYS[1])
return {1, count, ttl, now + ttl}
`;

export interface GatewayRateLimitResult {
  allowed: boolean;
  rule: 'gateway-model';
  dimension: 'enterprise/member/subscription';
  limit: number;
  windowMs: number;
  count: number;
  retryAfterSeconds: number;
  resetAt: number;
  keyHash: string;
}

@Injectable()
export class GatewayRateLimitService {
  private readonly logger = new Logger(GatewayRateLimitService.name);
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(private readonly redisService: RedisService, config: ConfigService) {
    this.limit = positiveInteger(config, 'GATEWAY_MODEL_RATE_LIMIT', 60);
    this.windowMs = positiveInteger(config, 'GATEWAY_MODEL_RATE_WINDOW_MS', 60_000);
  }

  async consume(claims: ClientEmploymentClaims, requestId?: string): Promise<GatewayRateLimitResult> {
    const keyHash = createHash('sha256')
      .update(JSON.stringify([claims.enterpriseId, claims.memberId, claims.subscriptionId]))
      .digest('hex');
    let result: unknown;
    try {
      result = await this.redisService.redis.eval(
        GATEWAY_RATE_LIMIT_SCRIPT, 1, `sep:gateway:rate:v1:${keyHash}`, this.limit, this.windowMs,
      );
      if (!Array.isArray(result) || result.length !== 4 ||
          !result.every((value) => Number.isSafeInteger(value)) ||
          ![0, 1].includes(result[0]) || result[1] < 1 || result[2] <= 0 || result[3] <= 0) {
        throw new ServiceUnavailableException();
      }
    } catch {
      this.logger.error(JSON.stringify({ event: 'gateway_rate_limit_unavailable', requestId, keyHash }));
      throw new ServiceUnavailableException({
        error: {
          message: '模型网关限流服务暂不可用，请稍后重试', type: 'server_error',
          code: 'PLATFORM_RATE_LIMIT_UNAVAILABLE', source: 'platform', param: null,
        },
      });
    }
    const [allowed, count, ttl, resetAt] = result as number[];
    const admission: GatewayRateLimitResult = {
      allowed: allowed === 1, rule: 'gateway-model', dimension: 'enterprise/member/subscription',
      limit: this.limit, windowMs: this.windowMs, count, retryAfterSeconds: Math.ceil(ttl / 1000),
      resetAt, keyHash,
    };
    if (!admission.allowed) {
      this.logger.warn(JSON.stringify({ event: 'gateway_rate_limit_exceeded', requestId, ...admission }));
    }
    return admission;
  }
}

function positiveInteger(config: ConfigService, name: string, fallback: number): number {
  const raw = config.get<string | number>(name) ?? fallback;
  const value = typeof raw === 'number' || /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new InternalServerErrorException(`${name} must be an integer between 1 and 2147483647`);
  }
  return value;
}
