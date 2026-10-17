import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  let enterpriseId: string | undefined;
  let userId: string | undefined;
  try {
    const user = await prisma.user.create({ data: { email: `kb-version-${randomUUID()}@example.invalid`, name: 'Version test' } });
    userId = user.id;
    const enterprise = await prisma.enterprise.create({ data: { name: 'Isolated KB version test' } });
    enterpriseId = enterprise.id;
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
      real: ['private file storage', 'TXT parser', 'PostgreSQL transactions', 'native pgvector', 'lexical retrieval', 'lease recovery'],
      simulated: ['embedding provider', 'tokenizer'], notCovered: ['live sub2api', 'HTTP authentication', 'Redis outage', 'production'] }));
  } finally {
    if (enterpriseId) await prisma.enterprise.delete({ where: { id: enterpriseId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}
