import {
  HttpException, HttpStatus, Injectable, InternalServerErrorException, Logger, ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { ChatCompletionRequest } from 'shared';
import { RedisService } from '../../redis/redis.service';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';

// All keys share the enterprise hash tag. Rejection only removes expired leases.
export const GATEWAY_ADMISSION_SCRIPT = `
local execution = ARGV[1]
local lease = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
local memberConcurrency = tonumber(ARGV[4])
local enterpriseConcurrency = tonumber(ARGV[5])
local memberRpm = tonumber(ARGV[6])
local enterpriseRpm = tonumber(ARGV[7])
local tokenLimit = tonumber(ARGV[8])
local reservation = tonumber(ARGV[9])
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
if redis.call('ZSCORE', KEYS[1], execution) or redis.call('ZSCORE', KEYS[2], execution) then
  return {-1, 0, 0, 0, 0}
end
local function concurrency(key, limit, rule)
  local count = redis.call('ZCARD', key)
  if count >= limit then
    local first = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local deadline = tonumber(first[2])
    return {0, rule, count, deadline - now, deadline}
  end
end
local denied = concurrency(KEYS[2], memberConcurrency, 1)
if denied then return denied end
denied = concurrency(KEYS[1], enterpriseConcurrency, 2)
if denied then return denied end
local function counter(key)
  local raw = redis.call('GET', key)
  if not raw then return 0, window end
  local count = tonumber(raw)
  local ttl = redis.call('PTTL', key)
  if not string.match(raw, '^%d+$') or (string.len(raw) > 1 and string.sub(raw, 1, 1) == '0') or
      not count or count < 0 or count ~= math.floor(count) or ttl < 0 then
    error('Invalid gateway admission counter')
  end
  return count, math.max(1, ttl)
end
local memberCount, memberTtl = counter(KEYS[3])
local enterpriseCount, enterpriseTtl = counter(KEYS[4])
local tokenCount, tokenTtl = 0, window
if tokenLimit > 0 then tokenCount, tokenTtl = counter(KEYS[5]) end
if memberCount >= memberRpm then return {0, 3, memberCount, memberTtl, now + memberTtl} end
if enterpriseCount >= enterpriseRpm then return {0, 4, enterpriseCount, enterpriseTtl, now + enterpriseTtl} end
if tokenLimit > 0 and reservation > tokenLimit - tokenCount then
  return {0, 5, tokenCount, tokenTtl, now + tokenTtl}
end
local function increment(key, amount)
  if redis.call('EXISTS', key) == 0 then
    redis.call('SET', key, amount, 'PX', window)
  else
    redis.call('INCRBY', key, amount)
  end
end
local deadline = now + lease
local function addLease(key)
  redis.call('ZADD', key, deadline, execution)
  local last = redis.call('ZRANGE', key, -1, -1, 'WITHSCORES')
  redis.call('PEXPIREAT', key, tonumber(last[2]))
end
addLease(KEYS[1])
addLease(KEYS[2])
increment(KEYS[3], 1)
increment(KEYS[4], 1)
if tokenLimit > 0 then increment(KEYS[5], reservation) end
return {1, 0, 0, lease, deadline}
`;

// Match the owned deadline as well as ID, so a late release cannot remove a newer lease.
export const GATEWAY_ADMISSION_RELEASE_SCRIPT = `
local removed = 0
for i = 1, 2 do
  local deadline = redis.call('ZSCORE', KEYS[i], ARGV[1])
  if deadline and tonumber(deadline) == tonumber(ARGV[2]) then
    removed = removed + redis.call('ZREM', KEYS[i], ARGV[1])
  end
end
return removed
`;

export interface GatewayAdmissionLease {
  release: () => Promise<void>;
}

// requestId is optional server-side correlation metadata, not a model parameter.
export type GatewayAdmissionRequest = ChatCompletionRequest & { requestId?: string };

@Injectable()
export class GatewayAdmissionService {
  private readonly logger = new Logger(GatewayAdmissionService.name);
  private readonly memberConcurrency: number;
  private readonly enterpriseConcurrency: number;
  private readonly memberRpm: number;
  private readonly enterpriseRpm: number;
  private readonly tokenBudget: number;
  private readonly defaultMaxTokens: number;
  private readonly leaseMs: number;
  private readonly windowMs = 60_000;

  constructor(private readonly redisService: RedisService, config: ConfigService) {
    this.memberConcurrency = integerConfig(config, 'GATEWAY_MEMBER_CONCURRENCY', 4);
    this.enterpriseConcurrency = integerConfig(config, 'GATEWAY_ENTERPRISE_CONCURRENCY', 32);
    this.memberRpm = integerConfig(config, 'GATEWAY_MEMBER_RPM', 120);
    this.enterpriseRpm = integerConfig(config, 'GATEWAY_ENTERPRISE_RPM', 600);
    this.tokenBudget = integerConfig(config, 'GATEWAY_ENTERPRISE_TOKEN_BUDGET', 0, 0);
    this.defaultMaxTokens = integerConfig(config, 'GATEWAY_DEFAULT_MAX_TOKENS', 4096);
    this.leaseMs = Math.max(
      integerConfig(config, 'GATEWAY_STREAM_TOTAL_TIMEOUT_MS', 600_000),
      integerConfig(config, 'GATEWAY_NON_STREAM_TIMEOUT_MS', 120_000),
    ) + 120_000;
  }

  async acquire(
    claims: ClientEmploymentClaims, executionId: string, dto: GatewayAdmissionRequest,
  ): Promise<GatewayAdmissionLease> {
    const enterpriseHash = hash(claims.enterpriseId);
    const memberHash = hash(claims.memberId);
    const prefix = `sep:gateway:admission:v1:{${enterpriseHash}}`;
    const keys = [
      `${prefix}:concurrency:enterprise`, `${prefix}:concurrency:member:${memberHash}`,
      `${prefix}:rpm:member:${memberHash}`, `${prefix}:rpm:enterprise`, `${prefix}:tokens:enterprise`,
    ];
    const context = { executionId, requestId: dto.requestId, enterpriseHash, memberHash };
    let result: number[];
    try {
      if (typeof executionId !== 'string' || !executionId.trim()) throw new ServiceUnavailableException();
      // Byte units deliberately overestimate text tokens; include tool schemas and all serialized input.
      const { requestId: _requestId, ...input } = dto;
      const maxTokens = dto.max_tokens ?? this.defaultMaxTokens;
      if (this.tokenBudget > 0 && (!Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
        throw new ServiceUnavailableException();
      }
      const reservation = this.tokenBudget === 0 ? 0
        : Buffer.byteLength(JSON.stringify(input), 'utf8') + maxTokens;
      if (!Number.isSafeInteger(reservation) || reservation < 0) throw new ServiceUnavailableException();
      const raw: unknown = await this.redisService.redis.eval(
        GATEWAY_ADMISSION_SCRIPT, keys.length, ...keys, executionId, this.leaseMs, this.windowMs,
        this.memberConcurrency, this.enterpriseConcurrency, this.memberRpm, this.enterpriseRpm,
        this.tokenBudget, reservation,
      );
      if (!Array.isArray(raw) || raw.length !== 5 || !raw.every(Number.isSafeInteger) ||
          ![0, 1].includes(raw[0]) || raw[2] < 0 || raw[3] <= 0 || raw[4] <= raw[3] ||
          (raw[0] === 1 ? raw[1] !== 0 || raw[2] !== 0 || raw[3] !== this.leaseMs
            : raw[1] < 1 || raw[1] > 5 || (raw[1] === 5 && this.tokenBudget === 0))) {
        throw new ServiceUnavailableException();
      }
      result = raw;
    } catch {
      this.logger.error(JSON.stringify({ event: 'gateway_admission_unavailable', ...context }));
      throw new ServiceUnavailableException({
        error: {
          message: 'Gateway admission is temporarily unavailable', type: 'server_error',
          code: 'PLATFORM_ADMISSION_UNAVAILABLE', source: 'platform', param: null,
        },
      });
    }
    const [allowed, ruleId, count, ttl, resetAt] = result;
    if (!allowed) {
      const rules = [
        { rule: 'gateway-member-concurrency', dimension: 'enterprise/member', limit: this.memberConcurrency, code: 'PLATFORM_CONCURRENCY_LIMIT_EXCEEDED' },
        { rule: 'gateway-enterprise-concurrency', dimension: 'enterprise', limit: this.enterpriseConcurrency, code: 'PLATFORM_CONCURRENCY_LIMIT_EXCEEDED' },
        { rule: 'gateway-member-rpm', dimension: 'enterprise/member', limit: this.memberRpm, code: 'PLATFORM_RATE_LIMIT_EXCEEDED' },
        { rule: 'gateway-enterprise-rpm', dimension: 'enterprise', limit: this.enterpriseRpm, code: 'PLATFORM_RATE_LIMIT_EXCEEDED' },
        { rule: 'gateway-enterprise-token-budget', dimension: 'enterprise', limit: this.tokenBudget, code: 'PLATFORM_TOKEN_BUDGET_EXCEEDED' },
      ];
      const { code, ...rule } = rules[ruleId - 1];
      const retryAfterSeconds = Math.ceil(ttl / 1000);
      const rateLimit = {
        ...rule, count, windowMs: ruleId <= 2 ? this.leaseMs : this.windowMs, resetAt, retryAfterSeconds,
      };
      this.logger.warn(JSON.stringify({ event: 'gateway_admission_exceeded', ...context, code, ...rateLimit }));
      throw new HttpException({
        error: {
          message: 'Gateway admission budget exceeded', type: 'rate_limit_error', code,
          source: 'platform', param: null, rateLimit,
        },
        retryAfterSeconds,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
    let releasePromise: Promise<void> | undefined;
    return {
      release: () => {
        releasePromise ??= (async () => {
          try {
            await this.redisService.redis.eval(
              GATEWAY_ADMISSION_RELEASE_SCRIPT, 2, ...keys.slice(0, 2), executionId, resetAt,
            );
          } catch {
            // Do not mask the upstream outcome in finally; bounded leases recover after Redis outages.
            this.logger.error(JSON.stringify({ event: 'gateway_admission_release_failed', ...context }));
          }
        })();
        return releasePromise;
      },
    };
  }
}

function hash(identity: string): string {
  return createHash('sha256').update(identity).digest('hex');
}

function integerConfig(config: ConfigService, name: string, fallback: number, minimum = 1): number {
  const raw = config.get<unknown>(name) ?? fallback;
  const value = typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw)) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < minimum || value > 2_147_483_647) {
    throw new InternalServerErrorException(`${name} must be an integer between ${minimum} and 2147483647`);
  }
  return value;
}
