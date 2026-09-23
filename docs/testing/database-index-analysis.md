# Database Index Analysis

**Generated**: 2026-09-23
**Status**: ✅ Analysis Complete

## Executive Summary

Database indexes have been reviewed across all performance-critical tables. **Current indexing is adequate** for production launch with the following observations:

- ✅ **Chat/messaging queries**: Well-indexed (`sessionId + createdAt`)
- ✅ **Billing/transaction queries**: Well-indexed (`walletId + createdAt DESC`)
- ✅ **Enterprise queries**: Well-indexed (`enterpriseId + createdAt`)
- ⚠️ **Task execution**: Missing composite index on `taskRunId` (low priority - task volume is low)
- ⚠️ **Vector search**: No pgvector index (acceptable - Prisma doesn't manage pgvector indexes, handled via raw SQL)

**Recommendation**: Current indexes are sufficient for P0 launch. Task execution index can be added in P1 post-launch optimization.

---

## Index Coverage by Performance-Critical Table

### 1. ConversationSession (Chat)

**Query Pattern**: Users browse their chat history by conversation source

**Existing Indexes**:
```prisma
@@index([userId, source])
@@index([taskPlanId, taskStepId])
```

**Assessment**: ✅ **GOOD**
- Primary query: "Show all my conversations from CHAT/TASK source" → covered by `[userId, source]`
- Task-related queries: Task center needs to find sessions by plan/step → covered by `[taskPlanId, taskStepId]`
- No missing indexes detected

---

### 2. Message (Chat Messages)

**Query Pattern**: Load messages for a conversation session, ordered by time

**Existing Indexes**:
```prisma
@@index([sessionId, createdAt])
```

**Assessment**: ✅ **GOOD**
- Primary query: "Load all messages in session X, newest first" → perfectly covered
- Composite index supports both filtering (`sessionId`) and sorting (`createdAt`)
- No missing indexes detected

---

### 3. WalletTransaction (Billing)

**Query Pattern**: Show transaction history for an enterprise, most recent first

**Existing Indexes**:
```prisma
@@index([walletId, createdAt(sort: Desc)])
@@index([relatedType, relatedId])
@@index([paymentOrderId])
```

**Assessment**: ✅ **EXCELLENT**
- Primary query: "Show wallet transactions newest first" → perfectly covered by `[walletId, createdAt DESC]`
- Lookup by business entity: "Find all transactions for subscription X" → covered by `[relatedType, relatedId]`
- Payment reconciliation: "Find transaction for payment order Y" → covered by `[paymentOrderId]`
- No missing indexes detected

---

### 4. ComputeTransaction (Compute Credits)

**Query Pattern**: Show compute usage history for enterprise analytics

**Existing Indexes**:
```prisma
@@index([accountId, createdAt])
```

**Assessment**: ✅ **GOOD**
- Primary query: "Show compute transactions for account X" → covered
- Time-based filtering: "Show usage for last 30 days" → covered by composite index
- No missing indexes detected

---

### 5. TaskRunStep (Task Execution)

**Query Pattern**: Load all steps for a task run, check dependencies

**Existing Indexes**:
```prisma
@@unique([taskRunId, stepKey])
```

**Assessment**: ⚠️ **ACCEPTABLE** (Unique constraint provides index, but not optimized for sorting)
- Primary query: "Load all steps for task run X" → covered by unique constraint
- Unique constraint on `[taskRunId, stepKey]` creates a B-tree index usable for filtering
- **Missing**: No explicit composite index for `[taskRunId, order]` to efficiently load steps in execution order

**Recommendation**:
```prisma
@@index([taskRunId, order])  // P1 optimization for step loading
```

**Priority**: LOW
- Task volume is much lower than chat volume
- Unique constraint already provides good performance for small result sets
- Can be added in P1 post-launch optimization

---

### 6. TextChunk (Knowledge Base Vector Search)

**Query Pattern**: Vector similarity search for RAG

**Existing Indexes**:
```prisma
@@index([knowledgeBaseId])
@@index([documentId])
```

**Assessment**: ⚠️ **ACCEPTABLE** (pgvector index handled separately)
- Primary query: "Find similar vectors in knowledge base X" → uses pgvector extension
- `knowledgeBaseId` index covers filtering by knowledge base
- **Note**: pgvector indexes (HNSW/IVFFlat) are created via raw SQL, not managed by Prisma:
  ```sql
  CREATE INDEX ON text_chunks USING hnsw (embedding_vector vector_cosine_ops);
  ```

**Recommendation**:
- Check if pgvector index exists in production database
- If missing, create via migration:
  ```sql
  CREATE INDEX text_chunks_embedding_vector_idx
  ON text_chunks
  USING hnsw (embedding_vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
  ```

**Priority**: MEDIUM
- Only needed if knowledge base features are heavily used
- Can be added on-demand when vector search performance degrades

---

## Other Well-Indexed Tables

The following tables have appropriate indexes and need no changes:

| Table | Key Indexes | Query Pattern |
|-------|-------------|---------------|
| `AuditLog` | `[enterpriseId, createdAt]`, `[actorId, createdAt]`, `[action, createdAt]` | Audit trail queries by enterprise/user/action |
| `Department` | `[enterpriseId]`, `[parentId]` | Organization tree navigation |
| `EnterpriseMember` | `[enterpriseId]`, `[departmentId]` | Member lookup and department roster |
| `EnterpriseInvitation` | `[enterpriseId, email]`, `[enterpriseId, status]` | Invitation management |
| `EmployeeGrant` | `[subscriptionId]`, `[departmentId]`, `[memberId]` | Access control queries |
| `Capability` | `[enterpriseId, enterpriseReviewStatus]`, `[visibility, platformReviewStatus]` | Capability filtering and approval workflows |
| `SkillVersion` | `[capabilityId, status]`, `[ownerId, capabilityId]` | Version lookup and personal forks |

---

## Missing Indexes Summary

| Table | Missing Index | Priority | Reason |
|-------|--------------|----------|---------|
| `TaskRunStep` | `[taskRunId, order]` | **P1** (Low) | Optimize step loading order; unique constraint provides adequate performance for low volume |
| `TextChunk` | pgvector index | **P1** (Medium) | Only needed if vector search is slow; managed separately from Prisma |

---

## Performance Testing Recommendations

Before declaring database optimization complete, verify these queries perform well:

### 1. Conversation History Load (Expected: <50ms)
```sql
EXPLAIN ANALYZE
SELECT * FROM conversation_sessions
WHERE user_id = 'usr-xxx' AND source = 'CHAT'
ORDER BY created_at DESC
LIMIT 50;
```

### 2. Message Load (Expected: <30ms)
```sql
EXPLAIN ANALYZE
SELECT * FROM messages
WHERE session_id = 'sess-xxx'
ORDER BY created_at ASC;
```

### 3. Transaction History (Expected: <50ms)
```sql
EXPLAIN ANALYZE
SELECT * FROM wallet_transactions
WHERE wallet_id = 'wal-xxx'
ORDER BY created_at DESC
LIMIT 100;
```

### 4. Task Step Load (Expected: <20ms)
```sql
EXPLAIN ANALYZE
SELECT * FROM task_run_steps
WHERE task_run_id = 'run-xxx'
ORDER BY "order" ASC;
```

### 5. Vector Search (Expected: <100ms for top 10 results)
```sql
EXPLAIN ANALYZE
SELECT * FROM text_chunks
WHERE knowledge_base_id = 'kb-xxx'
ORDER BY embedding_vector <=> '[1024-dim vector]'
LIMIT 10;
```

**How to run**: Connect to production database and run these with real IDs from the system.

---

## Connection Pool Configuration

**Current Prisma Configuration** (from `prisma/schema.prisma`):
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

**Recommended Production DATABASE_URL**:
```bash
postgresql://user:pass@host:5432/sep_platform?connection_limit=20&pool_timeout=10
```

**Rationale**:
- `connection_limit=20`: Enough for backend API + background jobs
- `pool_timeout=10`: Fail fast if pool exhausted (detect connection leaks early)
- Default (unlimited) can exhaust PostgreSQL `max_connections`

**How to apply**: Update `.env.production` with the query parameters above.

---

## Slow Query Logging

**Enable in PostgreSQL** to catch queries >500ms:
```sql
ALTER SYSTEM SET log_min_duration_statement = 500;
SELECT pg_reload_conf();
```

**Check slow query log location**:
```sql
SHOW data_directory;  -- Log file: <data_directory>/log/postgresql-*.log
```

**Review weekly**: Look for queries without index usage (`Seq Scan` in EXPLAIN output).

---

## Checklist Update

Items to mark as complete in `docs/pre-launch-checklist.md`:

- [x] Check missing indexes (Section 3.1)
- [x] Review query patterns for conversation, billing, task execution
- [x] Document pgvector index requirement for vector search
- [x] Prisma connection pool settings documented
- [ ] Enable slow query logging (deployment-time task)
- [ ] Run performance tests with real data (deployment-time task)

---

## Next Steps

1. ✅ Index analysis complete - no critical missing indexes
2. ⏭️ Continue to **Section 3.2: Caching Strategy** in pre-launch checklist
3. 🔜 Add `TaskRunStep` index in P1 post-launch optimization
4. 🔜 Create pgvector index when knowledge base features are active
