# Caching Strategy Review

**Generated**: 2026-09-23
**Status**: ⚠️ Redis infrastructure exists but underutilized

## Executive Summary

Redis is deployed and operational but **only used for session locking**. Key opportunities for caching to reduce database load:

- ⚠️ **Enterprise balance**: Queried frequently (every chat message, gateway call), not cached
- ⚠️ **Employee instance metadata**: Static during subscription lifetime, not cached
- ⚠️ **Capability configurations**: Static after upload, not cached
- ✅ **Session locking**: Already implemented via Redis (conversation concurrency control)

**Recommendation**: Add balance caching as **P1 optimization** post-launch. Current architecture can handle launch load without it, but caching will significantly improve performance under real traffic.

---

## Current Redis Usage

### ✅ Implemented: Session Locking

**Location**: `src/modules/conversation/session-lock.service.ts`

**Purpose**: Prevent concurrent message processing in the same conversation session

**Implementation**:
```typescript
// Acquire lock with TTL
await this.redisService.redis.set(
  lockKey,
  lockValue,
  'PX',
  this.lockTTL,
  'NX'
);

// Release lock with Lua script (atomic)
const script = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;
await this.redisService.redis.eval(script, 1, lockKey, lockValue);
```

**Assessment**: ✅ Well-implemented, uses Lua script for atomic release

---

## Missing Caching Opportunities

### 1. Enterprise Balance (HIGH PRIORITY)

**Current Implementation** (`src/modules/wallet/wallet.service.ts`):
```typescript
async getBalance(enterpriseId: string) {
  const wallet = await this.ensureWallet(enterpriseId);
  return {
    balance: wallet.balance,
    frozenAmount: wallet.frozenAmount,
    // ...
  };
}
```

**Problem**:
- Balance queried on **every chat message** (check if enterprise can afford model call)
- Balance queried on **every gateway request** (billing check)
- Database hit for every query → unnecessary load

**Recommended Cache Strategy**:
```typescript
async getBalance(enterpriseId: string) {
  const cacheKey = `balance:${enterpriseId}`;

  // Try cache first
  const cached = await this.redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // Cache miss → query DB
  const wallet = await this.ensureWallet(enterpriseId);
  const balance = {
    balance: wallet.balance,
    frozenAmount: wallet.frozenAmount,
    availableBalance: wallet.balance.minus(wallet.frozenAmount),
  };

  // Cache for 60 seconds
  await this.redis.setex(cacheKey, 60, JSON.stringify(balance));

  return balance;
}

// Invalidate on transaction
async recordTransaction(...) {
  // ... execute transaction ...

  // Invalidate cache
  await this.redis.del(`balance:${enterpriseId}`);
}
```

**TTL Rationale**:
- 60 seconds: Balance changes are not real-time critical
- Users won't notice 1-minute delay in balance updates
- Dramatically reduces DB load (1 query per minute instead of 1 per message)

**Invalidation Points**:
- After `recordTransaction` (deposit/consume/refund)
- After admin manual adjustment

---

### 2. Employee Instance Metadata (MEDIUM PRIORITY)

**Current Pattern**: Query employee instance details on every chat request

**Cacheable Data**:
- Instance configuration (model, temperature, max_tokens)
- Granted knowledge base IDs
- Capability bindings

**Recommended Cache Strategy**:
```typescript
async getInstanceConfig(instanceId: string) {
  const cacheKey = `instance:${instanceId}`;

  const cached = await this.redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const instance = await this.prisma.digitalEmployee.findUnique({
    where: { id: instanceId },
    include: {
      subscription: { include: { employee: true } },
      knowledgeGrants: { include: { knowledgeBase: true } },
    },
  });

  // Cache for 5 minutes (changes infrequent)
  await this.redis.setex(cacheKey, 300, JSON.stringify(instance));

  return instance;
}
```

**Invalidation Points**:
- After instance configuration update
- After knowledge base grant/revoke
- When subscription ends (instance deleted)

---

### 3. Capability Configurations (LOW PRIORITY)

**Current Pattern**: Load capability metadata on every execution

**Cacheable Data**:
- Capability type (agent/rpa/skill/ai-app)
- Execution configuration
- Skill version content (SKILL.md)

**Recommended Cache Strategy**:
```typescript
async getCapabilityConfig(capabilityId: string) {
  const cacheKey = `capability:${capabilityId}`;

  const cached = await this.redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const capability = await this.prisma.capability.findUnique({
    where: { id: capabilityId },
    include: { activeVersion: true },
  });

  // Cache for 10 minutes (capabilities rarely change after upload)
  await this.redis.setex(cacheKey, 600, JSON.stringify(capability));

  return capability;
}
```

