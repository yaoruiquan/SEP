import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { EnterpriseContextService } from '../src/modules/enterprise/enterprise-context.service';
import { KnowledgeAccessPolicy } from '../src/modules/knowledge/knowledge-access-policy';
import { DocumentService } from '../src/modules/knowledge/document.service';
import { DocumentProcessorService } from '../src/modules/knowledge/document-processor.service';
import { DocumentParserService } from '../src/modules/knowledge/document-parser.service';
import { TextTokenizer } from '../src/modules/knowledge/text-tokenizer.service';
import { TextChunker } from '../src/modules/knowledge/text-chunker.util';
import { LexicalSearchService } from '../src/modules/knowledge/lexical-search.service';
import { BM25Scorer } from '../src/modules/knowledge/bm25-scorer.service';
import { KnowledgeService } from '../src/modules/knowledge/knowledge.service';
import { KnowledgePrivateStorage } from '../src/modules/knowledge/knowledge-private-storage';
import { VectorService } from '../src/modules/knowledge/vector.service';
import { TextChunkService } from '../src/modules/knowledge/text-chunk.service';
import { KnowledgeRetentionService } from '../src/modules/knowledge/knowledge-retention.service';
import { KnowledgeTelemetryService } from '../src/modules/knowledge/knowledge-telemetry.service';
import { KnowledgeSearchService } from '../src/modules/knowledge/knowledge-search.service';
import { AuditService } from '../src/modules/audit/audit.service';

