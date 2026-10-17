import { ExecutionContext, ForbiddenException, INestApplication, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { KnowledgeAccessPolicy } from './knowledge-access-policy';
import { KnowledgeUploadGuard } from './knowledge-upload.guard';

describe('Document retry HTTP contract with the real durable service', () => {
  const path = '/knowledge-bases/kb-a/documents/doc-a/reprocess';
  const key = 'retry-request-1';
  let app: INestApplication;
  let service: DocumentService;
  let prisma: any;
  let tx: any;
  let policy: any;
  let queue: any;
  let version: any;
  let row: any;
  let etag: string;
  let committed: boolean;

  function retry(headers: { ifMatch?: string; idempotencyKey?: string } = { ifMatch: etag, idempotencyKey: key }) {
    const req = request(app.getHttpServer()).post(path).set('Authorization', 'Bearer contract-user');
    if (headers.ifMatch !== undefined) req.set('If-Match', headers.ifMatch);
    if (headers.idempotencyKey !== undefined) req.set('Idempotency-Key', headers.idempotencyKey);
    return req.send({});
  }

  function expectNoProcessing() {
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(queue.deliver).not.toHaveBeenCalled();
    expect(queue.processor.processJob).not.toHaveBeenCalled();
  }

  function expectNoDurableWrites() {
    expect(tx.documentVersion.update).not.toHaveBeenCalled();
    expect(tx.knowledgeProcessingJob.create).not.toHaveBeenCalled();
    expect(tx.document.update).not.toHaveBeenCalled();
    expect(tx.knowledgeIdempotency.create).not.toHaveBeenCalled();
    expectNoProcessing();
  }

  beforeEach(async () => {
    committed = false;
    version = {
      id: 'failed-v2', version: 2, generation: 4, status: 'FAILED', stage: 'FAILED',
      retryable: true, attempts: 3, processedChunks: 2, totalChunks: 5,
      errorCode: 'EMBEDDING_UNAVAILABLE', lastError: 'Retryable processing failure',
    };
    row = {
      id: 'doc-a', knowledgeBaseId: 'kb-a', originalName: 'policy.txt', filename: 'policy.txt',
      mimeType: 'text/plain', fileSize: 10, status: 'READY', version: 1, revision: 7,
      activeVersionId: 'active-v1', latestVersionId: version.id,
      versions: [{ id: 'active-v1', version: 1, status: 'READY', stage: 'DONE' }, version],
    };
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      enterpriseMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'member-a', enterpriseId: 'ent-a', role: 'ENTERPRISE_ADMIN' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'member-a', enterpriseId: 'ent-a', role: 'ENTERPRISE_ADMIN' }),
      },
      knowledgeBase: { findFirst: jest.fn().mockResolvedValue({ id: 'kb-a', enterpriseId: 'ent-a' }) },
      document: {
        findFirst: jest.fn().mockImplementation(async () => row),
        findUniqueOrThrow: jest.fn().mockImplementation(async () => row),
        update: jest.fn().mockResolvedValue({}),
      },
      documentVersion: {
        findUniqueOrThrow: jest.fn().mockImplementation(async () => version),
        update: jest.fn().mockResolvedValue({}),
      },
      knowledgeProcessingJob: { create: jest.fn().mockResolvedValue({ id: 'durable-job' }) },
      knowledgeIdempotency: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    prisma = {
      $transaction: jest.fn().mockImplementation(async callback => {
        const result = await callback(tx);
        committed = true;
        return result;
      }),
      document: {
        findFirst: jest.fn().mockResolvedValue({ id: 'doc-a' }),
        findUnique: jest.fn().mockImplementation(async () => {
          expect(committed).toBe(true);
          return {
            ...row, revision: 8,
            versions: [row.versions[0], { ...version, status: 'PENDING', stage: 'QUEUED', generation: 5 }],
          };
        }),
      },
    };
    policy = {
      assertManage: jest.fn().mockResolvedValue(undefined),
      assertRead: jest.fn().mockResolvedValue(undefined),
      notFound: jest.fn(() => { throw new NotFoundException(); }),
    };
    queue = { enqueue: jest.fn(), deliver: jest.fn(), processor: { processJob: jest.fn() } };
    service = new DocumentService(prisma, queue, policy, {} as any);
    etag = service.present(row).etag;
    jest.spyOn(JwtAuthGuard.prototype, 'canActivate').mockImplementation((context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest();
      if (req.headers.authorization !== 'Bearer contract-user') throw new UnauthorizedException();
      req.user = { id: 'user-a' };
      return true;
    });
    const module = await Test.createTestingModule({
      controllers: [DocumentController],
      providers: [
        { provide: DocumentService, useValue: service },
        { provide: KnowledgeAccessPolicy, useValue: policy },
        KnowledgeUploadGuard,
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  it('persists a new generation of the failed version and its job in one transaction without inline processing', async () => {
    const response = await retry().expect(202);
    expect(response.body).toMatchObject({
      id: 'doc-a', revision: 8, activeVersionId: 'active-v1', latestVersionId: 'failed-v2',
      searchable: true, latestVersion: { id: 'failed-v2', status: 'PENDING', stage: 'QUEUED' },
    });
    expect(policy.assertManage).toHaveBeenCalledWith('user-a', 'kb-a');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.documentVersion.update).toHaveBeenCalledTimes(1);
    expect(tx.documentVersion.update).toHaveBeenCalledWith({
      where: { id: 'failed-v2' },
      data: { generation: 5, status: 'PENDING', stage: 'QUEUED', errorCode: null, lastError: null,
        attempts: 0, processedChunks: 0, totalChunks: null },
    });
    expect(tx.knowledgeProcessingJob.create).toHaveBeenCalledTimes(1);
    expect(tx.knowledgeProcessingJob.create).toHaveBeenCalledWith({
      data: { documentId: 'doc-a', versionId: 'failed-v2', generation: 5 },
    });
    expect(tx.document.update).toHaveBeenCalledWith({ where: { id: 'doc-a' }, data: { revision: { increment: 1 } } });
    expect(tx.knowledgeIdempotency.create).toHaveBeenCalledWith({ data: {
      userId: 'user-a', knowledgeBaseId: 'kb-a', key,
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/), result: { documentId: 'doc-a' },
    } });
    expect(prisma.document.findUnique).toHaveBeenCalledTimes(1);
    expectNoProcessing();
  });

  it('does not acknowledge the HTTP request until the durable transaction commits', async () => {
    let ready: () => void;
    let commit: () => void;
    const writesFinished = new Promise<void>(resolve => { ready = resolve; });
    const commitAllowed = new Promise<void>(resolve => { commit = resolve; });
    prisma.$transaction.mockImplementationOnce(async callback => {
      const result = await callback(tx);
      ready!();
      await commitAllowed;
      committed = true;
      return result;
    });
    const responded = jest.fn();
    const response = retry().then(result => { responded(); return result; });
    try {
      await Promise.race([
        writesFinished,
        response.then(() => { throw new Error('HTTP response completed before durable writes'); }),
      ]);
      expect(tx.knowledgeProcessingJob.create).toHaveBeenCalledTimes(1);
      expect(committed).toBe(false);
      expect(responded).not.toHaveBeenCalled();
      expect(prisma.document.findUnique).not.toHaveBeenCalled();
      expectNoProcessing();
    } finally {
      commit!();
      await response;
    }
    expect((await response).status).toBe(202);
    expect(committed).toBe(true);
  });

  it('replays a saved idempotency result without creating another generation or job', async () => {
    await retry().expect(202);
    const stored = tx.knowledgeIdempotency.create.mock.calls[0][0].data;
    tx.knowledgeIdempotency.findUnique.mockResolvedValue(stored);
    tx.documentVersion.update.mockClear();
    tx.knowledgeProcessingJob.create.mockClear();
    tx.document.update.mockClear();
    tx.knowledgeIdempotency.create.mockClear();
    await retry().expect(202);
    expect(tx.knowledgeIdempotency.findUnique).toHaveBeenLastCalledWith({
      where: { userId_knowledgeBaseId_key: { userId: 'user-a', knowledgeBaseId: 'kb-a', key } },
    });
    expectNoDurableWrites();
  });

  it('locks and rechecks the member before locking the base or accepting a saved idempotency result', async () => {
    await retry().expect(202);
    const queries = tx.$queryRaw.mock.calls.map(([parts]) => parts.join('?'));
    expect(queries[0]).toMatch(/enterprise_members.*FOR SHARE/);
    expect(queries[1]).toMatch(/knowledge_bases.*FOR UPDATE/);
    expect(tx.enterpriseMember.findUnique).toHaveBeenCalledWith({ where: { id: 'member-a' } });
    expect(tx.enterpriseMember.findUnique.mock.invocationCallOrder[0])
      .toBeLessThan(tx.knowledgeIdempotency.findUnique.mock.invocationCallOrder[0]);
  });

  it.each([null, { id: 'member-a', enterpriseId: 'ent-a', role: 'MEMBER' }])(
    'rejects a member removed or downgraded while the transaction waits, including on replay: %p', async current => {
      await retry().expect(202);
      tx.knowledgeIdempotency.findUnique.mockResolvedValue(tx.knowledgeIdempotency.create.mock.calls[0][0].data);
      tx.enterpriseMember.findUnique.mockResolvedValue(current);
      for (const method of [tx.documentVersion.update, tx.knowledgeProcessingJob.create,
        tx.document.update, tx.knowledgeIdempotency.create, tx.knowledgeIdempotency.findUnique]) method.mockClear();
      await retry().expect(404);
      expect(tx.knowledgeIdempotency.findUnique).not.toHaveBeenCalled();
      expectNoDurableWrites();
    },
  );

  it('does not reuse an idempotency key for a different request', async () => {
    tx.knowledgeIdempotency.findUnique.mockResolvedValue({ requestHash: 'a-different-request', result: { documentId: 'doc-a' } });
    await retry().expect(409);
    expectNoDurableWrites();
  });

  it('rechecks management access in the service before opening a transaction', async () => {
    policy.assertManage.mockRejectedValueOnce(new ForbiddenException());
    await retry().expect(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expectNoDurableWrites();
  });

  it.each([
    { headers: { idempotencyKey: key }, status: 428 },
    { headers: { ifMatch: 'W/"revision"', idempotencyKey: key }, status: 400 },
    { headers: { ifMatch: '"7"', idempotencyKey: key }, status: 400 },
    { headers: { ifMatch: 'current' }, status: 400 },
    { headers: { ifMatch: 'current', idempotencyKey: 'short' }, status: 400 },
  ])('rejects invalid write preconditions before persistence: $headers', async ({ headers, status }) => {
    await retry({ ...headers, ifMatch: headers.ifMatch === 'current' ? etag : headers.ifMatch }).expect(status);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expectNoDurableWrites();
  });

  it('returns 412 for a stale strong ETag without scheduling a job', async () => {
    await retry({ ifMatch: `"kbdoc-${'f'.repeat(64)}"`, idempotencyKey: key }).expect(412);
    expectNoDurableWrites();
  });

  it.each([
    { status: 'READY', retryable: true, active: false },
    { status: 'PROCESSING', retryable: true, active: false },
    { status: 'FAILED', retryable: false, active: false },
    { status: 'FAILED', retryable: true, active: true },
  ])('rejects a version that cannot be retried: %p', async ({ status, retryable, active }) => {
    Object.assign(version, { status, retryable });
    if (active) row.activeVersionId = version.id;
    etag = service.present(row).etag;
    await retry().expect(409);
    expectNoDurableWrites();
  });

  it('does not return 202 or run a fallback processor when durable job creation fails', async () => {
    tx.knowledgeProcessingJob.create.mockRejectedValueOnce(new Error('Durable job insert failed'));
    await retry().expect(500);
    expect(committed).toBe(false);
    expect(tx.document.update).not.toHaveBeenCalled();
    expect(tx.knowledgeIdempotency.create).not.toHaveBeenCalled();
    expect(prisma.document.findUnique).not.toHaveBeenCalled();
    expectNoProcessing();
  });
});