**Invalidation Points**:
- After capability update
- After new version upload
- After capability deletion

---

## Cache Implementation Checklist

### P0 (Pre-Launch) - SKIP
- [ ] No caching changes required for launch
- [x] Redis infrastructure verified operational
- [x] Session locking working correctly

### P1 (Post-Launch Week 1)
- [ ] Implement enterprise balance caching (60s TTL)
- [ ] Add cache invalidation to wallet transaction methods
- [ ] Monitor cache hit rate (target >80%)
- [ ] Test balance consistency under concurrent transactions

### P2 (Post-Launch Week 2-4)
- [ ] Implement employee instance metadata caching (300s TTL)
- [ ] Implement capability configuration caching (600s TTL)
- [ ] Add cache warming for frequently accessed instances
- [ ] Implement cache metrics dashboard

---

## Redis Configuration Review

### Current Setup (docker-compose.yml)

```yaml
redis:
  image: redis:7-alpine
  container_name: sep-redis
  ports:
    - "6379:6379"
  volumes:
    - redis-data:/data
  command: redis-server --appendonly yes
```

**Assessment**: ✅ **GOOD**
- Persistence enabled (`--appendonly yes`)
- Version 7 (latest stable)
- Named volume for data persistence

**Production Recommendations**:
- Add maxmemory policy: `--maxmemory 2gb --maxmemory-policy allkeys-lru`
- Enable password: `--requirepass <strong-password>`
- Monitor memory usage with `redis-cli INFO memory`

---

## Cache Failure Handling

**Current Pattern**: No cache fallback implemented

**Recommended Pattern**:
```typescript
async getCachedOrFetch<T>(
  cacheKey: string,
  ttl: number,
  fetchFn: () => Promise<T>,
): Promise<T> {
  try {
    // Try cache first
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (error) {
    // Log cache error but don't fail request
    this.logger.warn(`Cache read failed for ${cacheKey}:`, error);
  }

  // Fetch from source
  const data = await fetchFn();

  try {
    // Try to cache result
    await this.redis.setex(cacheKey, ttl, JSON.stringify(data));
  } catch (error) {
    // Log cache write error but don't fail request
    this.logger.warn(`Cache write failed for ${cacheKey}:`, error);
  }

  return data;
}
```

**Principle**: Cache failures should never break user requests. Always fall back to direct database queries.

---

## Performance Impact Estimates

### Without Balance Caching (Current)
- Average conversation: 10 messages
- Each message: 1 balance query
- Total DB queries per conversation: **10 balance queries**
- 1000 concurrent conversations: **10,000 extra DB queries**

### With Balance Caching (60s TTL)
- Average conversation duration: 5 minutes
- Cache refreshes per conversation: 5 (once per minute)
- Total DB queries per conversation: **5 balance queries**
- 1000 concurrent conversations: **5,000 DB queries** (50% reduction)

### Expected Performance Improvement
- Database load: -50%
- Average API response time: -10-20ms (eliminate 1 DB roundtrip)
- P95 response time: -30-50ms (reduce DB connection pool contention)

---

## Monitoring & Metrics

**Key Metrics to Track**:
1. Cache hit rate: `hits / (hits + misses)` (target >80%)
2. Cache memory usage: `redis-cli INFO memory | grep used_memory_human`
3. Cache eviction rate: `redis-cli INFO stats | grep evicted_keys`
4. Balance query reduction: Compare DB slow query log before/after caching

**How to Monitor**:
```bash
# Redis hit rate
redis-cli INFO stats | grep -E "keyspace_hits|keyspace_misses"

# Memory usage
redis-cli INFO memory | grep used_memory_human

# Check if cache is working
redis-cli KEYS "balance:*" | wc -l  # Should show active balance caches
```

---

## Checklist Update

Items to mark in `docs/pre-launch-checklist.md`:

- [x] Section 3.2 - Redis infrastructure verified operational
- [x] Session locking implemented and working
- [ ] Enterprise balance caching (P1 post-launch)
- [ ] Instance metadata caching (P2 post-launch)
- [ ] Capability configuration caching (P2 post-launch)

---

## Next Steps

1. ✅ Caching review complete - no blocking issues for launch
2. ⏭️ Continue to **Section 3.3: Frontend Performance** in pre-launch checklist
3. 🔜 Implement balance caching in P1 post-launch optimization
4. 🔜 Add cache monitoring dashboard
