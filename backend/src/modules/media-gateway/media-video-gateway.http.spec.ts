import { ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { MediaVideoGatewayQuoteSchema, MediaVideoGatewayProfilesSchema, MediaVideoGatewayReceiptSchema } from 'shared';
import fixture from '../../shared/fixtures/media-video-v1.json';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { ClientEmploymentGuard } from '../client/client-employment.guard';
import { SecurityModule } from '../security/security.module';
import { MediaGatewayMockGuard } from './media-gateway-mock.guard';
import { MediaGatewayService } from './media-gateway.service';
import { MediaVideoGatewayController } from './media-video-gateway.controller';
import { MediaVideoGatewayService } from './media-video-gateway.service';
import { MediaVideoGatewayStore } from './media-video-gateway.store';
import { createVideoPrismaMock, videoClaims as claims, videoFile, videoInput } from './media-video-gateway.test-support';
import type { VideoPrismaMock } from './media-video-gateway.test-support';

const root = '/api/gateway/v1/media/video';
describe('video mock HTTP / real controller, service and Prisma store', () => {
  let app: INestApplication;
  let prisma: VideoPrismaMock;
  let environment: Record<string, string>;
  async function start() {
    const module = await Test.createTestingModule({
      imports: [SecurityModule],
      controllers: [MediaVideoGatewayController],
      providers: [MediaVideoGatewayService, MediaVideoGatewayStore, MediaGatewayMockGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: (key: string) => environment[key] } },
        { provide: MediaGatewayService, useFactory: (config: ConfigService) => new MediaGatewayService(config, prisma as never, null as never, null as never), inject: [ConfigService] },
      ],
    }).overrideProvider(getOptionsToken()).useValue([
      { name: 'default', ttl: 60_000, limit: 100 },
      { name: 'auth', ttl: 60_000, limit: 10 },
      { name: 'chat', ttl: 60_000, limit: 60 },
    ]).overrideGuard(ClientEmploymentGuard).useValue({
      canActivate(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest();
        if (!req.headers['x-test-auth']) throw new UnauthorizedException();
        req.clientEmployment = { ...claims,
          enterpriseId: req.headers['x-test-enterprise'] ?? claims.enterpriseId,
          memberId: req.headers['x-test-member'] ?? claims.memberId,
          subscriptionId: req.headers['x-test-subscription'] ?? claims.subscriptionId,
          sub: req.headers['x-test-user'] ?? claims.sub,
        };
        return true;
      },
    }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api'); app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
  }
  beforeEach(async () => { prisma = createVideoPrismaMock(); environment = { NODE_ENV: 'test', MEDIA_GATEWAY_MOCK_ENABLED: 'true' }; await start(); });
  afterEach(async () => { jest.restoreAllMocks(); await app.close(); });
  const get = (path: string) => request(app.getHttpServer()).get(`${root}${path}`).set('x-test-auth', 'yes');
  const post = (path: string) => request(app.getHttpServer()).post(`${root}${path}`).set('x-test-auth', 'yes');
  const upload = () => post('/references').attach('file', videoFile().buffer, { filename: 'fixture.png', contentType: 'image/png' });
  async function prepared(clientRequestId = 'video-request') {
    const ref = await upload().expect(201);
    const input = videoInput(ref.body.referenceId);
    const quote = await post('/quotes').send(input).expect(201);
    expect(MediaVideoGatewayQuoteSchema.safeParse(quote.body).success).toBe(true);
    return { ...input, quoteId: quote.body.quoteId, clientRequestId };
  }

  it('requires employment authentication and disables production before upload buffering', async () => {
    await request(app.getHttpServer()).get(`${root}/profiles`).expect(401);
    await request(app.getHttpServer()).post(`${root}/requests/missing/cancel`).send({}).expect(401);
    expect(prisma.enterpriseMember.findFirst).not.toHaveBeenCalled();
    environment.NODE_ENV = 'production';
    const disabled = await post('/references').attach('file', Buffer.alloc(70_000), 'file.png').expect(503);
    expect(disabled.body.error.code).toBe('MEDIA_MOCK_DISABLED');
    expect(prisma.enterpriseMember.findFirst).not.toHaveBeenCalled();
    expect(prisma.mediaGatewayReference.create).not.toHaveBeenCalled();
  });

  it('rejects malformed bodies and path IDs, altered images, extra fields and oversized uploads', async () => {
    await post('/quotes').send({ ...videoInput('missing'), upstreamUrl: 'https://invalid.example' }).expect(400);
    await post('/requests').send({ ...videoInput('missing'), quoteId: 'q', clientRequestId: '../unsafe' }).expect(400);
    await post('/requests/missing/cancel').send({ force: true }).expect(400);
    expect(prisma.enterpriseMember.findFirst).not.toHaveBeenCalled();
    await get('/requests/invalid%24id').expect(400);
    await get('/requests/by-client-id/invalid%24id').expect(400);
    await post('/references').attach('file', Buffer.from('not a PNG'), { filename: 'bad.png', contentType: 'image/png' }).expect(400);
    await post('/references').field('scope', 'other').attach('file', videoFile().buffer, 'fixture.png').expect(400);
    await post('/references').attach('file', Buffer.alloc(70_000), 'huge.png').expect(413);
    await post('/references').expect(400);
    expect(prisma.state.requests.size).toBe(0);
    expect(prisma.state.references.size).toBe(0);
  });

  it('serves persisted profiles, quotes and original receipts, and downloads verified playable MP4 bytes', async () => {
    const profiles = await get('/profiles').expect(200);
    expect(MediaVideoGatewayProfilesSchema.safeParse(profiles.body).success).toBe(true);
    expect(profiles.body.persistence).toBe('database');
    const dto = await prepared(); const first = await post('/requests').send(dto).expect(202);
    expect(MediaVideoGatewayReceiptSchema.safeParse(first.body).success).toBe(true);
    expect((await get(`/requests/by-client-id/${dto.clientRequestId}`).expect(200)).body).toEqual(first.body);
    const path = `/requests/${first.body.receiptId}`;
    expect((await get(path).expect(200)).body.status).toBe('RUNNING');
    const done = await get(path).expect(200);
    expect(done.body.status).toBe('SUCCEEDED');
    const content = await get(`${path}/outputs/${done.body.outputs[0].outputId}/content`).expect(200);
    expect(content.headers['content-type']).toMatch(/^video\/mp4/);
    expect(content.headers['content-length']).toBe(String(fixture.mediaFixture.byteLength));
    expect(content.headers['x-sha256']).toBe(fixture.mediaFixture.sha256);
    expect(content.headers['x-sep-media-mock']).toBe('true');
    expect(content.headers['cache-control']).toBe('no-store');
    expect(content.headers['x-content-type-options']).toBe('nosniff');
    expect(createHash('sha256').update(content.body).digest('hex')).toBe(fixture.mediaFixture.sha256);
    expect(content.body.subarray(4, 8).toString()).toBe('ftyp');
    expect((await post('/requests').send(dto).expect(200)).body).toEqual(done.body);
  });

  it('returns 409 for semantic and image-key conflicts, with no new row', async () => {
    const dto = await prepared(); const first = await post('/requests').send(dto).expect(202);
    const conflict = await post('/requests').send({ ...dto, creativeBrief: 'Different intent' }).expect(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    const row = prisma.state.requests.get(first.body.receiptId)!;
    row.configuration = { adapter: 'static-png-v1' };
    await post('/requests').send(dto).expect(409);
    await get(`/requests/by-client-id/${dto.clientRequestId}`).expect(404);
    await get(`/requests/${row.id}`).expect(404);
    await post(`/requests/${row.id}/cancel`).send({}).expect(404);
    expect(prisma.state.requests.size).toBe(1);
    expect(prisma.mediaGatewayRequest.updateMany).not.toHaveBeenCalled();
  });

  it.each(['x-test-enterprise', 'x-test-member', 'x-test-subscription', 'x-test-user'])('enforces scope for reference, quote, replay, cancel and downloads across %s', async header => {
    const dto = await prepared(); const first = await post('/requests').send(dto).expect(202);
    const id = first.body.receiptId;
    await get(`/requests/${id}`).expect(200); const done = await get(`/requests/${id}`).expect(200);
    await post('/quotes').set(header, 'other').send(dto).expect(400); // Extra request fields are rejected before access.
    await post('/quotes').set(header, 'other').send(videoInput(dto.referenceIds[0])).expect(404);
    await post('/requests').set(header, 'other').send(dto).expect(404);
    await get(`/requests/by-client-id/${dto.clientRequestId}`).set(header, 'other').expect(404);
    await get(`/requests/${id}`).set(header, 'other').expect(404);
    await get(`/requests/${id}/outputs/${done.body.outputs[0].outputId}/content`).set(header, 'other').expect(404);
    await post(`/requests/${id}/cancel`).set(header, 'other').send({}).expect(404);
    expect(prisma.state.requests.size).toBe(1);
  });

  it('rechecks cancel authorization and validates the resource before returning unsupported', async () => {
    const dto = await prepared(); const first = await post('/requests').send(dto).expect(202);
    await post('/requests/missing/cancel').send({}).expect(404);
    const unsupported = await post(`/requests/${first.body.receiptId}/cancel`).send({}).expect(409);
    expect(unsupported.body.error.code).toBe('CANCEL_UNSUPPORTED');
    prisma.subscription.findFirst.mockResolvedValue(null);
    await post(`/requests/${first.body.receiptId}/cancel`).send({}).expect(403);
    await get('/profiles').expect(403);
    expect(prisma.mediaGatewayRequest.updateMany).not.toHaveBeenCalled();
  });

  it('rechecks reference expiry between quote and submit, and refuses expired downloads', async () => {
    const dto = await prepared(); const ref = prisma.state.references.get(dto.referenceIds[0])!;
    ref.expiresAt = new Date(Date.now() - 1);
    ((ref.metadata as Prisma.JsonObject).value as Prisma.JsonObject).expiresAt = ref.expiresAt.toISOString();
    await post('/requests').send(dto).expect(404);
    expect(prisma.state.requests.size).toBe(0);
    ref.expiresAt = new Date(Date.now() + 60_000);
    ((ref.metadata as Prisma.JsonObject).value as Prisma.JsonObject).expiresAt = ref.expiresAt.toISOString();
    const first = await post('/requests').send(dto).expect(202); const id = first.body.receiptId;
    await get(`/requests/${id}`).expect(200); const done = await get(`/requests/${id}`).expect(200);
    const receipt = prisma.state.requests.get(id)!.receipt as Prisma.JsonObject;
    (receipt.outputs as Prisma.JsonObject[])[0].expiresAt = new Date(Date.now() - 1).toISOString();
    await get(`/requests/${id}/outputs/${done.body.outputs[0].outputId}/content`).expect(410);
    const expired = await get(`/requests/${id}`).expect(200);
    expect(expired.body).toMatchObject({ status: 'RESULT_EXPIRED', errorCode: 'RESULT_EXPIRED', recovery: { canQuery: false, canDownload: false } });
    expect(prisma.state.requests.get(id)!.status).toBe('RESULT_EXPIRED');
    expect((await get(`/requests/by-client-id/${dto.clientRequestId}`).expect(200)).body).toEqual(expired.body);
    expect((await post('/requests').send(dto).expect(200)).body).toEqual(expired.body);
  });

  it('uses database CAS for concurrent HTTP polls and restores the same receipt after app restart', async () => {
    const dto = await prepared(); const first = await post('/requests').send(dto).expect(202); const id = first.body.receiptId;
    const read = prisma.mediaGatewayRequest.findUnique.getMockImplementation()!;
    let arrivals = 0; let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    prisma.mediaGatewayRequest.findUnique.mockImplementation(async args => {
      const snapshot = await read(args);
      if (args.where.id === id && snapshot?.revision === 0) {
        arrivals++; if (arrivals === 2) release(); await barrier;
      }
      return snapshot;
    });
    const polls = await Promise.all([get(`/requests/${id}`).expect(200), get(`/requests/${id}`).expect(200)]);
    expect(polls.map(result => result.body.status)).toEqual(['RUNNING', 'RUNNING']);
    expect(prisma.state.requests.get(id)!.revision).toBe(1);
    await app.close(); await start();
    expect((await get(`/requests/by-client-id/${dto.clientRequestId}`).expect(200)).body).toMatchObject({ receiptId: id, status: 'RUNNING' });
    expect((await post('/requests').send(dto).expect(202)).body.receiptId).toBe(id);
    expect((await get(`/requests/${id}`).expect(200)).body.status).toBe('SUCCEEDED');
    expect(prisma.mediaGatewayRequest.create).toHaveBeenCalledTimes(1);
  });

  it('returns sanitized storage 503 on ambiguous insert and CAS failure, then recovers without re-submitting', async () => {
    const dto = await prepared(); const create = prisma.mediaGatewayRequest.create.getMockImplementation()!;
    prisma.mediaGatewayRequest.create.mockImplementationOnce(async args => { await create(args); throw new Error('private insert ack'); });
    const failed = await post('/requests').send(dto).expect(503);
    expect(failed.body.error).toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE', source: 'platform' });
    expect(JSON.stringify(failed.body)).not.toContain('private');
    const original = await get(`/requests/by-client-id/${dto.clientRequestId}`).expect(200);
    const update = prisma.mediaGatewayRequest.updateMany.getMockImplementation()!;
    prisma.mediaGatewayRequest.updateMany.mockImplementationOnce(async args => { await update(args); throw new Error('private CAS ack'); });
    await get(`/requests/${original.body.receiptId}`).expect(503);
    expect((await get(`/requests/by-client-id/${dto.clientRequestId}`).expect(200)).body.status).toBe('RUNNING');
    expect((await post('/requests').send(dto).expect(202)).body.receiptId).toBe(original.body.receiptId);
    expect(prisma.mediaGatewayRequest.create).toHaveBeenCalledTimes(1);
  });

  it('keeps business throttling while excluding login/chat limits from polling and downloads', async () => {
    const dto = await prepared(); const first = await post('/requests').send(dto).expect(202);
    const path = `/requests/${first.body.receiptId}`;
    await get(path).expect(200); const done = await get(path).expect(200);
    for (let i = 0; i < 12; i++) {
      await get(path).expect(200);
      await get(`${path}/outputs/${done.body.outputs[0].outputId}/content`).expect(200);
    }
    for (let i = 0; i < 100; i++) await get('/profiles').expect(200);
    const limited = await get('/profiles').expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
});
