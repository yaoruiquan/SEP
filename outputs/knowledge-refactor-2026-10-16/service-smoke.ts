import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../../backend/src/prisma/prisma.service';
import { MemberService } from '../../backend/src/modules/enterprise/member.service';
import { EnterpriseContextService } from '../../backend/src/modules/enterprise/enterprise-context.service';
import { KnowledgeAccessPolicy } from '../../backend/src/modules/knowledge/knowledge-access-policy';
import { KnowledgeService } from '../../backend/src/modules/knowledge/knowledge.service';
import { DocumentService } from '../../backend/src/modules/knowledge/document.service';
import { KnowledgeSearchService } from '../../backend/src/modules/knowledge/knowledge-search.service';
import { LexicalSearchService } from '../../backend/src/modules/knowledge/lexical-search.service';
import { TextTokenizer } from '../../backend/src/modules/knowledge/text-tokenizer.service';
import { BM25Scorer } from '../../backend/src/modules/knowledge/bm25-scorer.service';

export async function run(connection: { database: string; username: string; host: string; port: number }) {
  const runId = `kbsmoke-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const evidencePath = path.join(__dirname, `service-smoke-${runId}.json`);
  assert.equal(new URL(process.env.DATABASE_URL!).pathname, '/sep_kb_refactor_20261016');
  assert.equal(connection.database, 'sep_kb_refactor_20261016');
  const sourcePaths = [
    'backend/prisma/schema.prisma', 'backend/src/prisma/prisma.service.ts',
    'backend/src/modules/enterprise/enterprise-context.service.ts',
    'backend/src/modules/enterprise/member.service.ts',
    ...['knowledge-access-policy', 'knowledge.service', 'document.service', 'knowledge-search.service',
      'lexical-search.service', 'text-tokenizer.service', 'bm25-scorer.service'].map(name => `backend/src/modules/knowledge/${name}.ts`),
    'backend/src/shared/knowledge.dto.ts',
  ];
  const hashes = () => Object.fromEntries(sourcePaths.map(file => [file,
    createHash('sha256').update(readFileSync(path.resolve(__dirname, '../..', file))).digest('hex')]));
  const evidence: any = {
    runId, startedAt: new Date().toISOString(), scope: 'Real isolated PostgreSQL, direct service calls',
    connection: { ...connection, container: 'sep-postgres', passwordSource: 'docker printenv -> process memory', passwordPersisted: false },
    runtime: { node: process.version, loader: 'backend ts-node/register/transpile-only + tsconfig-paths/register' },
    sourceHashesBefore: hashes(), checks: [], fixtures: {},
    boundaries: { realDatabase: true, realPrismaAndPolicy: true, realLexicalAndBM25: true,
      httpCovered: false, uploadsCovered: false, modelCallsCovered: false, vectorCovered: false,
      parsedDocumentPipelineCovered: false, fixturesRetained: true },
    limitations: ['Direct service calls do not cover HTTP guards, controllers, DTO validation, browser behavior or SSE.',
      'READY documents/chunks are synthetic rows; upload, parsing, queues, embeddings and vector search are not exercised.',
      'Membership departure uses the real MemberService and transaction; HTTP removal API is not exercised.',
      'No concurrent race/load tests. Synthetic fixture rows are retained only in the isolated database.'],
  };
  // Only this explicitly checked datasource is ever instantiated; no Nest app or config module is booted.
  const prisma = new PrismaService({ datasources: { db: { url: process.env.DATABASE_URL } }, log: [] });
  const context = new EnterpriseContextService(prisma);
  const policy = new KnowledgeAccessPolicy(prisma, context);
  const members = new MemberService(prisma, context);
  const vector = { invalidateCache() {} };
  const knowledge = new KnowledgeService(prisma, policy, vector as any);
  const counters = { embeddingAvailabilityChecks: 0, forbiddenDependencyCalls: 0 };
  const forbidden = (kind: string) => new Proxy({}, { get: (_target, property) => () => {
    counters.forbiddenDependencyCalls++;
    throw new Error(`FORBIDDEN_${kind}_${String(property)}`);
  } });
  const documents = new DocumentService(prisma, forbidden('QUEUE') as any, policy, vector as any);
  const tokenizer = new TextTokenizer();
  const lexical = new LexicalSearchService(prisma, tokenizer, new BM25Scorer());
  const search = new KnowledgeSearchService(prisma, {
    async isAvailable() { counters.embeddingAvailabilityChecks++; return false; },
  } as any, forbidden('VECTOR') as any, lexical, context, policy);
  const page = { page: 1, pageSize: 20 };
  const check = async (id: string, area: string, action: () => Promise<any>) => {
    const started = Date.now();
    try {
      const observed = await action();
      evidence.checks.push({ id, area, status: 'passed', durationMs: Date.now() - started, observed: observed ?? {} });
    } catch (error: any) {
      evidence.checks.push({ id, area, status: 'failed', durationMs: Date.now() - started,
        error: { type: error?.name || 'Error', code: error?.code || null, status: error?.getStatus?.() ?? null } });
    }
  };
  const expectStatus = async (call: () => Promise<any>, status: number, code?: string) => {
    let caught: any;
    try { await call(); } catch (error) { caught = error; }
    assert.ok(caught, 'Expected a Nest HTTP exception');
    assert.equal(caught.getStatus?.(), status);
    const actualCode = caught.getResponse?.()?.code;
    if (code) assert.equal(actualCode, code);
    return { status, ...(actualCode ? { code: actualCode } : {}) };
  };
  const emptyList = async (userId: string) => {
    const result = await knowledge.list(userId, page);
    assert.equal(result.total, 0); assert.equal(result.items.length, 0);
    return { total: result.total, itemCount: result.items.length };
  };
  const state = async (kbId: string) => ({
    revision: (await prisma.knowledgeBase.findUniqueOrThrow({ where: { id: kbId } })).revision,
    grantCount: await prisma.knowledgeMemberGrant.count({ where: { knowledgeBaseId: kbId } }),
  });
  let fatal: any;
  try {
    await prisma.$connect();
    const [database] = await prisma.$queryRaw<any[]>`SELECT current_database() AS database, current_user AS username`;
    // No mutations before this live server assertion succeeds.
    assert.equal(database.database, 'sep_kb_refactor_20261016');
    assert.equal(database.username, 'sep');
    const [migrations] = await prisma.$queryRaw<any[]>`SELECT count(*)::int AS applied FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    assert.equal(migrations.applied, 89);
    evidence.preflight = { ...database, appliedMigrations: migrations.applied, assertedBeforeWrites: true,
      extensions: await prisma.$queryRaw`SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm', 'vector') ORDER BY extname` };
    const fixtures = await prisma.$transaction(async tx => {
      const a = await tx.enterprise.create({ data: { name: `Fictional A ${runId}` } });
      const b = await tx.enterprise.create({ data: { name: `Fictional B ${runId}` } });
      const department = await tx.department.create({ data: { enterpriseId: a.id, name: `Fictional dept ${runId}` } });
      const users: any = {};
      const members: any = {};
      for (const [label, enterpriseId, role] of [
        ['adminA', a.id, 'ENTERPRISE_ADMIN'], ['memberA', a.id, 'MEMBER'], ['managerA', a.id, 'DEPT_MANAGER'],
        ['adminB', b.id, 'ENTERPRISE_ADMIN'], ['memberB', b.id, 'MEMBER'], ['globalAdmin', null, null],
      ]) {
        users[label] = await tx.user.create({ data: { email: `${runId}-${label}@example.invalid`,
          name: `Fictional ${label} ${runId}`, role: label === 'globalAdmin' ? 'ADMIN' : 'USER' } });
        if (enterpriseId) members[label] = await tx.enterpriseMember.create({ data: { userId: users[label].id,
          enterpriseId, role: role as any,
          ...(['memberA', 'managerA'].includes(label) ? { departmentId: department.id } : {}) } });
      }
      return { a, b, department, users, members };
    });
    const { a, b, users: u, members: m } = fixtures;
    evidence.fixtures = { enterpriseA: a.id, enterpriseB: b.id, departmentA: fixtures.department.id,
      users: Object.fromEntries(Object.entries(u).map(([key, value]: any) => [key, value.id])),
      members: Object.fromEntries(Object.entries(m).map(([key, value]: any) => [key, value.id])) };
    const kbA = await knowledge.create(u.adminA.id, { name: `Fictional KB A ${runId}` });
    const kbB = await knowledge.create(u.adminB.id, { name: `Fictional KB B ${runId}` });
    evidence.fixtures.knowledgeBases = { A: kbA.id, B: kbB.id };
    const query = 'quartz nebula';
    const readyText = 'quartz nebula fictional knowledge acceptance fixture';
    const createDocument = async (kbId: string, uploader: string, label: string, status: 'READY' | 'PENDING') => {
      const row = await prisma.document.create({ data: { knowledgeBaseId: kbId, filename: `${runId}-${label}.txt`,
        originalName: `Fictional ${label}.txt`, fileSize: Buffer.byteLength(readyText), mimeType: 'text/plain',
        storagePath: path.join(__dirname, `not-uploaded-${runId}-${label}.txt`), status, uploadedBy: uploader,
        ...(status === 'READY' ? { processedAt: new Date() } : {}) } });
      const chunk = await prisma.textChunk.create({ data: { knowledgeBaseId: kbId, documentId: row.id,
        content: readyText, source: row.id, tags: ['isolated-smoke'], tokens: tokenizer.tokenize(readyText), createdBy: uploader } });
      return { row, chunk };
    };
    const readyA = await createDocument(kbA.id, u.adminA.id, 'A-ready', 'READY');
    const pendingA = await createDocument(kbA.id, u.adminA.id, 'A-pending', 'PENDING');
    const readyB = await createDocument(kbB.id, u.adminB.id, 'B-ready', 'READY');
    evidence.fixtures.documents = { readyA: readyA.row.id, pendingA: pendingA.row.id, readyB: readyB.row.id };
    evidence.fixtures.chunks = { readyA: readyA.chunk.id, pendingA: pendingA.chunk.id, readyB: readyB.chunk.id };

    await check('admin-A-lists-only-own-KB', 'permission', async () => {
      const result = await knowledge.list(u.adminA.id, page);
      assert.deepEqual(result.items.map(item => item.id), [kbA.id]);
      assert.equal(result.total, 1); assert.equal(result.capabilities.canCreateKnowledgeBase, true);
      return { total: result.total, ownEnterpriseOnly: true };
    });
    await check('admin-B-lists-only-own-KB', 'permission', async () => {
      const result = await knowledge.list(u.adminB.id, page);
      assert.deepEqual(result.items.map(item => item.id), [kbB.id]);
      return { total: result.total, ownEnterpriseOnly: true };
    });
    await check('admin-own-KB-detail', 'permission', async () => {
      const result = await knowledge.getById(u.adminA.id, kbA.id);
      assert.equal(result.id, kbA.id); assert.equal(result.permissions.canManage, true);
      assert.equal(result.documentCount, 2); assert.equal(result.readyDocumentCount, 1);
      return { canManage: true, documentCount: result.documentCount, readyDocumentCount: result.readyDocumentCount };
    });
    await check('admin-cross-enterprise-detail-404', 'permission', () => expectStatus(() => knowledge.getById(u.adminA.id, kbB.id), 404));
    for (const actor of ['memberA', 'managerA']) {
      await check(`${actor}-ungranted-list-empty`, 'permission', () => emptyList(u[actor].id));
      await check(`${actor}-ungranted-detail-404`, 'permission', () => expectStatus(() => knowledge.getById(u[actor].id, kbA.id), 404));
      await check(`${actor}-ungranted-preview-404`, 'preview', () => expectStatus(() => documents.preview(kbA.id, readyA.row.id, u[actor].id, page), 404));
      await check(`${actor}-ungranted-explicit-search-404`, 'search', () => expectStatus(() => search.searchForMember(u[actor].id, { query, topK: 5, knowledgeBaseIds: [kbA.id] }), 404));
      await check(`${actor}-ungranted-search-empty`, 'search', async () => {
        const result = await search.searchForMember(u[actor].id, { query, topK: 5 });
        assert.equal(result.count, 0); assert.equal(result.results.length, 0);
        return { count: result.count };
      });
    }
    await check('cross-enterprise-mixed-grant-batch-400-and-full-rollback', 'permission', async () => {
      const before = await state(kbA.id);
      const response = await expectStatus(() => knowledge.createGrant(u.adminA.id, kbA.id,
        { memberIds: [m.memberA.id, m.memberB.id] }), 400, 'MEMBER_SELECTION_INVALID');
      const after = await state(kbA.id);
      assert.deepEqual(after, before); assert.equal(after.grantCount, 0);
      return { ...response, before, after, noPartialGrant: true };
    });
    await check('same-enterprise-grant-batch-persists-and-increments-revision-once', 'permission', async () => {
      const before = await state(kbA.id);
      const result = await knowledge.createGrant(u.adminA.id, kbA.id, { memberIds: [m.memberA.id, m.managerA.id] });
      const after = await state(kbA.id);
      assert.deepEqual([...result.addedMemberIds].sort(), [m.memberA.id, m.managerA.id].sort());
      assert.equal(result.existingMemberIds.length, 0);
      assert.equal(after.grantCount, 2); assert.equal(after.revision, before.revision + 1);
      return { addedCount: result.addedMemberIds.length, before, after };
    });
    await check('duplicate-grant-no-extra-row-or-revision', 'permission', async () => {
      const before = await state(kbA.id);
      const result = await knowledge.createGrant(u.adminA.id, kbA.id, { memberIds: [m.managerA.id, m.memberA.id] });
      const after = await state(kbA.id);
      assert.equal(result.addedMemberIds.length, 0); assert.equal(result.existingMemberIds.length, 2);
      assert.deepEqual(after, before);
      return { existingCount: result.existingMemberIds.length, before, after };
    });
    for (const actor of ['memberA', 'managerA']) {
      await check(`${actor}-granted-list`, 'permission', async () => {
        const result = await knowledge.list(u[actor].id, page);
        assert.deepEqual(result.items.map(item => item.id), [kbA.id]);
        assert.equal(result.total, 1); assert.equal(result.capabilities.canCreateKnowledgeBase, false);
        return { total: result.total, canCreateKnowledgeBase: false };
      });
      await check(`${actor}-granted-detail-read-only`, 'permission', async () => {
        const result = await knowledge.getById(u[actor].id, kbA.id);
        assert.equal(result.id, kbA.id);
        assert.deepEqual(result.permissions, { canView: true, canSearch: true, canManage: false, canUpload: false, canManageGrants: false });
        return result.permissions;
      });
      await check(`${actor}-cannot-grant-403`, 'permission', () => expectStatus(() => knowledge.createGrant(u[actor].id, kbA.id,
        { memberIds: [m.memberA.id] }), 403, 'KNOWLEDGE_ADMIN_REQUIRED'));
      await check(`${actor}-ready-document-preview`, 'preview', async () => {
        const result = await documents.preview(kbA.id, readyA.row.id, u[actor].id, { page: 1, pageSize: 1 });
        assert.equal(result.previewKind, 'PROCESSED_CHUNKS'); assert.equal(result.total, 1);
        assert.equal(result.items[0].chunkId, readyA.chunk.id); assert.equal(result.items[0].text, readyText);
        return { previewKind: result.previewKind, total: result.total, exactFixtureText: true };
      });
      await check(`${actor}-real-lexical-search-ready-only`, 'search', async () => {
        const result = await search.searchForMember(u[actor].id, { query, topK: 5, knowledgeBaseIds: [kbA.id] });
        assert.equal(result.strategy, 'lexical'); assert.equal(result.count, 1);
        assert.equal(result.results[0].chunkId, readyA.chunk.id); assert.equal(result.results[0].documentId, readyA.row.id);
        assert.equal(result.results[0].knowledgeBaseId, kbA.id); assert.equal(result.results[0].content, readyText);
        assert.ok(result.results[0].score > 0);
        return { strategy: result.strategy, count: result.count, score: result.results[0].score,
          pendingAndOtherEnterpriseExcluded: true, realPgTrgmAndBM25: true };
      });
      await check(`${actor}-cross-enterprise-preview-404`, 'preview', () => expectStatus(() => documents.preview(kbB.id, readyB.row.id, u[actor].id, page), 404));
      await check(`${actor}-cross-enterprise-search-404`, 'search', () => expectStatus(() => search.searchForMember(u[actor].id,
        { query, topK: 5, knowledgeBaseIds: [kbA.id, kbB.id] }), 404));
    }
    await check('preview-pending-document-409', 'preview', () => expectStatus(() => documents.preview(kbA.id, pendingA.row.id, u.memberA.id, page), 409, 'DOCUMENT_NOT_READY'));
    await check('preview-page-after-last-is-empty', 'preview', async () => {
      const result = await documents.preview(kbA.id, readyA.row.id, u.memberA.id, { page: 2, pageSize: 1 });
      assert.equal(result.total, 1); assert.equal(result.items.length, 0);
      return { total: 1, page: 2, itemCount: 0 };
    });
    await check('revoke-member-grant-removes-row-and-increments-revision', 'permission', async () => {
      const before = await state(kbA.id);
      await knowledge.revokeMemberGrant(u.adminA.id, kbA.id, m.memberA.id);
      const after = await state(kbA.id);
      assert.equal(after.grantCount, before.grantCount - 1); assert.equal(after.revision, before.revision + 1);
      return { before, after };
    });
    await check('revoked-member-list-empty', 'permission', () => emptyList(u.memberA.id));
    await check('revoked-member-detail-404', 'permission', () => expectStatus(() => knowledge.getById(u.memberA.id, kbA.id), 404));
    await check('revoked-member-preview-404', 'preview', () => expectStatus(() => documents.preview(kbA.id, readyA.row.id, u.memberA.id, page), 404));
    await check('revoked-member-search-404', 'search', () => expectStatus(() => search.searchForMember(u.memberA.id, { query, topK: 5, knowledgeBaseIds: [kbA.id] }), 404));
    await check('repeated-revoke-does-not-increment-revision', 'permission', async () => {
      const before = await state(kbA.id);
      await knowledge.revokeMemberGrant(u.adminA.id, kbA.id, m.memberA.id);
      const after = await state(kbA.id); assert.deepEqual(after, before);
      return { before, after };
    });
    await check('document-projection-omits-uploader-account-fields', 'preview', async () => {
      const rows = await documents.listDocumentsForUser(kbA.id, u.managerA.id);
      const detail = await documents.getDocumentForUser(kbA.id, readyA.row.id, u.managerA.id);
      for (const row of [...rows, detail]) {
        assert.equal('uploadedBy' in row, false);
        assert.equal('email' in row.uploader, false);
        assert.equal('id' in row.uploader, false);
      }
      return { documentsChecked: rows.length + 1, accountFieldsAbsent: true };
    });
    await check('regrant-before-departure', 'permission', async () => {
      await knowledge.createGrant(u.adminA.id, kbA.id, { memberIds: [m.memberA.id] });
      const result = await knowledge.getById(u.memberA.id, kbA.id);
      assert.equal(result.id, kbA.id);
      assert.equal(await prisma.knowledgeMemberGrant.count({ where: { memberId: m.memberA.id } }), 1);
      return { readable: true, membershipGrantCount: 1 };
    });
    await check('membership-offboard-cascades-grants-and-increments-revision', 'permission', async () => {
      assert.equal(await prisma.knowledgeMemberGrant.count({ where: { memberId: m.memberA.id } }), 1);
      const before = await state(kbA.id);
      await members.remove(u.adminA.id, m.memberA.id);
      const after = await state(kbA.id);
      assert.equal(after.revision, before.revision + 1);
      const remaining = await prisma.knowledgeMemberGrant.count({ where: { memberId: m.memberA.id } });
      assert.equal(remaining, 0);
      assert.equal(await prisma.knowledgeMemberGrant.count({ where: { memberId: m.managerA.id, knowledgeBaseId: kbA.id } }), 1);
      return { deletedMembership: m.memberA.id, beforeGrantCount: 1, afterGrantCount: remaining, otherMemberGrantPreserved: true };
    });
    await check('departed-member-has-no-enterprise-context-403', 'permission', () => expectStatus(() => knowledge.list(u.memberA.id, page), 403, 'ENTERPRISE_MEMBERSHIP_REQUIRED'));
    await check('rejoin-creates-new-memberId-without-old-grants', 'permission', async () => {
      const newMember = await prisma.enterpriseMember.create({ data: { userId: u.memberA.id, enterpriseId: a.id, role: 'MEMBER', departmentId: fixtures.department.id } });
      evidence.fixtures.rejoinedMember = newMember.id;
      assert.notEqual(newMember.id, m.memberA.id);
      assert.equal(await prisma.knowledgeMemberGrant.count({ where: { memberId: newMember.id } }), 0);
      const resolved = await context.resolve(u.memberA.id); assert.equal(resolved.memberId, newMember.id);
      return { oldMemberId: m.memberA.id, newMemberId: newMember.id, grantCount: 0 };
    });
    await check('rejoined-member-list-empty', 'permission', () => emptyList(u.memberA.id));
    await check('rejoined-member-detail-404', 'permission', () => expectStatus(() => knowledge.getById(u.memberA.id, kbA.id), 404));
    await check('rejoined-member-preview-404', 'preview', () => expectStatus(() => documents.preview(kbA.id, readyA.row.id, u.memberA.id, page), 404));
    await check('rejoined-member-search-404', 'search', () => expectStatus(() => search.searchForMember(u.memberA.id, { query, topK: 5, knowledgeBaseIds: [kbA.id] }), 404));
    await check('manager-still-reads-after-other-member-departure', 'permission', async () => {
      const result = await knowledge.getById(u.managerA.id, kbA.id); assert.equal(result.id, kbA.id);
      return { unaffected: true };
    });
    await check('global-ADMIN-fixture-has-no-membership', 'permission', async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: u.globalAdmin.id } });
      assert.equal(user.role, 'ADMIN'); assert.equal(await prisma.enterpriseMember.count({ where: { userId: user.id } }), 0);
      return { globalRole: user.role, membershipCount: 0 };
    });
    for (const [name, call] of [
      ['list', () => knowledge.list(u.globalAdmin.id, page)],
      ['detail', () => knowledge.getById(u.globalAdmin.id, kbA.id)],
      ['grant', () => knowledge.createGrant(u.globalAdmin.id, kbA.id, { memberIds: [m.managerA.id] })],
      ['preview', () => documents.preview(kbA.id, readyA.row.id, u.globalAdmin.id, page)],
      ['search', () => search.searchForMember(u.globalAdmin.id, { query, topK: 5, knowledgeBaseIds: [kbA.id] })],
    ] as const) {
      await check(`global-ADMIN-no-membership-${name}-403`, name === 'preview' ? 'preview' : name === 'search' ? 'search' : 'permission',
        () => expectStatus(call, 403, 'ENTERPRISE_MEMBERSHIP_REQUIRED'));
    }
    await check('no-upload-or-model-or-vector-or-queue-calls', 'boundary', async () => {
      assert.equal(counters.forbiddenDependencyCalls, 0);
      assert.equal(counters.embeddingAvailabilityChecks, 2);
      assert.equal(existsSync(readyA.row.storagePath), false);
      assert.equal(existsSync(pendingA.row.storagePath), false);
      assert.equal(existsSync(readyB.row.storagePath), false);
      return { ...counters, physicalUploadsCreated: 0 };
    });
    evidence.finalDatabaseState = {
      A: await state(kbA.id), B: await state(kbB.id),
      syntheticEnterpriseCount: await prisma.enterprise.count({ where: { id: { in: [a.id, b.id] } } }),
      syntheticUserCount: await prisma.user.count({ where: { id: { in: Object.values(u).map((value: any) => value.id) } } }),
      documentCount: await prisma.document.count({ where: { knowledgeBaseId: { in: [kbA.id, kbB.id] } } }),
      chunkCount: await prisma.textChunk.count({ where: { knowledgeBaseId: { in: [kbA.id, kbB.id] } } }),
    };
  } catch (error: any) {
    fatal = { type: error?.name || 'Error', code: error?.code || null };
    evidence.fatal = fatal;
  } finally {
    await prisma.$disconnect().catch(() => { evidence.disconnectFailed = true; });
    evidence.sourceHashesAfter = hashes();
    evidence.sourceChangedDuringRun = sourcePaths.filter(file => evidence.sourceHashesBefore[file] !== evidence.sourceHashesAfter[file]);
    evidence.dependencyCounters = counters;
    evidence.finishedAt = new Date().toISOString();
    const passed = evidence.checks.filter((check: any) => check.status === 'passed').length;
    const failed = evidence.checks.length - passed;
    evidence.summary = { total: evidence.checks.length, passed, failed,
      byArea: Object.fromEntries(['permission', 'preview', 'search', 'boundary'].map(area => {
        const checks = evidence.checks.filter((check: any) => check.area === area);
        return [area, { total: checks.length, passed: checks.filter((check: any) => check.status === 'passed').length,
          failed: checks.filter((check: any) => check.status === 'failed').length }];
      })), status: fatal || failed ? 'failed' : 'passed' };
    if (evidence.sourceChangedDuringRun.length) evidence.limitations.push('Relevant source changed concurrently; inspect hashes before interpreting results.');
    const output = JSON.stringify(evidence, null, 2) + '\n';
    const password = new URL(process.env.DATABASE_URL!).password;
    // Fail closed rather than persist a credential if any evidence field unexpectedly contains it.
    if (password && (output.includes(password) || output.includes(decodeURIComponent(password)))) {
      throw new Error('CREDENTIAL_REDACTION_GUARD');
    }
    writeFileSync(evidencePath, output, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ evidence: evidencePath, ...evidence.summary }));
    if (fatal || failed) process.exitCode = 1;
    delete process.env.DATABASE_URL;
  }
}
