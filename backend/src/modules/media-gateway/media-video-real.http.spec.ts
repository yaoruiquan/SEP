import { ExecutionContext, HttpException, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Readable } from 'node:stream';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { ClientEmploymentGuard } from '../client/client-employment.guard';
import { MediaVideoRealController } from './media-video-real.controller';
import { MediaVideoRealGuard } from './media-video-real.guard';
import { MediaVideoRealService } from './media-video-real.service';
import { input, outputMetadata, videoBytes, videoClaims } from './media-video-real.test-support';
import { MEDIA_MOCK_PNG } from './media-gateway-mock.adapter';

const root = '/api/gateway/v1/media/video-real';
describe('real video controller and guard HTTP', () => {
  let app: INestApplication;
  const media = { assertRealEnabled: jest.fn(), profiles: jest.fn(), reference: jest.fn(), quote: jest.fn(),
    submit: jest.fn(), findByClientId: jest.fn(), receipt: jest.fn(), content: jest.fn(), cancel: jest.fn() };
  const get = (path: string) => request(app.getHttpServer()).get(root + path).set('Authorization', 'Bearer employment');
  const post = (path: string) => request(app.getHttpServer()).post(root + path).set('Authorization', 'Bearer employment');
  const disabled = () => { throw new HttpException({ error: { code: 'MEDIA_REAL_DISABLED' } }, 503); };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [MediaVideoRealController],
      providers: [MediaVideoRealGuard, { provide: MediaVideoRealService, useValue: media }],
    }).overrideGuard(ClientEmploymentGuard).useValue({ canActivate(context: ExecutionContext) {
      const req = context.switchToHttp().getRequest();
      if (req.headers.authorization !== 'Bearer employment') throw new UnauthorizedException();
      req.clientEmployment = videoClaims; return true;
    } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter()); await app.listen(0, '127.0.0.1');
  });
  beforeEach(() => {
    for (const fn of Object.values(media)) fn.mockReset();
    media.profiles.mockResolvedValue({ mock: false, profiles: [] });
    media.quote.mockResolvedValue({ mock: false, quoteId: 'quote-1' });
    media.reference.mockResolvedValue({ mock: false, referenceId: 'reference-1' });
    media.submit.mockResolvedValue({ mock: false, status: 'QUEUED', receiptId: 'receipt-1' });
    media.receipt.mockResolvedValue({ mock: false, status: 'RUNNING', receiptId: 'receipt-1' });
    media.findByClientId.mockResolvedValue({ mock: false, status: 'SUBMISSION_UNKNOWN', receiptId: 'receipt-1' });
    media.content.mockImplementation(async () => ({ output: outputMetadata, stream: Readable.from(videoBytes) }));
    media.cancel.mockImplementation(() => { throw new HttpException({ error: { code: 'CANCEL_UNSUPPORTED' } }, 409); });
  });
  afterAll(async () => { await app?.close(); });

  it('requires employment authentication before execution gate or service', async () => {
    await request(app.getHttpServer()).get(root + '/profiles').expect(401);
    expect(media.profiles).not.toHaveBeenCalled(); expect(media.assertRealEnabled).not.toHaveBeenCalled();
  });

  it('gates new profiles, quotes and reference buffering before DTO parsing', async () => {
    media.assertRealEnabled.mockImplementation(disabled);
    await get('/profiles').expect(503);
    await post('/quotes').send({ invalid: true }).expect(503);
    await post('/references').attach('file', MEDIA_MOCK_PNG, { filename: 'reference.png', contentType: 'image/png' }).expect(503);
    expect(media.quote).not.toHaveBeenCalled(); expect(media.reference).not.toHaveBeenCalled();
  });

  it('leaves queries, original downloads and replay accessible when new execution is disabled', async () => {
    media.assertRealEnabled.mockImplementation(disabled);
    await get('/requests/by-client-id/client-1').expect(200);
    await get('/requests/receipt-1').expect(200);
    await get('/requests/receipt-1/outputs/output-1/content').expect(200);
    await post('/requests').send({ ...input, quoteId: 'quote-1', clientRequestId: 'client-1' }).expect(202);
    expect(media.assertRealEnabled).not.toHaveBeenCalled();
    expect(media.submit).toHaveBeenCalledWith(videoClaims, expect.objectContaining({ clientRequestId: 'client-1' }));
  });

  it('parses strict quote and request DTOs and refuses extra fields', async () => {
    await post('/quotes').send({ ...input, creativeBrief: '  brief  ' }).expect(201);
    expect(media.quote).toHaveBeenCalledWith(videoClaims, { ...input, creativeBrief: 'brief' });
    media.quote.mockClear();
    await post('/quotes').send({ ...input, mock: false }).expect(400);
    await post('/requests').send({ ...input, quoteId: 'quote-1', clientRequestId: 'client-1', upstreamTaskId: 'evil' }).expect(400);
    expect(media.quote).not.toHaveBeenCalled(); expect(media.submit).not.toHaveBeenCalled();
  });

  it('returns 202 for pending and 200 for completed original requests', async () => {
    await post('/requests').send({ ...input, quoteId: 'quote-1', clientRequestId: 'client-1' }).expect(202);
    media.submit.mockResolvedValue({ mock: false, status: 'SUCCEEDED' });
    await post('/requests').send({ ...input, quoteId: 'quote-1', clientRequestId: 'client-1' }).expect(200);
  });

  it('applies the 10MiB upload cap and rejects additional multipart fields', async () => {
    await post('/references').attach('file', MEDIA_MOCK_PNG, { filename: 'reference.png', contentType: 'image/png' }).expect(201);
    expect(media.reference).toHaveBeenCalledWith(videoClaims, expect.objectContaining({ mimetype: 'image/png', buffer: MEDIA_MOCK_PNG }), expect.anything());
    media.reference.mockClear();
    await post('/references').attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), 'large.png').expect(413);
    await post('/references').field('supplier', 'not-accepted').attach('file', MEDIA_MOCK_PNG, 'ref.png').expect(400);
    expect(media.reference).not.toHaveBeenCalled();
  });

  it('returns actual content hash and non-mock no-store headers', async () => {
    const response = await get('/requests/receipt-1/outputs/output-1/content').expect(200);
    expect(response.headers).toMatchObject({ 'content-type': 'video/mp4', 'x-sha256': outputMetadata.sha256,
      'content-length': String(videoBytes.length), 'x-sep-media-mock': 'false', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  });

  it('rejects unsupported cancellation and invalid IDs before reaching the service', async () => {
    await post('/requests/receipt-1/cancel').send({}).expect(409);
    expect(media.cancel).toHaveBeenCalledWith(videoClaims, 'receipt-1');
    await get('/requests/not%20valid').expect(400);
    expect(media.receipt).not.toHaveBeenCalled();
  });
});
