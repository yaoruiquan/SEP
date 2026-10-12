import { Injectable, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { RedisService } from '../../redis/redis.service';

// Only failed authentication reaches these buckets. Check both before creating
// keys so a blocked source cannot create unlimited random-token buckets.
export const GATEWAY_AUTH_RATE_LIMIT_SCRIPT = `
local window = tonumber(ARGV[3])
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local counts = {}
local ttls = {}
for i = 1, 2 do
  counts[i] = tonumber(redis.call('GET', KEYS[i]) or '0')
  ttls[i] = redis.call('PTTL', KEYS[i])
  if ttls[i] > 0 and counts[i] >= tonumber(ARGV[i]) then
    return {0, i, tonumber(ARGV[i]), counts[i], ttls[i], now + ttls[i]}
  end
end
for i = 1, 2 do
  if ttls[i] <= 0 then
    redis.call('SET', KEYS[i], 1, 'PX', window)
    counts[i] = 1
    ttls[i] = window
  else
    counts[i] = redis.call('INCR', KEYS[i])
  end
end
return {1, 1, tonumber(ARGV[1]), counts[1], ttls[1], now + ttls[1]}
`;

export interface GatewayAuthRateLimitResult {
  allowed: boolean;
  rule: 'gateway-auth';
  dimension: 'token/socket' | 'socket';
  limit: number;
  count: number;
  windowMs: number;
  retryAfterSeconds: number;
  resetAt: number;
}

@Injectable()
export class GatewayAuthRateLimitService {
  private readonly tokenLimit: number;
  private readonly sourceLimit: number;
  private readonly windowMs: number;

  constructor(private readonly redisService: RedisService, config: ConfigService) {
    this.tokenLimit = positiveInteger(config, 'GATEWAY_AUTH_FAILURE_TOKEN_LIMIT', 120);
    this.sourceLimit = positiveInteger(config, 'GATEWAY_AUTH_FAILURE_SOURCE_LIMIT', 1200);
    this.windowMs = positiveInteger(config, 'GATEWAY_AUTH_FAILURE_WINDOW_MS', 60_000);
  }

  async consumeFailure(tokenFingerprint: string, socketAddress: string): Promise<GatewayAuthRateLimitResult> {
    const sourceHash = digest(socketAddress);
    const tokenHash = digest(JSON.stringify([sourceHash, tokenFingerprint]));
    const prefix = 'sep:gateway:auth:v1:{gateway-auth}';
    let result: unknown;
    try {
      result = await this.redisService.redis.eval(
        GATEWAY_AUTH_RATE_LIMIT_SCRIPT, 2,
        `${prefix}:token:${tokenHash}`, `${prefix}:source:${sourceHash}`,
        this.tokenLimit, this.sourceLimit, this.windowMs,
      );
      if (!Array.isArray(result) || result.length !== 6 ||
          !result.every((value) => Number.isSafeInteger(value)) ||
          ![0, 1].includes(result[0]) || ![1, 2].includes(result[1]) ||
          result.slice(2).some((value) => value <= 0)) {
        throw new ServiceUnavailableException();
      }
    } catch {
      throw new ServiceUnavailableException({
        error: {
          message: 'Authentication protection temporarily unavailable', type: 'server_error',
          code: 'GATEWAY_AUTH_RATE_LIMIT_UNAVAILABLE', source: 'platform', param: null,
        },
      });
    }
    const [allowed, dimension, limit, count, ttl, resetAt] = result as number[];
    return {
      allowed: allowed === 1, rule: 'gateway-auth', dimension: dimension === 1 ? 'token/socket' : 'socket',
      limit, count, windowMs: this.windowMs, retryAfterSeconds: Math.ceil(ttl / 1000), resetAt,
    };
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function positiveInteger(config: ConfigService, name: string, fallback: number): number {
  const raw = config.get<string | number>(name) ?? fallback;
  const value = typeof raw === 'number' || /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new InternalServerErrorException(`${name} must be an integer between 1 and 2147483647`);
  }
  return value;
}
