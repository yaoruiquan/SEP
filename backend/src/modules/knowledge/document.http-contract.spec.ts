import {
  ExecutionContext,
  ForbiddenException,
  HttpException,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { KnowledgeAccessPolicy } from './knowledge-access-policy';
import { KnowledgeAuthGuard } from './knowledge-auth.guard';
import { KnowledgeUploadGuard } from './knowledge-upload.guard';

describe('Document HTTP contracts', () => {
  const base = '/api/knowledge-bases/kb-a/documents';
  const etag = `"kbdoc-${'a'.repeat(64)}"`;
  const key = 'document-write-1';
  const content = Buffer.from('Document contract fixture');
  const document = { id: 'doc-a', etag, revision: 3, status: 'PENDING' };
  const uploads = [
    { path: `${base}/upload`, method: 'uploadDocument' },
    { path: `${base}/doc-a/versions`, method: 'uploadVersion' },
  ];
  const routes = [
    { verb: 'post' as const, path: uploads[0].path },
    { verb: 'post' as const, path: uploads[1].path },
    { verb: 'get' as const, path: base },
    { verb: 'get' as const, path: `${base}/doc-a` },
    { verb: 'get' as const, path: `${base}/doc-a/versions` },
    { verb: 'get' as const, path: `${base}/doc-a/preview` },
    { verb: 'get' as const, path: `${base}/doc-a/download` },
    { verb: 'post' as const, path: `${base}/doc-a/reprocess` },
    { verb: 'delete' as const, path: `${base}/doc-a` },
  ];
  let app: INestApplication;
  let service: Record<string, jest.Mock>;
  let policy: { assertManage: jest.Mock };

  function expectNoServiceCalls() {
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
  }

  beforeEach(async () => {
    service = {
      uploadDocument: jest.fn().mockResolvedValue(document),
      uploadVersion: jest.fn().mockResolvedValue({ ...document, unchanged: false }),
      listDocumentsForUser: jest.fn().mockResolvedValue([document]),
      getDocumentForUser: jest.fn().mockResolvedValue(document),
      listVersions: jest.fn().mockResolvedValue([{ id: 'version-a' }]),
      preview: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      downloadDocument: jest.fn().mockResolvedValue(undefined),
      retry: jest.fn().mockResolvedValue(document),
      deleteDocument: jest.fn().mockResolvedValue({ internal: 'must not be serialized' }),
    };
    policy = { assertManage: jest.fn().mockResolvedValue(undefined) };
    // Stub token verification only; retain KnowledgeAuthGuard and its no-store policy.
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
        KnowledgeAuthGuard,
        KnowledgeUploadGuard,
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  it.each(routes)('requires authentication on $verb $path before service or upload policy', async ({ verb, path }) => {
    const response = await request(app.getHttpServer())[verb](path).send({}).expect(401);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(policy.assertManage).not.toHaveBeenCalled();
    expectNoServiceCalls();
  });

  it('rejects an invalid bearer token instead of treating it as an authenticated user', async () => {
    await request(app.getHttpServer()).get(`${base}/doc-a`)
      .set('Authorization', 'Bearer invalid').expect(401);
    expectNoServiceCalls();
  });

  it.each(uploads.flatMap(upload => [403, 404].map(status => ({ ...upload, status }))))(
    'checks management access before multipart parsing on $path ($status)',
    async ({ path, status }) => {
      policy.assertManage.mockRejectedValueOnce(status === 403
        ? new ForbiddenException('Management access required')
        : new NotFoundException('Knowledge base unavailable'));
      // Without the upload guard, Multer would reject this missing boundary with 400.
      const response = await request(app.getHttpServer()).post(path)
        .set('Authorization', 'Bearer contract-user')
        .set('Content-Type', 'multipart/form-data')
        .send('not a valid multipart body').expect(status);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(policy.assertManage).toHaveBeenCalledTimes(1);
      expect(policy.assertManage).toHaveBeenCalledWith('user-a', 'kb-a');
      expectNoServiceCalls();
    },
  );

  it.each(uploads)('parses multipart only after management access succeeds on $path', async ({ path }) => {
    await request(app.getHttpServer()).post(path)
      .set('Authorization', 'Bearer contract-user')
      .set('Content-Type', 'multipart/form-data')
      .send('not a valid multipart body').expect(400);
    expect(policy.assertManage).toHaveBeenCalledWith('user-a', 'kb-a');
    expectNoServiceCalls();
  });

  it.each(uploads)('rejects unknown multipart text fields on $path', async ({ path }) => {
    await request(app.getHttpServer()).post(path)
      .set('Authorization', 'Bearer contract-user')
      .field('userId', 'spoofed-user')
      .attach('file', content, { filename: 'policy.txt', contentType: 'text/plain' }).expect(400);
    expect(policy.assertManage).toHaveBeenCalledWith('user-a', 'kb-a');
    expectNoServiceCalls();
  });

  it.each(uploads)('rejects unexpected multipart file fields on $path', async ({ path }) => {
    await request(app.getHttpServer()).post(path)
      .set('Authorization', 'Bearer contract-user')
      .attach('file', content, 'policy.txt')
      .attach('unexpected', content, 'extra.txt').expect(400);
    expectNoServiceCalls();
  });

  it.each(uploads)('rejects a multipart request without a file on $path', async ({ path }) => {
    await request(app.getHttpServer()).post(path)
      .set('Authorization', 'Bearer contract-user')
      .set('Content-Type', 'multipart/form-data; boundary=empty')
      .send('--empty--\r\n').expect(400);
    expectNoServiceCalls();
  });

  it.each(uploads)('enforces the 10 MiB multipart file limit on $path', async ({ path }) => {
    await request(app.getHttpServer()).post(path)
      .set('Authorization', 'Bearer contract-user')
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), 'too-large.txt').expect(413);
    expectNoServiceCalls();
  });

  it('accepts the initial upload with 202 and passes the file, actor and idempotency key unchanged', async () => {
    const response = await request(app.getHttpServer()).post(`${base}/upload`)
      .set('Authorization', 'Bearer contract-user').set('Idempotency-Key', key)
      .attach('file', content, { filename: 'policy.txt', contentType: 'text/plain' }).expect(202);
    expect(response.body).toEqual(document);
    expect(response.headers.etag).toBe(etag);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.uploadDocument).toHaveBeenCalledTimes(1);
    expect(service.uploadDocument).toHaveBeenCalledWith('kb-a', expect.objectContaining({
      fieldname: 'file', originalname: 'policy.txt', mimetype: 'text/plain',
      size: content.length, buffer: content,
    }), 'user-a', { idempotencyKey: key });
    expect(policy.assertManage.mock.invocationCallOrder[0])
      .toBeLessThan(service.uploadDocument.mock.invocationCallOrder[0]);
  });

  it.each([
    { unchanged: false, status: 202 },
    { unchanged: true, status: 200 },
  ])('returns $status and the service ETag for unchanged=$unchanged', async ({ unchanged, status }) => {
    const result = { ...document, unchanged };
    service.uploadVersion.mockResolvedValueOnce(result);
    const response = await request(app.getHttpServer()).post(`${base}/doc-a/versions`)
      .set('Authorization', 'Bearer contract-user').set('If-Match', etag)
      .set('Idempotency-Key', key)
      .attach('file', content, 'policy.txt').expect(status);
    expect(response.headers.etag).toBe(etag);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual(result);
    expect(service.uploadVersion).toHaveBeenCalledTimes(1);
    expect(service.uploadVersion).toHaveBeenCalledWith('kb-a', 'doc-a',
      expect.objectContaining({ buffer: content, originalname: 'policy.txt' }), 'user-a',
      { ifMatch: etag, idempotencyKey: key });
  });

  it('serves the exact strong ETag from document details', async () => {
    const response = await request(app.getHttpServer()).get(`${base}/doc-a`)
      .set('Authorization', 'Bearer contract-user').expect(200);
    expect(response.headers.etag).toBe(etag);
    expect(response.headers.etag).not.toMatch(/^W\//);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual(document);
    expect(service.getDocumentForUser).toHaveBeenCalledWith('kb-a', 'doc-a', 'user-a');
  });

  it('dispatches the versions route to listVersions rather than document details', async () => {
    const response = await request(app.getHttpServer()).get(`${base}/doc-a/versions`)
      .set('Authorization', 'Bearer contract-user').expect(200);
    expect(response.body).toEqual([{ id: 'version-a' }]);
    expect(service.listVersions).toHaveBeenCalledWith('kb-a', 'doc-a', 'user-a');
    expect(service.getDocumentForUser).not.toHaveBeenCalled();
  });

  it('routes reprocess to retry with write headers and returns 202', async () => {
    const response = await request(app.getHttpServer()).post(`${base}/doc-a/reprocess`)
      .set('Authorization', 'Bearer contract-user').set('If-Match', etag)
      .set('Idempotency-Key', key).send({}).expect(202);
    expect(response.body).toEqual(document);
    expect(response.headers.etag).toBe(etag);
    expect(service.retry).toHaveBeenCalledTimes(1);
    expect(service.retry).toHaveBeenCalledWith('kb-a', 'doc-a', 'user-a',
      { ifMatch: etag, idempotencyKey: key });
    for (const [name, method] of Object.entries(service)) {
      if (name !== 'retry') expect(method).not.toHaveBeenCalled();
    }
  });

  it('rejects extra retry fields instead of letting clients select a generation or actor', async () => {
    await request(app.getHttpServer()).post(`${base}/doc-a/reprocess`)
      .set('Authorization', 'Bearer contract-user')
      .send({ generation: 999, userId: 'spoofed-user' }).expect(400);
    expectNoServiceCalls();
  });

  it.each([428, 412, 409])('preserves service precondition/conflict status %s on retry', async (status) => {
    service.retry.mockRejectedValueOnce(new HttpException('Write rejected', status));
    const response = await request(app.getHttpServer()).post(`${base}/doc-a/reprocess`)
      .set('Authorization', 'Bearer contract-user').set('If-Match', etag)
      .set('Idempotency-Key', key).send({}).expect(status);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns a bodyless 204 on delete and forwards both write headers', async () => {
    const response = await request(app.getHttpServer()).delete(`${base}/doc-a`)
      .set('Authorization', 'Bearer contract-user').set('If-Match', etag)
      .set('Idempotency-Key', key).expect(204);
    expect(response.text).toBe('');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.deleteDocument).toHaveBeenCalledTimes(1);
    expect(service.deleteDocument).toHaveBeenCalledWith('kb-a', 'doc-a', 'user-a',
      { ifMatch: etag, idempotencyKey: key });
  });

  it('awaits deletion and propagates a revision conflict rather than acknowledging it with 204', async () => {
    service.deleteDocument.mockRejectedValueOnce(new HttpException('Revision conflict', 412));
    const response = await request(app.getHttpServer()).delete(`${base}/doc-a`)
      .set('Authorization', 'Bearer contract-user').set('If-Match', etag)
      .set('Idempotency-Key', key).expect(412);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
