import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ModelRuntimePolicySnapshot } from 'shared';
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
  redis.call('SET', KEYS[2], window, 'PX', window)
  return {1, 1, window, now + window, window}
end
local originalWindow = tonumber(redis.call('GET', KEYS[2]) or '0')
if count >= limit then
  return {0, count, ttl, now + ttl, originalWindow}
end
count = redis.call('INCR', KEYS[1])
return {1, count, ttl, now + ttl, originalWindow}
`;

export interface GatewayRateLimitResult {
  allowed: boolean;
  rule: 'gateway-model';
  dimension: 'enterprise/member/subscription';
  limit: number;
  windowMs?: number;
  count: number;
  retryAfterSeconds: number;
  resetAt: number;
  keyHash: string;
  policyVersion: number;
}

@Injectable()
export class GatewayRateLimitService {
  private readonly logger = new Logger(GatewayRateLimitService.name);
  constructor(private readonly redisService: RedisService) {}

  async consume(claims: ClientEmploymentClaims, snapshot: ModelRuntimePolicySnapshot, requestId?: string): Promise<GatewayRateLimitResult> {
    const limit = snapshot.values.GATEWAY_MODEL_RATE_LIMIT;
    const windowMs = snapshot.values.GATEWAY_MODEL_RATE_WINDOW_MS;
    const keyHash = createHash('sha256')
      .update(JSON.stringify([claims.enterpriseId, claims.memberId, claims.subscriptionId]))
      .digest('hex');
    let result: unknown;
    const key = `sep:gateway:rate:v1:${keyHash}`;
    try {
      result = await this.redisService.redis.eval(
        // Hash the legacy key itself so metadata shares its slot without migrating counters.
        GATEWAY_RATE_LIMIT_SCRIPT, 2, key, `{${key}}:window`, limit, windowMs,
      );
      if (!Array.isArray(result) || result.length !== 5 ||
          !result.every((value) => Number.isSafeInteger(value)) ||
          ![0, 1].includes(result[0]) || result[1] < 1 || result[2] <= 0 || result[3] <= 0 || result[4] < 0) {
        throw new ServiceUnavailableException();
      }
    } catch {
      this.logger.error(JSON.stringify({ event: 'gateway_rate_limit_unavailable', requestId, keyHash }));
      throw new ServiceUnavailableException({
        error: {
          message: '模型网关限流服务暂不可用，请稍后重试', type: 'server_error',
          code: 'PLATFORM_RATE_LIMIT_UNAVAILABLE', source: 'platform', param: null, policyVersion: snapshot.version,
        },
      });
    }
    const [allowed, count, ttl, resetAt, originalWindow] = result as number[];
    const admission: GatewayRateLimitResult = {
      allowed: allowed === 1, rule: 'gateway-model', dimension: 'enterprise/member/subscription',
      limit, ...(originalWindow > 0 ? { windowMs: originalWindow } : {}), count, retryAfterSeconds: Math.ceil(ttl / 1000),
      resetAt, keyHash, policyVersion: snapshot.version,
    };
    if (!admission.allowed) {
      this.logger.warn(JSON.stringify({ event: 'gateway_rate_limit_exceeded', requestId, ...admission }));
    }
    return admission;
  }
}
