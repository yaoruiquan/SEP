import { Injectable, InternalServerErrorException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { RedisService } from '../../redis/redis.service';
import type { EnterpriseContext } from '../enterprise/enterprise-context.service';

// Both buckets share an enterprise hash slot. Denials neither consume the other
// bucket nor extend expiry; all validation happens before either bucket changes.
export const KNOWLEDGE_RATE_LIMIT_SCRIPT = `
local counts = {}
local ttls = {}
for i = 1, 2 do
  local raw = redis.call('GET', KEYS[i])
  local ttl = redis.call('PTTL', KEYS[i])
  counts[i] = 0
  ttls[i] = 0
  if raw then
    local count = tonumber(raw)
    if not count or count < 1 or count > 2147483647 or count ~= math.floor(count) or ttl < 0 or ttl > 2147483647 then
      return redis.error_reply('Invalid knowledge rate limit bucket')
    end
    if ttl > 0 then
      counts[i] = count
      ttls[i] = ttl
    end
  end
end
if counts[1] >= tonumber(ARGV[1]) or counts[2] >= tonumber(ARGV[2]) then
  return {0, counts[1], counts[2], ttls[1], ttls[2]}
end
for i = 1, 2 do
  if ttls[i] <= 0 then
    redis.call('SET', KEYS[i], 1, 'PX', ARGV[3])
    counts[i] = 1
    ttls[i] = tonumber(ARGV[3])
  else
    counts[i] = redis.call('INCR', KEYS[i])
  end
end
return {1, counts[1], counts[2], ttls[1], ttls[2]}
`;

export type KnowledgeRateLimitOperation = 'search' | 'source';
type Dimension = 'member' | 'enterprise';
type Counters = { allowed: number; limited: number; unavailable: number };
type Bucket = { limit: number; count: number; remaining: number };

export interface KnowledgeRateLimitResult {
  allowed: boolean;
  operation: KnowledgeRateLimitOperation;
  windowMs: number;
  retryAfterSeconds: number;
  exceeded: Dimension[];
  member: Bucket;
  enterprise: Bucket;
}

@Injectable()
export class KnowledgeRateLimitService implements OnModuleInit {
  private readonly limits: Record<KnowledgeRateLimitOperation, Record<Dimension, number>>;
  private readonly windowMs: number;
  private readonly timeoutMs: number;
  private readonly stats: Record<KnowledgeRateLimitOperation, Counters> = {
    search: { allowed: 0, limited: 0, unavailable: 0 },
    source: { allowed: 0, limited: 0, unavailable: 0 },
  };

  constructor(private readonly redisService: RedisService, config: ConfigService) {
    this.limits = {
      search: {
        member: positiveInteger(config, 'KNOWLEDGE_SEARCH_MEMBER_RATE_LIMIT', 60),
        enterprise: positiveInteger(config, 'KNOWLEDGE_SEARCH_ENTERPRISE_RATE_LIMIT', 600),
      },
      source: {
        member: positiveInteger(config, 'KNOWLEDGE_SOURCE_MEMBER_RATE_LIMIT', 120),
        enterprise: positiveInteger(config, 'KNOWLEDGE_SOURCE_ENTERPRISE_RATE_LIMIT', 1200),
      },
    };
    this.windowMs = positiveInteger(config, 'KNOWLEDGE_RATE_LIMIT_WINDOW_MS', 60_000);
    this.timeoutMs = positiveInteger(config, 'KNOWLEDGE_RATE_LIMIT_TIMEOUT_MS', 1000, 30_000);
  }

  onModuleInit() {
    // The shared client is lazy: initiate its connection without enqueueing quota commands offline.
    const redis = this.redisService.redis;
    if (redis?.status === 'wait') void redis.connect().catch(() => undefined);
  }

  async consume(
    identity: Pick<EnterpriseContext, 'enterpriseId' | 'memberId'>,
    operation: KnowledgeRateLimitOperation,
  ): Promise<KnowledgeRateLimitResult> {
    const limits = this.limits[operation];
    const enterpriseHash = digest(identity.enterpriseId);
    const memberHash = digest(JSON.stringify([identity.enterpriseId, identity.memberId]));
    const prefix = `sep:knowledge:rate:v1:{${enterpriseHash}}:${operation}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const redis = this.redisService.redis;
      // Do not enqueue offline commands that could unexpectedly consume quota
      // after the HTTP request has already failed.
      if (redis?.status !== 'ready') throw unavailable();
      const reply: unknown = await Promise.race([
        redis.eval(
          KNOWLEDGE_RATE_LIMIT_SCRIPT, 2, `${prefix}:member:${memberHash}`, `${prefix}:enterprise`,
          limits.member, limits.enterprise, this.windowMs,
        ),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(unavailable()), this.timeoutMs); }),
      ]);
      const result = this.parseReply(reply, operation);
      this.stats[operation][result.allowed ? 'allowed' : 'limited']++;
      return result;
    } catch {
      this.stats[operation].unavailable++;
      throw unavailable();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Process-local counters; monitoring can aggregate them across instances. */
  getStats(): Record<KnowledgeRateLimitOperation, Counters> {
    return { search: { ...this.stats.search }, source: { ...this.stats.source } };
  }

  private parseReply(reply: unknown, operation: KnowledgeRateLimitOperation): KnowledgeRateLimitResult {
    if (!Array.isArray(reply) || reply.length !== 5 || !reply.every(value => Number.isSafeInteger(value)) ||
      ![0, 1].includes(reply[0]) || reply.slice(1).some(value => value < 0 || value > 2_147_483_647)) {
      throw unavailable();
    }
    const [admitted, memberCount, enterpriseCount, memberTtl, enterpriseTtl] = reply as number[];
    const counts = { member: memberCount, enterprise: enterpriseCount };
    const ttls = { member: memberTtl, enterprise: enterpriseTtl };
    const limits = this.limits[operation];
    const dimensions: Dimension[] = ['member', 'enterprise'];
    if (dimensions.some(dimension => (counts[dimension] === 0) !== (ttls[dimension] === 0))) throw unavailable();
    const exceeded = dimensions.filter(dimension => counts[dimension] >= limits[dimension]);
    if ((admitted === 1 && dimensions.some(dimension => counts[dimension] < 1 || counts[dimension] > limits[dimension])) ||
      (admitted === 0 && exceeded.length === 0)) throw unavailable();
    return {
      allowed: admitted === 1, operation, windowMs: this.windowMs,
      retryAfterSeconds: admitted === 1 ? 0 : Math.ceil(Math.max(...exceeded.map(dimension => ttls[dimension])) / 1000),
      exceeded: admitted === 1 ? [] : exceeded,
      member: { limit: limits.member, count: memberCount, remaining: Math.max(0, limits.member - memberCount) },
      enterprise: { limit: limits.enterprise, count: enterpriseCount, remaining: Math.max(0, limits.enterprise - enterpriseCount) },
    };
  }
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'KNOWLEDGE_RATE_LIMIT_UNAVAILABLE', message: 'Knowledge rate limiting is temporarily unavailable. Please retry later.',
  });
}

function positiveInteger(config: ConfigService, key: string, fallback: number, maximum = 2_147_483_647): number {
  const raw = config.get<unknown>(key) ?? fallback;
  const value = typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw)) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new InternalServerErrorException({
      code: 'KNOWLEDGE_RATE_LIMIT_CONFIG_INVALID', message: `${key} must be an integer between 1 and ${maximum}`,
    });
  }
  return value;
}
