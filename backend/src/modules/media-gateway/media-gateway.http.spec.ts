import { ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { MediaGatewayMemoryStore } from '../../../test/helpers/media-gateway-memory-store';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { ClientEmploymentGuard } from '../client/client-employment.guard';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import { SecurityModule } from '../security/security.module';
import { MediaGatewayController } from './media-gateway.controller';
import { MediaGatewayMockGuard } from './media-gateway-mock.guard';
import { MediaGatewayMockAdapter, MEDIA_MOCK_PNG, MEDIA_MOCK_PNG_SHA256 } from './media-gateway-mock.adapter';
import { MediaGatewayService } from './media-gateway.service';
import { MediaGatewayStore, mediaStorageUnavailable } from './media-gateway.store';

const root = '/api/gateway/v1/media';
const claims: ClientEmploymentClaims = {
  sub: 'user-1', sid: 'session-1', enterpriseId: 'enterprise-1', subscriptionId: 'sub-1',
  memberId: 'member-1', type: 'client-employment', iat: 1, exp: 9999999999,
};

describe('media gateway mock HTTP contracts', () => {
  let app: INestApplication;
  let adapter: MediaGatewayMockAdapter;
  let environment: Record<string, string>;
  let store: MediaGatewayMemoryStore;
  const prisma = { enterpriseMember: { findFirst: jest.fn() }, subscription: { findFirst: jest.fn() } };

  beforeEach(async () => {
    environment = { NODE_ENV: 'test', MEDIA_GATEWAY_MOCK_ENABLED: 'true' };
    store = new MediaGatewayMemoryStore();
    prisma.enterpriseMember.findFirst.mockReset().mockResolvedValue({ departmentId: 'department-1' });
    prisma.subscription.findFirst.mockReset().mockResolvedValue({ id: 'sub-1' });
    const module = await Test.createTestingModule({
      imports: [SecurityModule],
      controllers: [MediaGatewayController],
      providers: [MediaGatewayService, MediaGatewayMockAdapter, MediaGatewayMockGuard, MediaGatewayStore,
        { provide: ConfigService, useValue: { get: (key: string) => environment[key] } },
        { provide: PrismaService, useValue: prisma },
      ],
    }).overrideProvider(MediaGatewayStore).useValue(store)
      .overrideProvider(getOptionsToken()).useValue([
      { name: 'default', ttl: 60_000, limit: 100 },
      { name: 'auth', ttl: 60_000, limit: 10 },
      { name: 'chat', ttl: 60_000, limit: 60 },
    ]).overrideGuard(ClientEmploymentGuard).useValue({
      canActivate: (context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest();
        if (!req.headers['x-test-auth']) throw new UnauthorizedException();
        req.clientEmployment = { ...claims,
          enterpriseId: req.headers['x-test-enterprise'] ?? claims.enterpriseId,
          memberId: req.headers['x-test-member'] ?? claims.memberId,
          subscriptionId: req.headers['x-test-subscription'] ?? claims.subscriptionId,
        };
        return true;
      },
    }).compile();
    adapter = module.get(MediaGatewayMockAdapter);
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
  });

  afterEach(async () => { jest.restoreAllMocks(); await app.close(); });

  const payload = (profileId = 'mock-sync', extra: Record<string, unknown> = {}) => ({
    profileId, configVersion: 'mock-v1', operation: 'generate', creativeBrief: 'Static product test',
    referenceIds: [], parameters: { size: '1x1', count: 1 }, ...extra,
  });
  const get = (path: string) => request(app.getHttpServer()).get(`${root}${path}`).set('x-test-auth', 'yes');
  const post = (path: string) => request(app.getHttpServer()).post(`${root}${path}`).set('x-test-auth', 'yes');
  async function submit(profileId = 'mock-sync', extra: Record<string, unknown> = {}, id = 'request-1') {
    const input = payload(profileId, extra);
    const quote = await post('/quotes').send(input).expect(201);
    const dto = { ...input, quoteId: quote.body.quoteId, clientRequestId: id };
    const result = await post('/requests').send(dto);
    return { dto, result };
  }

  it('requires authentication, fails closed before upload buffering, and rechecks revoked subscriptions', async () => {
    await request(app.getHttpServer()).get(`${root}/profiles`).expect(401);
    expect(prisma.enterpriseMember.findFirst).not.toHaveBeenCalled();
    environment.NODE_ENV = 'production';
    const closed = await post('/references').attach('file', Buffer.alloc(70_000), 'fixture.png').expect(503);
    expect(closed.body.error.code).toBe('MEDIA_MOCK_DISABLED');
    expect(prisma.enterpriseMember.findFirst).not.toHaveBeenCalled();
    environment.NODE_ENV = 'test';
    prisma.subscription.findFirst.mockResolvedValue(null);
    const revoked = await get('/profiles').expect(403);
    expect(revoked.body.error.code).toBe('MEDIA_FORBIDDEN');
  });

  it.each(['enterpriseMember', 'subscription'] as const)('returns storage 503 for the %s authorization query without exposing DB details', async (kind) => {
    const spy = jest.spyOn(adapter, 'submit');
    prisma[kind].findFirst.mockRejectedValueOnce(new Error('private database detail'));
    const result = await get('/requests/by-client-id/request-1').expect(503);
    expect(result.body.error).toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE', type: 'server_error', source: 'platform' });
    expect(JSON.stringify(result.body)).not.toContain('private database detail');
    expect(store.state.requests.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(['enterpriseMember', 'subscription'] as const)('preserves claim-time %s revocation as 403 and replays the failed receipt after restoration', async (kind) => {
    const spy = jest.spyOn(adapter, 'submit');
    const originalClaim = store.claim.bind(store);
    jest.spyOn(store, 'claim').mockImplementationOnce(async (claim) => {
      const result = await originalClaim(claim);
      prisma[kind].findFirst.mockResolvedValueOnce(null);
      return result;
    });
    const { dto, result } = await submit('mock-async');
    expect(result.status).toBe(403);
    expect(result.body.error.code).toBe('MEDIA_FORBIDDEN');
    const saved = (await store.findByClientId(claims.enterpriseId, dto.clientRequestId))!;
    const terminal = await get(`/requests/by-client-id/${dto.clientRequestId}`).expect(200);
    expect(terminal.body).toMatchObject({ receiptId: saved.receipt.receiptId, status: 'FAILED', errorCode: 'MEDIA_FORBIDDEN',
      pollAfterMs: null, recovery: { canQuery: false, canCancel: false, canDownload: false } });
    expect((await post('/requests').send(dto).expect(200)).body).toEqual(terminal.body);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(['enterpriseMember', 'subscription'] as const)('returns storage 503 and retains the ID when the claimed %s authorization query fails', async (kind) => {
    const spy = jest.spyOn(adapter, 'submit');
    const originalClaim = store.claim.bind(store);
    jest.spyOn(store, 'claim').mockImplementationOnce(async (claim) => {
      const result = await originalClaim(claim);
      prisma[kind].findFirst.mockRejectedValueOnce(new Error('private database detail'));
      return result;
    });
    const { dto, result } = await submit('mock-async');
    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe('MEDIA_STORAGE_UNAVAILABLE');
    expect(JSON.stringify(result.body)).not.toContain('private database detail');
    const replay = await post('/requests').send(dto).expect(200);
    expect(replay.body).toMatchObject({ status: 'FAILED', errorCode: 'MEDIA_STORAGE_UNAVAILABLE', pollAfterMs: null,
      recovery: { canQuery: false, canCancel: false, canDownload: false } });
    expect(store.state.requests.size).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('runs static reference -> quote -> synchronous receipt -> verified binary download', async () => {
    const profiles = await get('/profiles').expect(200);
    expect(profiles.body).toMatchObject({ mock: true, persistence: 'database', billingStatus: 'MOCK_NOT_CHARGED' });
    expect(profiles.body).not.toHaveProperty('data');
    expect(Buffer.from(profiles.body.referenceFixtureBase64, 'base64')).toEqual(MEDIA_MOCK_PNG);
    const ref = await post('/references').attach('file', MEDIA_MOCK_PNG, { filename: 'fixture.png', contentType: 'image/png' }).expect(201);
    expect(ref.body.sha256).toBe(MEDIA_MOCK_PNG_SHA256);
    const { result } = await submit('mock-sync', { operation: 'edit', referenceIds: [ref.body.referenceId], parameters: { size: '1x1', count: 2 } });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: 'SUCCEEDED', billingStatus: 'MOCK_NOT_CHARGED',
      recovery: { canQuery: false, canCancel: false, canDownload: true } });
    expect(result.body.outputs).toHaveLength(2);
    for (const output of result.body.outputs) {
      const download = await get(`/requests/${result.body.receiptId}/outputs/${output.outputId}/content`).expect(200);
      expect(download.headers['content-type']).toMatch(/^image\/png/);
      expect(download.headers['content-length']).toBe(String(MEDIA_MOCK_PNG.length));
      expect(download.headers['x-sha256']).toBe(output.sha256);
      expect(download.headers['x-sep-media-mock']).toBe('true');
      expect(download.headers['cache-control']).toBe('no-store');
      expect(download.body).toEqual(MEDIA_MOCK_PNG);
      expect(createHash('sha256').update(download.body).digest('hex')).toBe(output.sha256);
    }
  });

  it('rejects real/modified images, wrong upload fields, oversized uploads and extra form fields', async () => {
    const changed = Buffer.from(MEDIA_MOCK_PNG); changed[changed.length - 1] ^= 1;
    const invalid = await post('/references').attach('file', changed, { filename: 'fixture.png', contentType: 'image/png' }).expect(400);
    expect(invalid.body.error.code).toBe('INVALID_REFERENCE');
    await post('/references').attach('other', MEDIA_MOCK_PNG, 'fixture.png').expect(400);
    await post('/references').attach('file', Buffer.alloc(70_000), 'fixture.png').expect(413);
    await post('/references').field('enterpriseId', 'other').attach('file', MEDIA_MOCK_PNG, 'fixture.png').expect(400);
    await post('/references').attach('file', MEDIA_MOCK_PNG, 'fixture.png').attach('file', MEDIA_MOCK_PNG, 'fixture2.png').expect(400);
    await post('/references').expect(400);
  });

  it.each([
    { upstreamUrl: 'https://invalid.example' }, { enterpriseId: 'other' },
    { parameters: { size: '1024x1024', count: 1 } }, { operation: 'edit', referenceIds: [] },
  ])('rejects invalid quote payload before service side effects: %j', async (extra) => {
    const invalid = await post('/quotes').send(payload('mock-sync', extra)).expect(400);
    expect(invalid.body.error.code).toBe('INVALID_PARAMETER');
    expect(prisma.enterpriseMember.findFirst).not.toHaveBeenCalled();
  });

  it('replays concurrent submissions once, rejects semantic conflicts, and looks up without advancing', async () => {
    const spy = jest.spyOn(adapter, 'submit');
    const input = payload('mock-async');
    const quote = await post('/quotes').send(input).expect(201);
    const dto = { ...input, clientRequestId: 'stable', quoteId: quote.body.quoteId };
    const responses = await Promise.all(Array.from({ length: 8 }, () => post('/requests').send(dto).expect(202)));
    expect(new Set(responses.map((result) => result.body.receiptId)).size).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
    const lookup = await get('/requests/by-client-id/stable').expect(200);
    expect(lookup.body.status).toBe('QUEUED');
    const conflict = await post('/requests').send({ ...dto, creativeBrief: 'Different' }).expect(409);
    expect(conflict.body.error).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', source: 'platform' });
    const running = await get(`/requests/${lookup.body.receiptId}`).expect(200);
    expect(running.body.status).toBe('RUNNING');
    const succeeded = await get(`/requests/${lookup.body.receiptId}`).expect(200);
    expect(succeeded.body).toMatchObject({ status: 'SUCCEEDED', pollAfterMs: null, recovery: { canQuery: false, canCancel: false } });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each(['x-test-enterprise', 'x-test-member', 'x-test-subscription'])('denies reference and output access across %s', async (header) => {
    const ref = await post('/references').attach('file', MEDIA_MOCK_PNG, 'fixture.png').expect(201);
    const { result } = await submit();
    const receiptId = result.body.receiptId;
    const outputId = result.body.outputs[0].outputId;
    for (const path of [`/requests/${receiptId}`, `/requests/by-client-id/request-1`, `/requests/${receiptId}/outputs/${outputId}/content`]) {
      const denied = await get(path).set(header, 'other').expect(404);
      expect(denied.body.error.code).toBe('MEDIA_NOT_FOUND');
    }
    await post('/quotes').set(header, 'other').send(payload('mock-sync', { operation: 'edit', referenceIds: [ref.body.referenceId] })).expect(404);
  });

  it.each([['mock-partial', 'PARTIAL_SUCCEEDED'], ['mock-failed', 'FAILED']])('maps %s without losing output/error information', async (profile, status) => {
    const { result } = await submit(profile, { parameters: { size: '1x1', count: 2 } });
    expect(result.status).toBe(202);
    await get(`/requests/${result.body.receiptId}`).expect(200);
    const terminal = await get(`/requests/${result.body.receiptId}`).expect(200);
    expect(terminal.body).toMatchObject({ status, pollAfterMs: null, recovery: { canQuery: false, canCancel: false } });
    expect(terminal.body.outputs).toHaveLength(profile === 'mock-partial' ? 1 : 0);
    if (profile === 'mock-partial') expect(terminal.body.outputErrors).toEqual([{ index: 1, code: 'OUTPUT_FAILED' }]);
    else expect(terminal.body.errorCode).toBe('UPSTREAM_FAILED');
  });

  it('preserves unknown submission, reports expired results and refuses unsupported cancellation', async () => {
    const spy = jest.spyOn(adapter, 'submit');
    const unknown = await submit('mock-unknown', {}, 'unknown');
    expect(unknown.result.status).toBe(202);
    expect(unknown.result.body).toMatchObject({ status: 'SUBMISSION_UNKNOWN', pollAfterMs: null, recovery: { canQuery: false } });
    await post('/requests').send(unknown.dto).expect(202);
    expect(spy).toHaveBeenCalledTimes(1);
    const expired = await submit('mock-expired', {}, 'expired');
    expect(expired.result.body.status).toBe('RESULT_EXPIRED');
    const output = expired.result.body.outputs[0];
    const download = await get(`/requests/${expired.result.body.receiptId}/outputs/${output.outputId}/content`).expect(410);
    expect(download.body.error.code).toBe('RESULT_EXPIRED');
    const uncancellable = await submit('mock-no-cancel', {}, 'uncancellable');
    const cancel = await post(`/requests/${uncancellable.result.body.receiptId}/cancel`).send({}).expect(409);
    expect(cancel.body.error.code).toBe('CANCEL_UNSUPPORTED');
  });

  it('returns CANCELLED idempotently, without advancing or declaring a refund', async () => {
    const { result } = await submit('mock-async');
    const path = `/requests/${result.body.receiptId}/cancel`;
    const cancelled = await post(path).send({}).expect(201);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', billingStatus: 'MOCK_NOT_CHARGED', recovery: { canQuery: false, canCancel: false } });
    expect((await post(path).send({}).expect(201)).body).toEqual(cancelled.body);
    expect((await get(`/requests/${result.body.receiptId}`).expect(200)).body.status).toBe('CANCELLED');
  });

  it('keeps business throttling without applying login/chat limits to polling and downloads', async () => {
    const { result } = await submit('mock-async');
    const receiptPath = `/requests/${result.body.receiptId}`;
    await get(receiptPath).expect(200);
    const completed = await get(receiptPath).expect(200);
    for (let i = 0; i < 63; i++) await get(receiptPath).expect(200);
    const outputId = completed.body.outputs[0].outputId;
    for (let i = 0; i < 11; i++) await get(`${receiptPath}/outputs/${outputId}/content`).expect(200);
    for (let i = 0; i < 100; i++) await get('/profiles').expect(200);
    const limited = await get('/profiles').expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it.each([['mock-no-price', 409, 'PRICE_UNAVAILABLE'], ['mock-budget', 403, 'BUDGET_EXCEEDED']])('rejects %s before invoking adapter', async (profile, status, code) => {
    const spy = jest.spyOn(adapter, 'submit');
    const { result } = await submit(profile);
    expect(result.status).toBe(status);
    expect(result.body.error.code).toBe(code);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns a storage 503 without falling back or submitting when a claim cannot be acknowledged', async () => {
    const spy = jest.spyOn(adapter, 'submit');
    jest.spyOn(store, 'claim').mockImplementationOnce(async () => mediaStorageUnavailable());
    const { result } = await submit();
    expect(result.status).toBe(503);
    expect(result.body.error).toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE', source: 'platform', type: 'server_error' });
    expect(spy).not.toHaveBeenCalled();
    expect(store.state.requests.size).toBe(0);
  });

  it('reports failed final persistence as storage 503 and never submits the replay again', async () => {
    const spy = jest.spyOn(adapter, 'submit');
    jest.spyOn(store, 'save').mockImplementationOnce(async () => mediaStorageUnavailable());
    const { dto, result } = await submit();
    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe('MEDIA_STORAGE_UNAVAILABLE');
    const pending = await get('/requests/by-client-id/request-1').expect(200);
    expect(pending.body).toMatchObject({ status: 'SUBMITTING', outputs: [] });
    const replay = await post('/requests').send(dto).expect(202);
    expect(replay.body.receiptId).toBe(pending.body.receiptId);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
