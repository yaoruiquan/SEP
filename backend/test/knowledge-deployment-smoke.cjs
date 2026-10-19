'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS for the runtime-only image. */

// Copy into /app in the rehearsal backend container; never bootstrap Nest or load .env here.
// DATABASE_URL must already belong to that running backend, not be overridden just for this script.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { existsSync } = require('node:fs');
const { access } = require('node:fs/promises');
const { isAbsolute, relative } = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');

const DATABASE = 'sep_pgvector_rehearsal_20261019';
const report = { status: 'failed', database: DATABASE, passed: [], cleanup: 'not_needed' };
let step = 'safety';
const check = async (name, operation) => {
  step = name;
  const result = await operation();
  report.passed.push(name);
  return result;
};
const safeFailure = error => /^P\d{4}$/.test(error?.code || '') ? error.code : 'CHECK_FAILED';

async function main() {
  let prisma, fixtures, admin;
  let http, deleteDocument;
  const started = Date.now();
  try {
    step = 'container_guard';
    assert.ok(process.platform === 'linux' && existsSync('/.dockerenv'), 'CONTAINER_REQUIRED');
    step = 'backend_origin_guard';
    const base = process.env.KNOWLEDGE_SMOKE_BACKEND_URL;
    assert.equal(base, 'http://127.0.0.1:3001', 'EXPLICIT_LOOPBACK_REQUIRED');
    step = 'database_allowlist_guard';
    const url = new URL(process.env.DATABASE_URL);
    assert.ok(['postgresql:', 'postgres:'].includes(url.protocol));
    assert.equal(url.pathname, `/${DATABASE}`, 'DATABASE_ALLOWLIST');
    assert.equal(url.searchParams.get('schema') || 'public', 'public');
    step = 'runtime_configuration';
    const secret = process.env.ACCESS_JWT_SECRET;
    assert.ok(secret, 'ACCESS_JWT_SECRET_REQUIRED');
    assert.equal(process.env.EMBEDDING_PROVIDER, 'ollama');
    const model = process.env.EMBEDDING_MODEL;
    const tokenizer = process.env.EMBEDDING_TOKENIZER;
    const digest = (process.env.EMBEDDING_MODEL_DIGEST || '').replace(/^sha256:/, '');
    assert.ok(model && tokenizer && /^[a-f0-9]{64}$/.test(digest));
    assert.equal(process.env.EMBEDDING_DIMENSION || '1024', '1024');
    assert.equal(process.env.EMBEDDING_DISTANCE || 'cosine', 'cosine');
    const ollama = new URL(process.env.EMBEDDING_BASE_URL);
    assert.ok(ollama.protocol === 'http:' && !ollama.username && !ollama.password && !ollama.search && !ollama.hash);
    ollama.pathname = ollama.pathname.replace(/\/+$/, '').replace(/\/v1$/, '') + '/';
    const root = process.env.KNOWLEDGE_PRIVATE_PATH;
    assert.ok(root && isAbsolute(root), 'EXPLICIT_PRIVATE_PATH_REQUIRED');
    const timeout = Number(process.env.KNOWLEDGE_SMOKE_TIMEOUT_MS || 180000);
    assert.ok(Number.isInteger(timeout) && timeout >= 1000 && timeout <= 600000);
    const { PrismaClient } = require('@prisma/client');
    let jwt;
    try { jwt = require('jsonwebtoken'); }
    catch { jwt = require('node:module').createRequire(require.resolve('@nestjs/jwt'))('jsonwebtoken'); }
    prisma = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });

    const waitFor = async operation => {
      const deadline = Date.now() + timeout;
      do {
        const result = await operation();
        if (result) return result;
        await sleep(1000);
      } while (Date.now() < deadline);
      throw new Error('POLL_TIMEOUT');
    };
    // Never print response bodies, transport errors, Prisma messages, tokens or configuration.
    http = async (actor, path, { method = 'GET', body, headers = {}, status = 200 } = {}) => {
      const token = jwt.sign({ sub: actor.id, email: actor.email, role: actor.role,
        sid: actor.sid, type: 'access' }, secret, { algorithm: 'HS256', expiresIn: '2m' });
      const form = body instanceof FormData;
      const response = await fetch(`${base}/api/knowledge-bases${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(120000),
        headers: { Authorization: `Bearer ${token}`, ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
      });
      const text = await response.text();
      assert.ok((Array.isArray(status) ? status : [status]).includes(response.status), 'HTTP_STATUS');
      assert.ok(response.headers.get('cache-control')?.includes('no-store'));
      return { data: text ? JSON.parse(text) : null, etag: response.headers.get('etag'), status: response.status };
    };
    const mutationHeaders = etag => ({ 'Idempotency-Key': randomUUID(), ...(etag ? { 'If-Match': etag } : {}) });
    const file = text => {
      const form = new FormData();
      form.append('file', new Blob([text], { type: 'text/plain' }), 'synthetic-policy.txt');
      return form;
    };
    await check('fresh_migrated_database_and_pgvector', async () => {
      const [identity] = await prisma.$queryRaw`SELECT current_database() AS db, current_schema() AS schema`;
      assert.equal(identity.db, DATABASE); assert.equal(identity.schema, 'public');
      const [migrations] = await prisma.$queryRaw`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS unfinished FROM public._prisma_migrations`;
      assert.ok(migrations.total > 0 && migrations.unfinished === 0);
      // Inspect every public business table, not just documents: cloned databases are forbidden.
      const tables = await prisma.$queryRaw`SELECT format('SELECT EXISTS (SELECT 1 FROM public.%I LIMIT 1) AS occupied', tablename) AS probe
        FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
      for (const table of tables) {
        const [row] = await prisma.$queryRawUnsafe(table.probe); // Identifiers quoted by PostgreSQL format(%I).
        assert.equal(row.occupied, false, 'EMPTY_SCHEMA_REQUIRED');
      }
      const [column] = await prisma.$queryRaw`SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
        WHERE attrelid = 'public.text_chunks'::regclass AND attname = 'embeddingVector' AND NOT attisdropped`;
      assert.equal(column?.type, 'vector(1024)');
      const [extension] = await prisma.$queryRaw`SELECT extversion FROM pg_extension WHERE extname = 'vector'`;
      assert.ok(extension?.extversion);
      const [index] = await prisma.$queryRaw`SELECT indisvalid, indisready FROM pg_index
        WHERE indexrelid = to_regclass('public."text_chunks_embeddingVector_hnsw_idx"')`;
      assert.ok(index?.indisvalid && index.indisready);
    });
    const runId = randomUUID();
    fixtures = await check('synthetic_identities_and_sessions', () => prisma.$transaction(async tx => {
      const home = await tx.enterprise.create({ data: { name: `KB rehearsal ${runId}` } });
      const foreign = await tx.enterprise.create({ data: { name: `KB foreign rehearsal ${runId}` } });
      const actor = async (label, enterpriseId, role) => {
        const user = await tx.user.create({ data: { email: `${label}-${runId}@example.invalid`, name: label, role: 'USER', status: 'ACTIVE' } });
        const member = await tx.enterpriseMember.create({ data: { userId: user.id, enterpriseId, role } });
        const session = await tx.authSession.create({ data: { userId: user.id, type: 'WEB', familyId: randomUUID(),
          expiresAt: new Date(Date.now() + 3600000) } });
        return { ...user, memberId: member.id, sid: session.id };
      };
      return { enterpriseIds: [home.id, foreign.id], homeId: home.id,
        admin: await actor('admin', home.id, 'ENTERPRISE_ADMIN'),
        member: await actor('member', home.id, 'MEMBER'),
        foreign: await actor('foreign', foreign.id, 'MEMBER') };
    }));
    admin = fixtures.admin;
    const member = fixtures.member;
    await check('http_authentication_matches_fixture_database', async () => {
      const { data } = await http(admin, '');
      assert.equal(data.viewer.enterpriseId, fixtures.homeId);
      assert.equal(data.viewer.memberId, admin.memberId);
      assert.equal(data.viewer.role, 'ADMIN'); assert.equal(data.total, 0);
    });
    const kb = await check('http_create_knowledge_base', async () => {
      const { data } = await http(admin, '', { method: 'POST', body: { name: `Deployment smoke ${runId}` }, status: 201 });
      const stored = await prisma.knowledgeBase.findUniqueOrThrow({ where: { id: data.id } });
      assert.equal(stored.enterpriseId, fixtures.homeId); assert.equal(stored.createdBy, admin.id);
      return data;
    });
    const kbPath = `/${kb.id}`;
    deleteDocument = async (baseId, documentId) => {
      const path = `/${baseId}/documents/${documentId}`;
      const stored = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
      if (!stored.deletedAt) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const current = await http(admin, path);
          assert.match(current.etag || '', /^"kbdoc-[a-f0-9]{64}"$/);
          const result = await http(admin, path, { method: 'DELETE', headers: mutationHeaders(current.etag), status: [204, 412] });
          if (result.status === 204) break;
          assert.ok(attempt < 2, 'DELETE_ETAG_CONFLICT');
          await sleep(100);
        }
      }
      await waitFor(async () => {
        const jobs = await prisma.knowledgeProcessingJob.findMany({ where: { documentId, kind: 'CLEANUP' } });
        assert.ok(jobs.every(job => job.status !== 'FAILED'), 'CLEANUP_FAILED');
        return jobs.length && jobs.every(job => job.status === 'DONE');
      });
      assert.equal(await prisma.textChunk.count({ where: { documentId } }), 0);
      assert.equal(await prisma.knowledgeParsedBlock.count({ where: { version: { documentId } } }), 0);
      const removed = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
      assert.ok(removed.deletedAt && !removed.activeVersionId && removed.storagePath === '');
    };
    const text1 = `Synthetic policy ${runId}. Travel reimbursement limit is 7319 CNY. Finance approves claims.`;
    const text2 = `Synthetic policy ${runId}. Travel reimbursement limit is 8427 CNY. Finance approves claims.`;
    let d = await check('http_upload_durable_version', async () => {
      const { data, etag } = await http(admin, `${kbPath}/documents/upload`, {
        method: 'POST', body: file(text1), headers: mutationHeaders(), status: 202 });
      assert.ok(data.id && data.latestVersionId && etag);
      const stored = await prisma.document.findUniqueOrThrow({ where: { id: data.id } });
      assert.equal(stored.knowledgeBaseId, kb.id);
      assert.equal(await prisma.knowledgeProcessingJob.count({ where: { documentId: data.id, versionId: data.latestVersionId, kind: 'PROCESS' } }), 1);
      return data;
    });
    const docPath = `${kbPath}/documents/${d.id}`;
    const ready = () => waitFor(async () => {
      const { data } = await http(admin, docPath);
      assert.notEqual(data.latestVersion?.status, 'FAILED', 'PROCESSING_FAILED');
      return data.status === 'READY' && data.latestVersion?.stage === 'DONE'
        && data.activeVersionId === data.latestVersionId && data.searchable ? data : false;
    });
    const verifyIndex = async document => {
      const v = await prisma.documentVersion.findUniqueOrThrow({ where: { id: document.activeVersionId } });
      assert.equal(v.documentId, document.id); assert.equal(v.status, 'READY');
      assert.ok(v.published && v.publishedAt && !v.retiredAt && v.processedChunks > 0);
      assert.equal(v.processedChunks, v.totalChunks);
      assert.deepEqual(v.profile, { model, dimension: 1024, tokenizer, distance: 'cosine' });
      const jobs = await prisma.knowledgeProcessingJob.findMany({ where: { documentId: document.id, versionId: v.id, generation: v.generation, kind: 'PROCESS' } });
      assert.equal(jobs.length, 1); assert.equal(jobs[0].status, 'DONE'); assert.equal(jobs[0].leaseUntil, null);
      const rows = await prisma.$queryRaw`SELECT id, vector_dims("embeddingVector") AS dimension,
        vector_norm("embeddingVector") AS norm, octet_length(embedding) AS bytes, "embeddingModel" AS model,
        "tokenCount" AS tokens FROM public.text_chunks WHERE "versionId" = ${v.id} AND "indexGeneration" = ${v.generation}`;
      assert.equal(rows.length, v.totalChunks);
      assert.ok(rows.every(row => row.dimension === 1024 && row.norm > 0 && row.bytes === 4096
        && row.model === model && row.tokens > 0 && row.tokens <= 800));
      return v;
    };
    d = await check('queue_ready_native_1024_and_completed_job', async () => {
      const document = await ready(); await verifyIndex(document); return document;
    });
    await check('real_ollama_digest_and_stored_vector_match', async () => {
      const options = { redirect: 'error', signal: AbortSignal.timeout(120000) };
      const tags = await fetch(new URL('api/tags', ollama), options);
      assert.equal(tags.status, 200);
      assert.equal((await tags.json()).models.find(item => item.name === model)?.digest, digest);
      const response = await fetch(new URL('api/embed', ollama), { ...options, method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: text1, truncate: false }) });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.model, model); assert.equal(payload.embeddings?.length, 1);
      const values = payload.embeddings[0];
      assert.ok(values.length === 1024 && values.every(value => typeof value === 'number' && Number.isFinite(value)));
      const literal = `[${values.join(',')}]`;
      const [match] = await prisma.$queryRaw`SELECT max(1 - ("embeddingVector" <=> ${literal}::vector)) AS score
        FROM public.text_chunks WHERE "versionId" = ${d.activeVersionId}`;
      assert.ok(match.score > 0.999);
    });
    const vectorSearch = async document => {
      const { data } = await http(admin, `${kbPath}/test-search`, { method: 'POST',
        body: { query: 'Travel reimbursement limit', strategy: 'vector', topK: 3, scoreThreshold: 0 } });
      assert.equal(data.strategy, 'vector'); assert.ok(data.hitCount > 0);
      assert.equal(data.results.length, data.hitCount);
      const ids = new Set((await prisma.textChunk.findMany({ where: { versionId: document.activeVersionId }, select: { id: true } })).map(row => row.id));
      assert.ok(data.results.every(row => ids.has(row.chunkId) && row.documentId === document.id && row.knowledgeBaseId === kb.id));
    };
    await check('explicit_vector_http_hit', () => vectorSearch(d));
    const searchBody = { query: 'Travel reimbursement limit', knowledgeBaseIds: [kb.id], topK: 3 };
    await check('member_denied_before_grant', () => http(member, '/search', { method: 'POST', body: searchBody, status: 404 }));
    await check('http_grant_member', async () => {
      const { data } = await http(admin, `${kbPath}/grants`, { method: 'POST', body: { memberIds: [member.memberId] } });
      assert.deepEqual(data.addedMemberIds, [member.memberId]);
    });
    const memberRead = async (document, expectedText) => {
      const { data } = await http(member, '/search', { method: 'POST', body: searchBody });
      assert.equal(data.status, 'MATCHED'); assert.equal(data.actualStrategy, 'HYBRID'); assert.equal(data.degraded, false);
      assert.ok(data.count > 0 && data.results.length === data.count);
      assert.ok(data.results.every(row => row.versionId === document.activeVersionId && row.documentId === document.id
        && row.knowledgeBaseId === kb.id && row.content === expectedText && row.tokenCount > 0));
      const result = data.results[0];
      const { data: source } = await http(member, `${kbPath}/sources/${result.sourceId}`);
      assert.equal(source.sourceId, result.sourceId); assert.equal(source.chunkId, result.chunkId);
      assert.equal(source.knowledgeBaseId, kb.id);
      assert.equal(source.versionId, document.activeVersionId); assert.equal(source.content, result.content);
      assert.equal(source.documentId, document.id); assert.equal(source.isCurrent, true);
      assert.deepEqual(source.location, result.location);
      const { data: preview } = await http(member, `${docPath}/preview?versionId=${document.activeVersionId}`);
      assert.equal(preview.versionId, document.activeVersionId); assert.equal(preview.previewKind, 'PARSED_BLOCKS');
      assert.ok(preview.items.some(item => item.text === expectedText));
      return result.sourceId;
    };
    let sourceId = await check('granted_member_search_source_preview', () => memberRead(d, text1));
    const denied = async actor => {
      await http(actor, '/search', { method: 'POST', body: searchBody, status: 404 });
      await http(actor, `${kbPath}/sources/${sourceId}`, { status: 404 });
      await http(actor, `${docPath}/preview`, { status: 404 });
    };
    await check('foreign_member_denied', () => denied(fixtures.foreign));
    await check('replacement_publishes_new_version_only', async () => {
      const oldId = d.activeVersionId;
      const current = await http(admin, docPath);
      assert.match(current.etag || '', /^"kbdoc-[a-f0-9]{64}"$/);
      const pending = await http(admin, `${docPath}/versions`, { method: 'POST', body: file(text2),
        headers: mutationHeaders(current.etag), status: 202 });
      assert.notEqual(pending.data.latestVersionId, oldId);
      // A tiny document may already be READY; require the old version only while still pending.
      if (pending.data.status !== 'READY') assert.equal(pending.data.activeVersionId, oldId);
      d = await ready(); assert.notEqual(d.activeVersionId, oldId); await verifyIndex(d);
      const old = await prisma.documentVersion.findUniqueOrThrow({ where: { id: oldId } });
      assert.ok(!old.published && old.publishedAt && old.retiredAt > new Date());
      assert.equal(await prisma.documentVersion.count({ where: { documentId: d.id, published: true } }), 1);
      await vectorSearch(d); sourceId = await memberRead(d, text2);
      await http(member, `${docPath}/preview?versionId=${oldId}`, { status: 409 });
    });
    await check('revoked_member_immediately_denied', async () => {
      await http(admin, `${kbPath}/grants/${member.memberId}`, { method: 'DELETE', status: 204 });
      await denied(member);
    });
    await check('http_delete_and_async_original_cleanup', async () => {
      const versions = await prisma.documentVersion.findMany({ where: { documentId: d.id } });
      for (const version of versions) {
        const child = relative(root, version.storagePath);
        assert.ok(child && child !== '..' && !child.startsWith('../') && !isAbsolute(child), 'PRIVATE_PATH_SCOPE');
        await access(version.storagePath);
      }
      await deleteDocument(kb.id, d.id);
      await http(admin, docPath, { status: 404 });
      await http(admin, `${kbPath}/sources/${sourceId}`, { status: 404 });
      for (const version of versions) await assert.rejects(access(version.storagePath), { code: 'ENOENT' });
      assert.ok((await prisma.documentVersion.findMany({ where: { documentId: d.id } })).every(version => version.storagePath === ''));
    });
    report.status = 'passed';
  } catch (error) {
    report.failedStep = step; report.code = safeFailure(error);
    if (fixtures) {
      try {
        report.processing = await prisma.documentVersion.findMany({
          where: { document: { knowledgeBase: { enterpriseId: fixtures.homeId } } },
          select: { status: true, stage: true, errorCode: true, processedChunks: true,
            totalChunks: true, generation: true, published: true },
        });
      } catch { /* Keep the original failure if diagnostic reads also fail. */ }
    }
  } finally {
    if (fixtures) {
      report.cleanup = 'failed';
      try {
        // API fences workers and removes originals before deleting only this run's fixture rows.
        const documents = await prisma.document.findMany({ where: { knowledgeBase: { enterpriseId: fixtures.homeId } } });
        for (const document of documents) await deleteDocument(document.knowledgeBaseId, document.id);
        const users = [fixtures.admin.id, fixtures.member.id, fixtures.foreign.id];
        const bases = await prisma.knowledgeBase.findMany({ where: { enterpriseId: { in: fixtures.enterpriseIds } }, select: { id: true } });
        await prisma.$transaction(async tx => {
          await tx.knowledgeIdempotency.deleteMany({ where: { userId: { in: users }, knowledgeBaseId: { in: bases.map(row => row.id) } } });
          await tx.auditLog.deleteMany({ where: { actorId: { in: users } } });
          await tx.enterprise.deleteMany({ where: { id: { in: fixtures.enterpriseIds } } });
          await tx.user.deleteMany({ where: { id: { in: users } } });
        });
        assert.equal(await prisma.user.count({ where: { id: { in: users } } }), 0);
        assert.equal(await prisma.enterprise.count({ where: { id: { in: fixtures.enterpriseIds } } }), 0);
        report.cleanup = 'passed';
      } catch (error) {
        report.status = 'failed'; report.failedStep ||= 'fixture_cleanup'; report.code ||= safeFailure(error);
      }
    }
    try { await prisma?.$disconnect(); }
    catch { report.status = 'failed'; report.code = 'DISCONNECT_FAILED'; }
    report.durationMs = Date.now() - started;
    console.log(JSON.stringify(report));
    process.exitCode = report.status === 'passed' ? 0 : 1;
  }
}

main();