export async function run() {
  assert.equal(new URL(process.env.DATABASE_URL!).pathname, '/sep_kb_refactor_20261016');
  const root = await mkdtemp(join(tmpdir(), 'sep-kb-version-'));
  process.env.KNOWLEDGE_PRIVATE_PATH = root;
  const prisma = new PrismaService({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const policy = new KnowledgeAccessPolicy(prisma, new EnterpriseContextService(prisma));
  const vector = { invalidateCache() {} } as any;
  const vectorSearch = new VectorService(prisma);
  const documents = new DocumentService(prisma, {} as any, policy, vector);
  const chunkReads = new TextChunkService(prisma, policy);
  const knowledge = new KnowledgeService(prisma, policy, vector);
  const tokenizer = new TextTokenizer();
  const lexical = new LexicalSearchService(prisma, tokenizer, new BM25Scorer());
  // Explicit test config: no application .env, provider configuration or credentials are loaded.
  const config = new ConfigService({ KNOWLEDGE_HISTORY_RETENTION_DAYS: 30, KNOWLEDGE_RETENTION_BATCH_SIZE: 100 }, { skipProcessEnv: true });
  const retention = new KnowledgeRetentionService(prisma, config);
  const telemetry = new KnowledgeTelemetryService(new AuditService(prisma), policy, prisma, config);
  const parser = new DocumentParserService();
  let failEmbedding = false;
  let pauseEmbedding: (() => Promise<void>) | undefined;
  const embedding = {
    getProfile: () => ({ model: 'isolated-test-profile', dimension: 1024, tokenizer: 'isolated-test-only', distance: 'cosine' }),
    getBatchSize: () => 2,
    async embedBatch(texts: string[]) {
      if (pauseEmbedding) await pauseEmbedding();
      if (failEmbedding) throw new Error('intentional outage, never returned');
      return texts.map(() => ({ embedding: Float32Array.from({ length: 1024 }, (_, i) => i === 0 ? 1 : 0) }));
    },
  };
  // Domain pipeline uses the real chunker, with an explicit test-only tokenizer and mock model.
  (TextChunker as any).tokenizer = { id: 'isolated-test-only', encode: (text: string) => Array.from(text).map((_, i) => i) };
  const processor = new DocumentProcessorService(prisma, parser, embedding as any, vector, tokenizer);
  const file = (text: string, name = 'policy.txt') => ({ originalname: name, mimetype: 'text/plain', buffer: Buffer.from(text), size: Buffer.byteLength(text) }) as Express.Multer.File;
  const key = () => randomUUID();
  const checks: string[] = [];
  const check = async (name: string, run: () => Promise<void>) => { await run(); checks.push(name); console.log(`PASS ${name}`); };
  const createdEnterpriseIds: string[] = [];
  const createdUserIds: string[] = [];
  let lexicalEvaluation: Record<string, unknown> | undefined;
  let telemetryEvaluation: Record<string, unknown> | undefined;
  let retentionEvaluation: Record<string, unknown> | undefined;
  let permissionsEvaluation: Record<string, unknown> | undefined;
  try {
    const user = await prisma.user.create({ data: { email: `kb-version-${randomUUID()}@example.invalid`, name: 'Version test' } });
    createdUserIds.push(user.id);
    const admin = await prisma.user.create({ data: { email: `kb-metrics-${randomUUID()}@example.invalid`, name: 'Isolated metrics admin', role: 'ADMIN' } });
    createdUserIds.push(admin.id);
    const enterprise = await prisma.enterprise.create({ data: { name: 'Isolated KB version test' } });
    createdEnterpriseIds.push(enterprise.id);
    await prisma.enterpriseMember.create({ data: { enterpriseId: enterprise.id, userId: user.id, role: 'ENTERPRISE_ADMIN' } });
    const kb = await prisma.knowledgeBase.create({ data: { enterpriseId: enterprise.id, createdBy: user.id, name: 'KB version test' } });
    const input = file('Company policy 2026: expense reimbursement limit is 5000 CNY.');
    const uploadKey = key();
    let d = await documents.uploadDocument(kb.id, input, user.id, { idempotencyKey: uploadKey });
    const firstJob = await prisma.knowledgeProcessingJob.findFirstOrThrow({ where: { documentId: d.id } });
    await check('upload stores private original and durable job before processing', async () => {
      assert.equal(d.searchable, false); assert.equal(d.status, 'PENDING');
      assert.equal(firstJob.status, 'PENDING');
      assert.equal(JSON.stringify(d).includes(root), false);
    });
    await check('network replay creates neither duplicate document nor job', async () => {
      const replay = await documents.uploadDocument(kb.id, input, user.id, { idempotencyKey: uploadKey });
      assert.equal(replay.id, d.id);
      assert.equal(await prisma.knowledgeProcessingJob.count({ where: { documentId: d.id } }), 1);
      await assert.rejects(() => documents.uploadDocument(kb.id, file('a different request'), user.id, { idempotencyKey: uploadKey }), (e: any) => e.status === 409);
    });
    await check('first ingest parses, embeds, writes native vectors and publishes atomically', async () => {
      await processor.processJob(firstJob.id);
      d = await documents.getDocumentForUser(kb.id, d.id, user.id);
      assert.equal(d.status, 'READY', `ingest state=${d.status} code=${d.latestVersion?.errorCode}`); assert.equal(d.searchable, true); assert.equal(d.activeVersionId, d.latestVersionId);
      const preview = await documents.preview(kb.id, d.id, user.id, { page: 1, pageSize: 20, versionId: d.activeVersionId! });
      assert.equal(preview.previewKind, 'PARSED_BLOCKS'); assert.ok(preview.items[0].text.includes('5000'));
      assert.ok((await lexical.search('reimbursement', enterprise.id, [kb.id], 5)).length > 0);
    });
    const oldActive = d.activeVersionId;
    const replace = file('Company policy 2027: expense reimbursement limit is 9000 CNY.', 'updated-policy.txt');
    const replaceKey = key();
    const oldETag = d.etag;
    await check('one inflight version, revision guard and unchanged original deduplication', async () => {
      const unchanged = await documents.uploadVersion(kb.id, d.id, input, user.id, { ifMatch: d.etag, idempotencyKey: key() });
      assert.equal(unchanged.unchanged, true);
      assert.equal(unchanged.revision, d.revision);
      d = await documents.uploadVersion(kb.id, d.id, replace, user.id, { ifMatch: oldETag, idempotencyKey: replaceKey });
      const replay = await documents.uploadVersion(kb.id, d.id, replace, user.id, { ifMatch: oldETag, idempotencyKey: replaceKey });
      assert.equal(replay.latestVersionId, d.latestVersionId);
      await assert.rejects(() => documents.uploadVersion(kb.id, d.id, replace, user.id, { ifMatch: oldETag, idempotencyKey: key() }), (e: any) => e.status === 412);
      await assert.rejects(() => documents.uploadVersion(kb.id, d.id, replace, user.id, { ifMatch: d.etag, idempotencyKey: key() }), (e: any) => e.status === 409);
      assert.equal(d.activeVersionId, oldActive); assert.equal(d.searchable, true); assert.equal(d.originalName, 'policy.txt');
    });
    await check('legacy chunk reads cannot expose an unpublished replacement', async () => {
      const draft = await prisma.textChunk.create({ data: { knowledgeBaseId: kb.id, documentId: d.id,
        versionId: d.latestVersionId, indexGeneration: 1, ordinal: 0,
        content: 'Unpublished replacement draft.', source: 'policy.txt', tags: [], tokens: [] } });
      const visible = await chunkReads.listTextChunks(kb.id, user.id);
      assert.ok(visible.length);
      assert.ok(visible.every(chunk => chunk.content.includes('5000')));
      await assert.rejects(() => chunkReads.getTextChunk(kb.id, draft.id, user.id), (e: any) => e.status === 404);
    });
    const v2job = await prisma.knowledgeProcessingJob.findFirstOrThrow({ where: { versionId: d.latestVersionId } });
    await check('embedding outage does not publish or remove old active; automatic retries bounded', async () => {
      failEmbedding = true;
      for (let i = 0; i < 3; i++) {
        await prisma.knowledgeProcessingJob.update({ where: { id: v2job.id }, data: { nextRunAt: new Date(0) } });
        await processor.processJob(v2job.id);
      }
      d = await documents.getDocumentForUser(kb.id, d.id, user.id);
      assert.equal(d.status, 'FAILED'); assert.equal(d.activeVersionId, oldActive); assert.equal(d.searchable, true);
      assert.equal(d.latestVersion?.attempts, 3);
      assert.equal((await prisma.knowledgeProcessingJob.findUniqueOrThrow({ where: { id: v2job.id } })).status, 'FAILED');
      assert.ok((await documents.preview(kb.id, d.id, user.id, { page: 1, pageSize: 20 })).items[0].text.includes('5000'));
    });
    await check('manual retry uses new generation; successful replacement switches all content', async () => {
      failEmbedding = false;
      d = await documents.retry(kb.id, d.id, user.id, { ifMatch: d.etag, idempotencyKey: key() });
      const nextJob = await prisma.knowledgeProcessingJob.findFirstOrThrow({ where: { versionId: d.latestVersionId, generation: 2 } });
      await processor.processJob(nextJob.id);
      await processor.processJob(nextJob.id);
      d = await documents.getDocumentForUser(kb.id, d.id, user.id);
      assert.equal(d.status, 'READY'); assert.notEqual(d.activeVersionId, oldActive);
      assert.equal(await prisma.documentVersion.count({ where: { documentId: d.id, published: true } }), 1);
      assert.ok((await documents.preview(kb.id, d.id, user.id, { page: 1, pageSize: 20 })).items[0].text.includes('9000'));
      await assert.rejects(() => documents.preview(kb.id, d.id, user.id, { page: 1, pageSize: 20, versionId: oldActive! }), (e: any) => e.status === 409);
      const matches = await lexical.search('reimbursement', enterprise.id, [kb.id], 5);
      assert.ok(matches.length); assert.ok(matches.every(match => match.content.includes('9000')));
    });
    await check('real two-enterprise member grants gate search and exact-version sources immediately', async () => {
      const memberUser = await prisma.user.create({ data: { email: `kb-member-${randomUUID()}@example.invalid`, name: 'Isolated KB member' } });
      createdUserIds.push(memberUser.id);
      const member = await prisma.enterpriseMember.create({ data: { enterpriseId: enterprise.id, userId: memberUser.id, role: 'MEMBER' } });
      const foreignUser = await prisma.user.create({ data: { email: `kb-foreign-${randomUUID()}@example.invalid`, name: 'Isolated foreign admin', role: 'ADMIN' } });
      createdUserIds.push(foreignUser.id);
      const foreignEnterprise = await prisma.enterprise.create({ data: { name: 'Isolated foreign KB enterprise' } });
      createdEnterpriseIds.push(foreignEnterprise.id);
      await prisma.enterpriseMember.create({ data: { enterpriseId: foreignEnterprise.id, userId: foreignUser.id, role: 'ENTERPRISE_ADMIN' } });
      const foreignBase = await prisma.knowledgeBase.create({ data: { enterpriseId: foreignEnterprise.id, createdBy: foreignUser.id, name: 'Foreign scope fixture' } });
      let availabilityChecks = 0;
      // Real search/policy/SQL, with no real EmbeddingService or network-capable model client.
      const search = new KnowledgeSearchService(prisma, {
        isAvailable: async () => { availabilityChecks++; return false; },
      } as any, vectorSearch, lexical, new EnterpriseContextService(prisma), policy);
      const implicit = { query: 'reimbursement', topK: 3 };
      const explicit = { ...implicit, knowledgeBaseIds: [kb.id] };
      const active = await prisma.documentVersion.findUniqueOrThrow({ where: { id: d.activeVersionId! } });
      const chunk = await prisma.textChunk.findFirstOrThrow({ where: { versionId: active.id, documentId: d.id } });
      const outcomes: Record<string, string | number> = {};
      const denied = async (name: string, status: number, operation: () => Promise<unknown>) => {
        await assert.rejects(operation, (error: any) => error.status === status);
        outcomes[name] = status;
      };
      const noAccess = await search.searchForMember(memberUser.id, implicit);
      assert.equal(noAccess.status, 'NO_ACCESS'); assert.equal(noAccess.count, 0);
      assert.deepEqual(noAccess.results, []); outcomes.noGrantImplicit = noAccess.status;
      await denied('noGrantExplicit', 404, () => search.searchForMember(memberUser.id, explicit));
      await denied('noGrantSource', 404, () => search.getSource(memberUser.id, kb.id, chunk.id));

      await prisma.enterpriseMember.update({ where: { id: member.id }, data: { role: 'DEPT_MANAGER' } });
      const managerDenied = await search.searchForMember(memberUser.id, implicit);
      assert.equal(managerDenied.status, 'NO_ACCESS'); outcomes.managerImplicit = managerDenied.status;
      await denied('managerExplicit', 404, () => search.searchForMember(memberUser.id, explicit));
      await denied('managerSource', 404, () => search.getSource(memberUser.id, kb.id, chunk.id));
      // A manager cannot use its role to grant itself access either.
      await denied('managerSelfGrant', 404, () => knowledge.createGrant(memberUser.id, kb.id, { memberIds: [member.id] }));
      await prisma.enterpriseMember.update({ where: { id: member.id }, data: { role: 'MEMBER' } });

      const grant = await knowledge.createGrant(user.id, kb.id, { memberIds: [member.id] });
      assert.deepEqual(grant.addedMemberIds, [member.id]);
      const matched = await search.searchForMember(memberUser.id, explicit);
      assert.equal(matched.status, 'MATCHED'); assert.ok(matched.count > 0);
      assert.equal(matched.actualStrategy, 'LEXICAL'); assert.equal(matched.degraded, true);
      assert.equal(matched.degradationReason, 'QUERY_EMBEDDING_UNAVAILABLE');
      const result = matched.results.find(item => item.sourceId === chunk.id);
      assert.ok(result); assert.equal(result.versionId, active.id); assert.equal(result.documentId, d.id);
      assert.equal(result.knowledgeBaseId, kb.id); assert.equal(result.content, chunk.content);
      const source = await search.getSource(memberUser.id, kb.id, result.sourceId);
      assert.equal(source.versionId, active.id); assert.equal(source.documentId, d.id);
      assert.equal(source.sourceId, chunk.id); assert.equal(source.chunkId, chunk.id);
      assert.equal(source.content, chunk.content); assert.equal(source.isCurrent, true);
      assert.deepEqual(source.location, result.location);
      outcomes.grantedSearch = matched.status; outcomes.grantedSource = 'EXACT_ACTIVE_VERSION';
      await denied('foreignExplicit', 404, () => search.searchForMember(foreignUser.id, explicit));
      await denied('foreignSource', 404, () => search.getSource(foreignUser.id, kb.id, result.sourceId));
      await denied('mixedEnterpriseScope', 404, () => search.searchForMember(memberUser.id,
        { ...implicit, knowledgeBaseIds: [kb.id, foreignBase.id] }));
      await denied('mismatchedSourceBase', 404, () => search.getSource(foreignUser.id, foreignBase.id, result.sourceId));

      await knowledge.revokeMemberGrant(user.id, kb.id, member.id);
      const revoked = await search.searchForMember(memberUser.id, implicit);
      assert.equal(revoked.status, 'NO_ACCESS'); outcomes.revokedImplicit = revoked.status;
      await denied('revokedExplicit', 404, () => search.searchForMember(memberUser.id, explicit));
      await denied('revokedSource', 404, () => search.getSource(memberUser.id, kb.id, result.sourceId));
      // Regrant before removal so missing membership, not just the previous revoke, is exercised.
      await knowledge.createGrant(user.id, kb.id, { memberIds: [member.id] });
      assert.equal((await search.searchForMember(memberUser.id, explicit)).status, 'MATCHED');
      await prisma.enterpriseMember.delete({ where: { id: member.id } });
      await denied('removedMemberImplicit', 403, () => search.searchForMember(memberUser.id, implicit));
      await denied('removedMemberExplicit', 403, () => search.searchForMember(memberUser.id, explicit));
      await denied('removedMemberSource', 403, () => search.getSource(memberUser.id, kb.id, result.sourceId));
      assert.ok(availabilityChecks >= 2, 'successful reads must exercise forced lexical degradation');
      permissionsEvaluation = { database: 'real', strategy: 'LEXICAL', scenarios: Object.keys(outcomes).length,
        outcomes, sourceVersionMatchesActive: true, semanticQualityValidated: false };
    });
    await check('real audit persistence and admin metrics execute all aggregation SQL', async () => {
      await assert.rejects(() => telemetry.getMetrics(user.id), (error: any) => error.status === 403);
      const before = await telemetry.getMetrics(admin.id);
      assert.equal(before.window.sampled, false, 'isolated audit sample must fit the metrics window');
      const actor = await telemetry.resolveActor(user.id);
      assert.equal(actor.enterpriseId, enterprise.id);
      assert.ok(actor.memberId);
      // Synthetic request outcomes exercise real audit writes/aggregation, not HTTP or model evaluation.
      const events = [
        { resultCode: 'MATCHED', statusCode: 200, durationMs: 12, count: 2, degraded: false, partial: false },
        { resultCode: 'NO_MATCH', statusCode: 200, durationMs: 30, count: 0, degraded: false, partial: false },
        { resultCode: 'MATCHED', statusCode: 200, durationMs: 45, count: 1, degraded: true, partial: true },
        { resultCode: 'SERVICE_UNAVAILABLE', statusCode: 503, durationMs: 60, count: 0, degraded: false, partial: false },
      ];
      const requestIds: string[] = [];
      for (const event of events) {
        const requestId = key(); requestIds.push(requestId);
        await telemetry.record(actor, { ...event, action: 'KNOWLEDGE_SEARCH', knowledgeBaseId: kb.id,
          resourceId: kb.id, requestId, searchId: key(), actualStrategy: 'LEXICAL' });
      }
      const persisted = await prisma.auditLog.findMany({ where: { actorId: user.id, action: 'KNOWLEDGE_SEARCH' } });
      assert.equal(persisted.length, events.length);
      for (const event of persisted) {
        assert.equal(event.enterpriseId, enterprise.id);
        assert.equal(event.resourceType, 'KNOWLEDGE');
        const metadata = event.metadata as Record<string, unknown>;
        assert.ok(requestIds.includes(metadata.requestId as string));
        assert.equal(metadata.memberId, actor.memberId);
        assert.equal(metadata.knowledgeBaseId, kb.id);
        assert.equal(JSON.stringify(metadata).includes(root), false);
        assert.equal('query' in metadata, false);
        assert.equal('content' in metadata, false);
      }
      const metrics = await telemetry.getMetrics(admin.id);
      assert.equal(metrics.window.sampled, false);
      assert.equal(metrics.audit.events, before.audit.events + 4);
      assert.equal(metrics.audit.failures, before.audit.failures + 1);
      const searchDeltas = { requests: 4, matched: 2, noMatch: 1, failures: 1, degraded: 1, partial: 1, executed: 3 };
      for (const field of Object.keys(searchDeltas) as Array<keyof typeof searchDeltas>) {
        assert.equal(metrics.search[field], before.search[field] + searchDeltas[field], `search metric ${field}`);
      }
      assert.equal(metrics.search.noMatchRate, metrics.search.noMatch / metrics.search.executed);
      assert.equal(metrics.search.failureRate, metrics.search.failures / metrics.search.requests);
      const searchEvents = await prisma.auditLog.findMany({ where: { resourceType: 'KNOWLEDGE', action: 'KNOWLEDGE_SEARCH',
        createdAt: { gte: new Date(metrics.window.from), lte: new Date(metrics.window.to) } } });
      const durations = searchEvents.map(event => (event.metadata as Record<string, unknown>)?.durationMs)
        .filter((duration): duration is number => typeof duration === 'number' && Number.isFinite(duration) && duration >= 0)
        .map(Math.floor).sort((a, b) => a - b);
      assert.equal(metrics.search.latencySamples, durations.length);
      assert.equal(metrics.search.p95Ms, durations[Math.ceil(durations.length * 0.95) - 1]);
      const jobs = await prisma.knowledgeProcessingJob.findMany();
      const jobStatuses = { pending: 'PENDING', running: 'RUNNING', failed: 'FAILED', done: 'DONE' };
      for (const field of Object.keys(jobStatuses) as Array<keyof typeof jobStatuses>) {
        assert.equal(metrics.queue[field], jobs.filter(job => job.status === jobStatuses[field]).length, `queue metric ${field}`);
      }
      assert.equal(metrics.queue.due, jobs.filter(job => job.status === 'PENDING' && job.nextRunAt <= new Date(metrics.generatedAt)).length);
      assert.equal(metrics.queue.expiredLeases, jobs.filter(job => job.status === 'RUNNING' && job.leaseUntil && job.leaseUntil <= new Date(metrics.generatedAt)).length);
      assert.equal(metrics.queue.failedByStage.EMBEDDING, jobs.filter(job => job.status === 'FAILED' &&
        ['EMBEDDING_PROFILE_MISMATCH', 'EMBEDDING_UNAVAILABLE', 'INVALID_EMBEDDING'].includes(job.errorCode!)).length);
      assert.ok(metrics.queue.failedByStage.EMBEDDING >= 1, 'injected embedding outage must be classified');
      assert.equal(metrics.storage.documents, await prisma.document.count());
      assert.equal(metrics.storage.versions, await prisma.documentVersion.count());
      assert.equal(metrics.storage.chunks, await prisma.textChunk.count());
      const versions = await prisma.documentVersion.findMany({ select: { fileSize: true } });
      const legacy = await prisma.document.findMany({ where: { latestVersionId: null }, select: { fileSize: true } });
      assert.equal(metrics.storage.logicalOriginalBytes, [...versions, ...legacy].reduce((sum, item) => sum + item.fileSize, 0));
      assert.ok(metrics.storage.vectorChunks > 0);
      assert.ok(metrics.storage.lexicalChunks > 0);
      assert.ok(metrics.storage.chunkRelationBytes > 0);
      assert.equal(metrics.storage.physicalFileBytesMeasured, false);
      assert.equal(metrics.diagnostics.auditWritten, 4);
      assert.equal(metrics.diagnostics.auditWriteFailures, 0);
      assert.equal(metrics.diagnostics.metricsReadFailures, 0);
      telemetryEvaluation = { aggregationSQL: 'passed', auditWrites: persisted.length,
        searchOutcomes: events.map(event => event.resultCode), p95Ms: metrics.search.p95Ms,
        embeddingFailureClassification: metrics.queue.failedByStage.EMBEDDING };
    });
    await check('real retention removes expired history text and original but preserves the active version', async () => {
      const old = await prisma.documentVersion.findUniqueOrThrow({ where: { id: oldActive! } });
      const activeBefore = await prisma.documentVersion.findUniqueOrThrow({ where: { id: d.activeVersionId! } });
      assert.ok(old.publishedAt, 'retired version must retain its publication marker');
      assert.equal(old.published, false);
      assert.ok(old.retiredAt && old.retiredAt > new Date());
      assert.notEqual(old.storagePath, activeBefore.storagePath);
      await access(old.storagePath); await access(activeBefore.storagePath);
      assert.ok(await prisma.textChunk.count({ where: { versionId: old.id } }));
      assert.ok(await prisma.knowledgeParsedBlock.count({ where: { versionId: old.id } }));
      const activeChunks = await prisma.textChunk.findMany({ where: { versionId: activeBefore.id }, orderBy: { id: 'asc' } });
      const activeBlocks = await prisma.knowledgeParsedBlock.findMany({ where: { versionId: activeBefore.id }, orderBy: { ordinal: 'asc' } });
      const metricsBefore = await telemetry.getMetrics(admin.id);
      const retentionBefore = await retention.getStatus();
      const expiredAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await prisma.documentVersion.update({ where: { id: old.id }, data: { retiredAt: expiredAt } });
      const due = await telemetry.getMetrics(admin.id);
      assert.equal(due.cleanup.pendingVersions, metricsBefore.cleanup.pendingVersions + 1);
      assert.ok(due.cleanup.oldestOverdueMs >= 2 * 24 * 60 * 60 * 1000);
      const status = await retention.getStatus();
      assert.equal(status.pendingVersions, retentionBefore.pendingVersions + 1);
      assert.ok(status.lagMs >= 2 * 24 * 60 * 60 * 1000);
      const batch = await retention.runOnce();
      assert.ok(batch.cleaned >= 1); assert.equal(batch.failed, 0);
      const expired = await prisma.documentVersion.findUniqueOrThrow({ where: { id: old.id } });
      assert.equal(expired.stage, 'EXPIRED'); assert.equal(expired.storagePath, '');
      assert.equal(await prisma.textChunk.count({ where: { versionId: old.id } }), 0);
      assert.equal(await prisma.knowledgeParsedBlock.count({ where: { versionId: old.id } }), 0);
      await assert.rejects(() => access(old.storagePath), (error: NodeJS.ErrnoException) => error.code === 'ENOENT');
      await access(activeBefore.storagePath);
      assert.deepEqual(await prisma.documentVersion.findUniqueOrThrow({ where: { id: activeBefore.id } }), activeBefore);
      assert.deepEqual(await prisma.textChunk.findMany({ where: { versionId: activeBefore.id }, orderBy: { id: 'asc' } }), activeChunks);
      assert.deepEqual(await prisma.knowledgeParsedBlock.findMany({ where: { versionId: activeBefore.id }, orderBy: { ordinal: 'asc' } }), activeBlocks);
      const current = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
      assert.equal(current.activeVersionId, activeBefore.id); assert.equal(current.latestVersionId, activeBefore.id);
      assert.equal(current.storagePath, activeBefore.storagePath);
      assert.ok((await documents.preview(kb.id, d.id, user.id, { page: 1, pageSize: 20 })).items[0].text.includes('9000'));
      const matches = await lexical.search('reimbursement', enterprise.id, [kb.id], 3);
      assert.ok(matches.length); assert.ok(matches.every(result => result.content.includes('9000')));
      assert.equal((await telemetry.getMetrics(admin.id)).cleanup.pendingVersions, metricsBefore.cleanup.pendingVersions);
      const finalStatus = await retention.getStatus();
      assert.equal(finalStatus.pendingVersions, retentionBefore.pendingVersions);
      assert.ok(finalStatus.lastSuccessAt); assert.equal(finalStatus.lastError, null);
      assert.equal((await retention.runOnce()).cleaned, 0, 'repeat cleanup must be idempotent');
      retentionEvaluation = { expiredVersionsCleaned: 1, chunksDeleted: true, blocksDeleted: true,
        originalDeleted: true, activePreserved: true, metricsBacklogRecovered: true, repeatRunIdempotent: true };
      d = await documents.getDocumentForUser(kb.id, d.id, user.id);
    });
    await check('fixed small corpus lexical Top3 hits and unrelated queries return no results', async () => {
      const evaluationBase = await prisma.knowledgeBase.create({ data: { enterpriseId: enterprise.id, createdBy: user.id, name: 'Fixed lexical evaluation corpus' } });
      const corpus = [
        { topic: 'expenses', text: 'Expense reimbursement requires an invoice. Finance approves payment within seven days.', query: 'expense reimbursement' },
        { topic: 'security', text: 'Cybersecurity requires multifactor authentication. Report suspicious messages to the security team.', query: 'cybersecurity authentication' },
        { topic: 'hiring', text: 'Employee onboarding includes account activation and mandatory orientation before the first assignment.', query: 'onboarding orientation' },
        { topic: 'leave', text: 'Vacation requests need manager approval. Annual leave allowance is fifteen working days.', query: 'vacation allowance' },
        { topic: 'purchasing', text: 'Procurement orders require vendor quotations. Purchasing selects suppliers through competitive bidding.', query: 'procurement quotations' },
      ];
      const expectedChunks = new Map<string, Set<string>>();
      for (const item of corpus) {
        const uploaded = await documents.uploadDocument(evaluationBase.id, file(item.text, `${item.topic}.txt`), user.id, { idempotencyKey: key() });
        const job = await prisma.knowledgeProcessingJob.findFirstOrThrow({ where: { documentId: uploaded.id } });
        await processor.processJob(job.id);
        const ready = await documents.getDocumentForUser(evaluationBase.id, uploaded.id, user.id);
        assert.equal(ready.status, 'READY');
        const chunks = await prisma.textChunk.findMany({ where: { documentId: uploaded.id, versionId: ready.activeVersionId } });
        assert.ok(chunks.length); expectedChunks.set(item.topic, new Set(chunks.map(chunk => chunk.id)));
      }
      let hits = 0;
      const latencies: number[] = [];
      const cases: Array<Record<string, unknown>> = [];
      for (const item of corpus) {
        const started = performance.now();
        const results = await lexical.search(item.query, enterprise.id, [evaluationBase.id], 3);
        const durationMs = performance.now() - started;
        latencies.push(durationMs);
        const rank = results.findIndex(result => expectedChunks.get(item.topic)!.has(result.chunkId)) + 1;
        assert.ok(results.length <= 3);
        assert.ok(rank >= 1 && rank <= 3, `expected ${item.topic} in Top3`);
        assert.ok(results.every(result => result.knowledgeBaseId === evaluationBase.id && result.score > 0));
        hits++; cases.push({ query: item.query, expectedTopic: item.topic, rank, returned: results.length, durationMs });
      }
      const unrelated = ['volcanology tectonics', 'quasar redshift', 'xylophone sonata'];
      for (const query of unrelated) {
        const results = await lexical.search(query, enterprise.id, [evaluationBase.id], 3);
        assert.equal(results.length, 0, `unrelated query must return no results: ${query}`);
      }
      lexicalEvaluation = { corpusDocuments: corpus.length, relevantQueries: corpus.length, top3Hits: hits,
        hitAt3: hits / corpus.length, unrelatedQueries: unrelated.length, unrelatedZeroResults: unrelated.length,
        unrelatedFalsePositiveRate: 0, p95Ms: latencies.sort((a, b) => a - b)[Math.ceil(latencies.length * 0.95) - 1],
        cases, scope: 'fixed small lexical regression corpus only', semanticQualityValidated: false };
    });
    await check('deterministic empty-content failure is not automatically or manually retried', async () => {
      const empty = await documents.uploadDocument(kb.id, file('    \n    '), user.id, { idempotencyKey: key() });
      const job = await prisma.knowledgeProcessingJob.findFirstOrThrow({ where: { documentId: empty.id } });
      await processor.processJob(job.id);
      const failed = await documents.getDocumentForUser(kb.id, empty.id, user.id);
      assert.equal(failed.status, 'FAILED'); assert.equal(failed.latestVersion?.retryable, false);
      await assert.rejects(() => documents.retry(kb.id, empty.id, user.id, { ifMatch: failed.etag, idempotencyKey: key() }), (e: any) => e.status === 409);
    });
    await check('expired worker lease recovers after restart and duplicate deliveries do not duplicate chunks', async () => {
      const recovered = await documents.uploadDocument(kb.id, file('Recoverable policy document content with reimbursement details.'), user.id, { idempotencyKey: key() });
      const job = await prisma.knowledgeProcessingJob.findFirstOrThrow({ where: { documentId: recovered.id } });
      await prisma.knowledgeProcessingJob.update({ where: { id: job.id }, data: { status: 'RUNNING', attempts: 1, fence: 10, leaseUntil: new Date(0) } });
      await Promise.all([processor.processJob(job.id), processor.processJob(job.id)]);
      assert.equal((await documents.getDocumentForUser(kb.id, recovered.id, user.id)).status, 'READY');
      assert.equal(await prisma.textChunk.count({ where: { documentId: recovered.id } }), 1);
    });
    await check('lease recovery replaces obsolete parsed blocks before publishing the new snapshot', async () => {
      const uploaded = await documents.uploadDocument(kb.id, file('Recovered snapshot contains only the current paragraph.'), user.id,
        { idempotencyKey: key() });
      const job = await prisma.knowledgeProcessingJob.findFirstOrThrow({ where: { documentId: uploaded.id } });
      await prisma.knowledgeParsedBlock.create({ data: { versionId: uploaded.latestVersionId!, ordinal: 99,
        text: 'Obsolete page from an interrupted earlier parsing attempt.', page: 100 } });
      await prisma.knowledgeProcessingJob.update({ where: { id: job.id }, data: { status: 'RUNNING', attempts: 1,
        fence: 10, leaseUntil: new Date(0) } });
      await processor.processJob(job.id);
      const ready = await documents.getDocumentForUser(kb.id, uploaded.id, user.id);
      assert.equal(ready.status, 'READY');
      const preview = await documents.preview(kb.id, uploaded.id, user.id, { page: 1, pageSize: 20 });
      assert.equal(preview.total, 1, 'preview must not retain blocks absent from the recovered parse');
      assert.equal(preview.items[0].text, 'Recovered snapshot contains only the current paragraph.');
    });
    await check('legacy failed originals can enter the durable version pipeline without changing document identity', async () => {
      const original = Buffer.from('Legacy reimbursement policy for recovery.');
      const storagePath = await new KnowledgePrivateStorage().write(original);
      const legacy = await prisma.document.create({ data: { knowledgeBaseId: kb.id, uploadedBy: user.id,
        filename: 'legacy.txt', originalName: 'legacy.txt', storagePath, mimeType: 'text/plain', fileSize: original.length, status: 'FAILED' } });
      const before = await documents.getDocumentForUser(kb.id, legacy.id, user.id);
      const retried = await documents.retry(kb.id, legacy.id, user.id, { ifMatch: before.etag, idempotencyKey: key() });
      assert.equal(retried.id, legacy.id);
      const job = await prisma.knowledgeProcessingJob.findFirstOrThrow({ where: { documentId: legacy.id } });
      await processor.processJob(job.id);
      const recovered = await documents.getDocumentForUser(kb.id, legacy.id, user.id);
      assert.equal(recovered.status, 'READY');
      assert.equal(recovered.activeVersion?.version, 1);
    });
    await check('legacy READY adoption preserves vector and lexical retrieval when replacement fails', async () => {
      const original = Buffer.from('Legacy reimbursement limit remains 3000 CNY.');
      const storagePath = await new KnowledgePrivateStorage().write(original);
      const legacy = await prisma.document.create({ data: { knowledgeBaseId: kb.id, uploadedBy: user.id,
        filename: 'legacy-ready.txt', originalName: 'legacy-ready.txt', storagePath, mimeType: 'text/plain',
        fileSize: original.length, status: 'READY' } });
      const queryVector = Float32Array.from({ length: 1024 }, (_, i) => i === 0 ? 1 : 0);
      const chunk = await prisma.textChunk.create({ data: { knowledgeBaseId: kb.id, documentId: legacy.id,
        content: original.toString(), source: legacy.id, tags: [], tokens: tokenizer.tokenize(original.toString()),
        embeddingModel: embedding.getProfile().model, embedding: Buffer.from(queryVector.buffer) } });
      await vectorSearch.upsertVector(chunk.id, queryVector);
      const assertSearchable = async () => {
        const vectors = await vectorSearch.search(queryVector, enterprise.id, [kb.id], 50, embedding.getProfile());
        assert.ok(vectors.some(result => result.chunkId === chunk.id), 'old READY vector must remain searchable');
        const words = await lexical.search('reimbursement', enterprise.id, [kb.id], 50);
        assert.ok(words.some(result => result.chunkId === chunk.id), 'old READY text must remain searchable');
      };
      await assertSearchable();
      const before = await documents.getDocumentForUser(kb.id, legacy.id, user.id);
      const pending = await documents.uploadVersion(kb.id, legacy.id, file('Replacement reimbursement limit 6000 CNY.'),
        user.id, { ifMatch: before.etag, idempotencyKey: key() });
      assert.equal(pending.id, legacy.id);
      assert.ok(pending.activeVersionId);
      assert.notEqual(pending.activeVersionId, pending.latestVersionId);
      const active = await prisma.documentVersion.findUniqueOrThrow({ where: { id: pending.activeVersionId! } });
      assert.deepEqual(active.profile, { kind: 'legacy-adopted', compatibility: 'model-only' });
      await assertSearchable();
      const job = await prisma.knowledgeProcessingJob.findFirstOrThrow({ where: { versionId: pending.latestVersionId } });
      failEmbedding = true;
      try {
        for (let i = 0; i < 3; i++) {
          await prisma.knowledgeProcessingJob.update({ where: { id: job.id }, data: { nextRunAt: new Date(0) } });
          await processor.processJob(job.id);
        }
      } finally { failEmbedding = false; }
      const failed = await documents.getDocumentForUser(kb.id, legacy.id, user.id);
      assert.equal(failed.status, 'FAILED');
      assert.equal(failed.activeVersionId, pending.activeVersionId);
      assert.equal(failed.searchable, true);
      await assertSearchable();
      assert.ok((await documents.preview(kb.id, legacy.id, user.id, { page: 1, pageSize: 20 })).items[0].text.includes('3000'));
    });
    await check('delete during embedding makes document invisible and fences stale publication', async () => {
      d = await documents.uploadVersion(kb.id, d.id, file('New policy pending deletion 2028: reimbursement limit 10000.'), user.id,
        { ifMatch: d.etag, idempotencyKey: key() });
      const job = await prisma.knowledgeProcessingJob.findFirstOrThrow({ where: { versionId: d.latestVersionId } });
      let release!: () => void;
      let started!: () => void;
      const entered = new Promise<void>(resolve => { started = resolve; });
      pauseEmbedding = () => { started(); return new Promise<void>(resolve => { release = resolve; }); };
      const processing = processor.processJob(job.id);
      await entered;
      const deleteKey = key();
      const staleTag = d.etag;
      d = await documents.getDocumentForUser(kb.id, d.id, user.id);
      assert.notEqual(d.etag, staleTag, 'progress must change strong ETag even without revision change');
      await assert.rejects(() => documents.deleteDocument(kb.id, d.id, user.id,
        { ifMatch: staleTag, idempotencyKey: key() }), (e: any) => e.status === 412);
      await documents.deleteDocument(kb.id, d.id, user.id, { ifMatch: d.etag, idempotencyKey: deleteKey });
      await documents.deleteDocument(kb.id, d.id, user.id, { ifMatch: d.etag, idempotencyKey: deleteKey });
      release(); await processing; pauseEmbedding = undefined;
      await assert.rejects(() => documents.getDocumentForUser(kb.id, d.id, user.id), (e: any) => e.status === 404);
      assert.equal(await prisma.documentVersion.count({ where: { documentId: d.id, published: true } }), 0);
      const cleanup = await prisma.knowledgeProcessingJob.findFirstOrThrow({ where: { documentId: d.id, kind: 'CLEANUP' } });
      const files = await prisma.documentVersion.findMany({ where: { documentId: d.id } });
      await processor.processJob(cleanup.id);
      assert.equal(await prisma.textChunk.count({ where: { documentId: d.id } }), 0);
      for (const v of files) await assert.rejects(() => access(v.storagePath));
    });
    await check('knowledge-base deletion preserves cleanup jobs and blocks all future reads', async () => {
      await knowledge.delete(user.id, kb.id);
      await assert.rejects(() => policy.assertRead(user.id, kb.id), (e: any) => e.status === 404);
      const jobs = await prisma.knowledgeProcessingJob.findMany({ where: { document: { knowledgeBaseId: kb.id }, kind: 'CLEANUP', status: 'PENDING' } });
      assert.ok(jobs.length);
      for (const job of jobs) await processor.processJob(job.id);
      assert.equal(await prisma.textChunk.count({ where: { knowledgeBaseId: kb.id } }), 0);
    });
    console.log(JSON.stringify({ status: 'passed', database: 'sep_kb_refactor_20261016', checks: checks.length,
      real: ['private file storage', 'TXT parser', 'PostgreSQL transactions', 'native pgvector', 'lexical retrieval', 'lease recovery',
        'history retention and physical deletion', 'AuditService writes', 'admin metrics aggregation SQL'],
      retention: retentionEvaluation, telemetry: telemetryEvaluation, lexical: lexicalEvaluation, permissions: permissionsEvaluation,
      simulated: ['embedding provider (constant unit vectors)', 'chunk token-budget encoder'],
      notCovered: ['semantic retrieval quality', 'live sub2api', 'HTTP authentication', 'Redis outage', 'production'] }));
  } finally {
    try {
      // Audit actors are RESTRICT relations: remove only this run's events before deleting its users.
      try { await prisma.auditLog.deleteMany({ where: { actorId: { in: createdUserIds } } }); }
      finally {
        try { await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } }); }
        finally { await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }); }
      }
      assert.equal(await prisma.user.count({ where: { id: { in: createdUserIds } } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { actorId: { in: createdUserIds } } }), 0);
      assert.equal(await prisma.enterprise.count({ where: { id: { in: createdEnterpriseIds } } }), 0);
      assert.equal(await prisma.knowledgeBase.count({ where: { enterpriseId: { in: createdEnterpriseIds } } }), 0);
      console.log('PASS finally cleanup removed this run\'s users, enterprise, knowledge bases and audit events');
    } finally {
      try { await prisma.$disconnect(); }
      finally { await rm(root, { recursive: true, force: true }); }
    }
  }
}
