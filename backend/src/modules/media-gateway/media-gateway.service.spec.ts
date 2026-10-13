import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import { MediaGatewayQuoteRequestSchema, MediaGatewayRequestSchema } from 'shared';
import type { MediaGatewayQuoteRequest } from 'shared';
import { MediaGatewayService } from './media-gateway.service';
import { MediaGatewayMockAdapter, MEDIA_MOCK_PNG } from './media-gateway-mock.adapter';

const claims: ClientEmploymentClaims = {
  sub: 'user-1', sid: 'session-1', enterpriseId: 'enterprise-1', subscriptionId: 'sub-1',
  memberId: 'member-1', type: 'client-employment', iat: 1, exp: 9999999999,
};
const referenceFile = () => ({ originalname: 'fixture.png', buffer: Buffer.from(MEDIA_MOCK_PNG), size: MEDIA_MOCK_PNG.length, mimetype: 'image/png' }) as Express.Multer.File;

describe('MediaGatewayService mock workflow', () => {
  let service: MediaGatewayService;
  let adapter: MediaGatewayMockAdapter;
  let config: ConfigService;
  let environment: Record<string, string | undefined>;
  const prisma = { enterpriseMember: { findFirst: jest.fn() }, subscription: { findFirst: jest.fn() } };

  beforeEach(() => {
    jest.restoreAllMocks();
    environment = { NODE_ENV: 'test', MEDIA_GATEWAY_MOCK_ENABLED: 'true' };
    config = { get: jest.fn((key: string) => environment[key]) } as unknown as ConfigService;
    prisma.enterpriseMember.findFirst.mockReset().mockResolvedValue({ departmentId: 'department-1' });
    prisma.subscription.findFirst.mockReset().mockResolvedValue({ id: 'sub-1' });
    adapter = new MediaGatewayMockAdapter();
    service = new MediaGatewayService(config, prisma as unknown as PrismaService, adapter);
  });
  afterEach(() => jest.restoreAllMocks());

  function payload(profileId = 'mock-sync', changes: Partial<MediaGatewayQuoteRequest> = {}) {
    return MediaGatewayQuoteRequestSchema.parse({ profileId, configVersion: 'mock-v1', operation: 'generate', creativeBrief: 'Test product', ...changes });
  }
  async function submit(profileId = 'mock-sync', changes: Partial<MediaGatewayQuoteRequest> = {}, id = 'request-1') {
    const input = payload(profileId, changes);
    const quote = await service.quote(claims, input);
    return service.submit(claims, MediaGatewayRequestSchema.parse({ ...input, quoteId: quote.quoteId, clientRequestId: id }));
  }
  async function error(promise: Promise<unknown>, status: number, code: string) {
    await expect(promise).rejects.toMatchObject({ response: { error: { code } }, status });
  }

  it.each([
    ['production', 'true'], ['test', 'false'], ['development', undefined], [undefined, 'true'], ['staging', 'true'],
  ])('fails closed for environment=%s enabled=%s', async (nodeEnv, enabled) => {
    environment.NODE_ENV = nodeEnv; environment.MEDIA_GATEWAY_MOCK_ENABLED = enabled;
    await error(service.profiles(claims), 503, 'MEDIA_MOCK_DISABLED');
    expect(prisma.enterpriseMember.findFirst).not.toHaveBeenCalled();
  });

  it('publishes only mock profiles and a static test image, independently of real media config', async () => {
    const profiles = await service.profiles(claims);
    expect(profiles).toMatchObject({ mock: true, persistence: 'process-memory', billingStatus: 'MOCK_NOT_CHARGED' });
    expect(profiles.profiles).toHaveLength(9);
    expect(Buffer.from(profiles.referenceFixtureBase64, 'base64')).toEqual(MEDIA_MOCK_PNG);
  });

  it('rechecks active user membership and subscription/member/department grant expiry', async () => {
    await service.profiles(claims);
    expect(prisma.enterpriseMember.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: 'member-1', enterpriseId: 'enterprise-1', userId: 'user-1', user: { status: 'ACTIVE' },
    } }));
    const where = prisma.subscription.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: 'sub-1', enterpriseId: 'enterprise-1', status: 'ACTIVE',
      grants: { some: { OR: [{ memberId: 'member-1' }, { departmentId: 'department-1' }] } },
    });
    expect(where.OR).toEqual([{ endDate: null }, { endDate: { gt: expect.any(Date) } }]);
    expect(where.grants.some.AND).toEqual([{ OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] }]);
  });

  it.each(['member', 'subscription'])('denies revoked %s before any adapter action', async (kind) => {
    if (kind === 'member') prisma.enterpriseMember.findFirst.mockResolvedValue(null);
    else prisma.subscription.findFirst.mockResolvedValue(null);
    const spy = jest.spyOn(adapter, 'submit');
    await error(service.quote(claims, payload()), 403, 'MEDIA_FORBIDDEN');
    expect(spy).not.toHaveBeenCalled();
  });

  it('validates fixture uploads without retaining user bytes or accepting extra fields', async () => {
    const ref = await service.uploadReference(claims, referenceFile());
    expect(ref).toMatchObject({ mock: true, width: 1, height: 1, byteLength: MEDIA_MOCK_PNG.length });
    await error(service.uploadReference(claims), 400, 'INVALID_REFERENCE');
    await error(service.uploadReference(claims, { ...referenceFile(), size: 100 }), 400, 'INVALID_REFERENCE');
    await error(service.uploadReference(claims, { ...referenceFile(), mimetype: 'image/jpeg' }), 400, 'INVALID_REFERENCE');
    const modified = Buffer.from(MEDIA_MOCK_PNG); modified[modified.length - 1] ^= 1;
    await error(service.uploadReference(claims, { ...referenceFile(), buffer: modified }), 400, 'INVALID_REFERENCE');
    await error(service.uploadReference(claims, referenceFile(), { enterpriseId: 'enterprise-2' }), 400, 'INVALID_REFERENCE');
  });

  it('supports edit with scoped reference and deterministic content-based quotes', async () => {
    const ref1 = await service.uploadReference(claims, referenceFile());
    const ref2 = await service.uploadReference(claims, referenceFile());
    const first = await service.quote(claims, payload('mock-sync', { operation: 'edit', referenceIds: [ref1.referenceId] }));
    const second = await service.quote(claims, payload('mock-sync', { operation: 'edit', referenceIds: [ref2.referenceId] }));
    expect(first.quoteId).not.toBe(second.quoteId);
    expect(first.semanticSha256).toBe(second.semanticSha256);
  });

  it('rejects expired references for a new request', async () => {
    const ref = await service.uploadReference(claims, referenceFile());
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(ref.expiresAt));
    await error(service.quote(claims, payload('mock-sync', { operation: 'edit', referenceIds: [ref.referenceId] })), 410, 'REFERENCE_EXPIRED');
  });

  it.each([
    { enterpriseId: 'enterprise-2' }, { memberId: 'member-2' }, { subscriptionId: 'sub-2' }, { sub: 'user-2' },
  ])('isolates references/quotes/receipts/outputs from changed claims %j', async (change) => {
    const other = { ...claims, ...change };
    const ref = await service.uploadReference(claims, referenceFile());
    await error(service.quote(other, payload('mock-sync', { operation: 'edit', referenceIds: [ref.referenceId] })), 404, 'MEDIA_NOT_FOUND');
    const quote = await service.quote(claims, payload());
    await error(service.submit(other, MediaGatewayRequestSchema.parse({ ...payload(), quoteId: quote.quoteId, clientRequestId: 'other-id' })), 404, 'MEDIA_NOT_FOUND');
    const receipt = await submit();
    await error(service.receipt(other, receipt.receiptId), 404, 'MEDIA_NOT_FOUND');
    await error(service.content(other, receipt.receiptId, receipt.outputs[0].outputId), 404, 'MEDIA_NOT_FOUND');
    await error(service.cancel(other, receipt.receiptId), 404, 'MEDIA_NOT_FOUND');
  });

  it('does not use clientRequestId as authorization for another member of the same enterprise', async () => {
    const receipt = await submit();
    await error(service.findByClientId({ ...claims, memberId: 'member-2' }, receipt.clientRequestId), 404, 'MEDIA_NOT_FOUND');
    const quote = await service.quote({ ...claims, memberId: 'member-2' }, payload());
    await error(service.submit({ ...claims, memberId: 'member-2' }, MediaGatewayRequestSchema.parse({ ...payload(), quoteId: quote.quoteId, clientRequestId: receipt.clientRequestId })), 404, 'MEDIA_NOT_FOUND');
  });

  it('separates identical clientRequestIds across enterprises', async () => {
    const first = await submit();
    const other = { ...claims, enterpriseId: 'enterprise-2' };
    const quote = await service.quote(other, payload());
    const second = await service.submit(other, MediaGatewayRequestSchema.parse({ ...payload(), quoteId: quote.quoteId, clientRequestId: first.clientRequestId }));
    expect(second.receiptId).not.toBe(first.receiptId);
  });

  it('returns all synchronous outputs, verifies hashes, and never uses arbitrary URLs', async () => {
    const receipt = await submit('mock-sync', { parameters: { size: '1x1', count: 3 } });
    expect(receipt.status).toBe('SUCCEEDED'); expect(receipt.outputs).toHaveLength(3);
    expect(receipt.recovery).toEqual({ canQuery: false, canCancel: false, canDownload: true });
    for (const output of receipt.outputs) {
      const content = await service.content(claims, receipt.receiptId, output.outputId);
      expect(content.bytes).toEqual(MEDIA_MOCK_PNG);
      expect(content.output.sha256).toBe(output.sha256);
    }
    await error(service.content(claims, receipt.receiptId, 'missing'), 404, 'MEDIA_NOT_FOUND');
  });

  it('freezes output count even after original quote expiry and cleanup', async () => {
    const receipt = await submit('mock-async', { parameters: { size: '1x1', count: 4 } });
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    await service.quote(claims, payload());
    expect((await service.findByClientId(claims, receipt.clientRequestId)).status).toBe('QUEUED');
    expect((await service.receipt(claims, receipt.receiptId)).status).toBe('RUNNING');
    const completed = await service.receipt(claims, receipt.receiptId);
    expect(completed.status).toBe('SUCCEEDED'); expect(completed.outputs).toHaveLength(4);
  });

  it('serializes concurrent queries for the same receipt', async () => {
    const receipt = await submit('mock-async');
    const spy = jest.spyOn(adapter, 'query');
    const responses = await Promise.all(Array.from({ length: 8 }, () => service.receipt(claims, receipt.receiptId)));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(responses.every((item) => item.status === 'RUNNING')).toBe(true);
  });

  it('returns original pending receipt during concurrent submissions and invokes adapter once', async () => {
    const dto = payload('mock-async'); const quote = await service.quote(claims, dto);
    const request = MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'concurrent' });
    let release!: (value: 'QUEUED') => void;
    const spy = jest.spyOn(adapter, 'submit').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const first = service.submit(claims, request);
    await new Promise((resolve) => setImmediate(resolve));
    const replays = await Promise.all(Array.from({ length: 12 }, () => service.submit(claims, request)));
    expect(replays.every((item) => item.status === 'SUBMITTING')).toBe(true);
    expect(new Set(replays.map((item) => item.receiptId)).size).toBe(1);
    release('QUEUED');
    expect((await first).receiptId).toBe(replays[0].receiptId);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not advertise or accept cancellation before the adapter accepts submission', async () => {
    const dto = payload('mock-async'); const quote = await service.quote(claims, dto);
    const request = MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'submitting-cancel' });
    let release!: (value: 'QUEUED') => void;
    const spy = jest.spyOn(adapter, 'submit').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const first = service.submit(claims, request);
    await new Promise((resolve) => setImmediate(resolve));
    try {
      const pending = await service.findByClientId(claims, request.clientRequestId);
      expect(pending).toMatchObject({ status: 'SUBMITTING', recovery: { canCancel: false } });
      expect(await service.submit(claims, request)).toMatchObject({ recovery: { canCancel: false } });
      await error(service.cancel(claims, pending.receiptId), 409, 'CANCEL_UNSUPPORTED');
    } finally {
      release('QUEUED');
      await first;
    }
    const accepted = await service.findByClientId(claims, request.clientRequestId);
    expect(accepted).toMatchObject({ status: 'QUEUED', recovery: { canCancel: true } });
    expect(await service.cancel(claims, accepted.receiptId)).toMatchObject({ status: 'CANCELLED' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('replays original request after quote/reference expiry without revalidating stale inputs', async () => {
    const ref = await service.uploadReference(claims, referenceFile());
    const dto = payload('mock-sync', { operation: 'edit', referenceIds: [ref.referenceId] });
    const quote = await service.quote(claims, dto);
    const request = MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'replay' });
    const spy = jest.spyOn(adapter, 'submit');
    const first = await service.submit(claims, request);
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(ref.expiresAt) + 1);
    await service.uploadReference(claims, referenceFile());
    const replay = await service.submit(claims, { ...request, quoteId: 'expired-or-missing-quote' });
    expect(replay.receiptId).toBe(first.receiptId); expect(spy).toHaveBeenCalledTimes(1);
  });

  it('replays with a reuploaded same-content reference and refreshed quote', async () => {
    const ref1 = await service.uploadReference(claims, referenceFile());
    const dto1 = payload('mock-sync', { operation: 'edit', referenceIds: [ref1.referenceId] });
    const quote1 = await service.quote(claims, dto1);
    const spy = jest.spyOn(adapter, 'submit');
    const first = await service.submit(claims, MediaGatewayRequestSchema.parse({ ...dto1, quoteId: quote1.quoteId, clientRequestId: 'stable' }));
    const ref2 = await service.uploadReference(claims, referenceFile());
    const dto2 = payload('mock-sync', { operation: 'edit', referenceIds: [ref2.referenceId] });
    const quote2 = await service.quote(claims, dto2);
    const second = await service.submit(claims, MediaGatewayRequestSchema.parse({ ...dto2, quoteId: quote2.quoteId, clientRequestId: 'stable' }));
    expect(second.receiptId).toBe(first.receiptId); expect(spy).toHaveBeenCalledTimes(1);
  });

  it('rejects same-ID semantic changes and quote-content mismatch before forwarding', async () => {
    await submit();
    const dto = payload('mock-sync', { creativeBrief: 'different' }); const quote = await service.quote(claims, dto);
    const spy = jest.spyOn(adapter, 'submit');
    await error(service.submit(claims, MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'request-1' })), 409, 'IDEMPOTENCY_CONFLICT');
    await error(service.submit(claims, MediaGatewayRequestSchema.parse({ ...payload(), quoteId: quote.quoteId, clientRequestId: 'request-2' })), 409, 'IDEMPOTENCY_CONFLICT');
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects expired quotes, unknown prices, stale configuration, and simulated insufficient budget', async () => {
    const dto = payload(); const quote = await service.quote(claims, dto);
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(quote.expiresAt));
    await error(service.submit(claims, MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'expired' })), 409, 'QUOTE_EXPIRED');
    jest.restoreAllMocks();
    const unknown = await service.quote(claims, payload('mock-no-price'));
    expect(unknown).toMatchObject({ pricingStatus: 'unavailable', amountCny: null });
    await error(submit('mock-no-price'), 409, 'PRICE_UNAVAILABLE');
    await error(submit('mock-budget'), 403, 'BUDGET_EXCEEDED');
    await error(service.quote(claims, payload('mock-sync', { configVersion: 'old' })), 409, 'CONFIG_CHANGED');
    await error(service.quote(claims, payload('real-model')), 422, 'UNSUPPORTED_MEDIA_PARAMETERS');
  });

  it('keeps submission ambiguous after an adapter failure and never resends', async () => {
    const spy = jest.spyOn(adapter, 'submit').mockRejectedValue(new Error('private upstream key'));
    const first = await submit('mock-async');
    expect(first).toMatchObject({ status: 'SUBMISSION_UNKNOWN', errorCode: 'SUBMISSION_UNKNOWN', pollAfterMs: null,
      recovery: { canQuery: false, canCancel: false, canDownload: false } });
    const second = await submit('mock-async');
    expect(second.receiptId).toBe(first.receiptId); expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(second)).not.toContain('private upstream key');
  });

  it('does not query or resend a synchronous submission-unknown scenario', async () => {
    const receipt = await submit('mock-unknown'); const spy = jest.spyOn(adapter, 'query');
    expect((await service.receipt(claims, receipt.receiptId)).status).toBe('SUBMISSION_UNKNOWN');
    expect(spy).not.toHaveBeenCalled();
    await error(service.content(claims, receipt.receiptId, 'missing'), 404, 'MEDIA_NOT_FOUND');
    await error(service.cancel(claims, receipt.receiptId), 409, 'CANCEL_UNSUPPORTED');
  });

  it('reports partial success and failed output without dropping successful images', async () => {
    const receipt = await submit('mock-partial', { parameters: { size: '1x1', count: 3 } });
    await service.receipt(claims, receipt.receiptId);
    const result = await service.receipt(claims, receipt.receiptId);
    expect(result.status).toBe('PARTIAL_SUCCEEDED'); expect(result.outputs).toHaveLength(2);
    expect(result.outputErrors).toEqual([{ index: 2, code: 'OUTPUT_FAILED' }]);
    expect(result.billingStatus).toBe('MOCK_NOT_CHARGED');
    expect(result).toMatchObject({ pollAfterMs: null, recovery: { canQuery: false, canCancel: false, canDownload: true } });
    await error(service.cancel(claims, receipt.receiptId), 409, 'CANCEL_UNSUPPORTED');
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(result.outputs[0].expiresAt));
    expect(await service.receipt(claims, receipt.receiptId)).toMatchObject({ status: 'RESULT_EXPIRED', pollAfterMs: null,
      recovery: { canQuery: false, canCancel: false, canDownload: false } });
  });

  it('reports all-failed partial and upstream-failed cases truthfully', async () => {
    for (const profile of ['mock-partial', 'mock-failed']) {
      const receipt = await submit(profile, {}, profile);
      await service.receipt(claims, receipt.receiptId);
      expect(await service.receipt(claims, receipt.receiptId)).toMatchObject({ status: 'FAILED', pollAfterMs: null,
        recovery: { canQuery: false, canCancel: false, canDownload: false } });
    }
  });

  it('keeps original pending status on query failure and permits bounded client retry', async () => {
    const receipt = await submit('mock-async');
    const spy = jest.spyOn(adapter, 'query').mockRejectedValueOnce(new HttpException('private', 502));
    await error(service.receipt(claims, receipt.receiptId), 503, 'MEDIA_RATE_LIMITED');
    expect((await service.findByClientId(claims, receipt.clientRequestId)).status).toBe('QUEUED');
    spy.mockRestore();
    expect((await service.receipt(claims, receipt.receiptId)).status).toBe('RUNNING');
  });

  it('cancels pending async work, replays cancellation, and never progresses it', async () => {
    const receipt = await submit('mock-async');
    const cancelled = await service.cancel(claims, receipt.receiptId);
    expect(cancelled).toMatchObject({ status: 'CANCELLED', billingStatus: 'MOCK_NOT_CHARGED', pollAfterMs: null,
      recovery: { canQuery: false, canCancel: false, canDownload: false } });
    expect((await service.cancel(claims, receipt.receiptId)).status).toBe('CANCELLED');
    const spy = jest.spyOn(adapter, 'query');
    expect((await service.receipt(claims, receipt.receiptId)).status).toBe('CANCELLED');
    expect(spy).not.toHaveBeenCalled();
    const unsupported = await submit('mock-no-cancel', {}, 'unsupported');
    await error(service.cancel(claims, unsupported.receiptId), 409, 'CANCEL_UNSUPPORTED');
  });

  it.each(['RUNNING', 'SUCCEEDED'] as const)('waits for an in-flight query before cancellation when it returns %s', async (status) => {
    const receipt = await submit('mock-async');
    let release!: (value: typeof status) => void;
    const spy = jest.spyOn(adapter, 'query').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const query = service.receipt(claims, receipt.receiptId);
    await new Promise((resolve) => setImmediate(resolve));
    let settled = false;
    const cancellation = service.cancel(claims, receipt.receiptId).then((value) => { settled = true; return value; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    release(status);
    await query;
    const result = await cancellation;
    expect(result.status).toBe(status === 'RUNNING' ? 'CANCELLED' : 'SUCCEEDED');
    expect(result.outputs).toHaveLength(status === 'SUCCEEDED' ? 1 : 0);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns real expiry and never regenerates expired content', async () => {
    const spy = jest.spyOn(adapter, 'submit'); const receipt = await submit('mock-expired');
    expect(receipt.status).toBe('RESULT_EXPIRED');
    await error(service.content(claims, receipt.receiptId, receipt.outputs[0].outputId), 410, 'RESULT_EXPIRED');
    expect((await service.findByClientId(claims, receipt.clientRequestId)).status).toBe('RESULT_EXPIRED');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('rechecks authorization for recovery/download and does not mutate data on denial', async () => {
    const receipt = await submit(); prisma.subscription.findFirst.mockResolvedValue(null);
    await error(service.findByClientId(claims, receipt.clientRequestId), 403, 'MEDIA_FORBIDDEN');
    await error(service.content(claims, receipt.receiptId, receipt.outputs[0].outputId), 403, 'MEDIA_FORBIDDEN');
    prisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1' });
    expect((await service.findByClientId(claims, receipt.clientRequestId)).status).toBe('SUCCEEDED');
  });

  it('bounds memory and retains completed request IDs rather than evicting to permit retries', async () => {
    const quote = await service.quote(claims, payload());
    for (let i = 0; i < 1000; i++) {
      await service.submit(claims, MediaGatewayRequestSchema.parse({ ...payload(), quoteId: quote.quoteId, clientRequestId: `cap-${i}` }));
    }
    await error(service.submit(claims, MediaGatewayRequestSchema.parse({ ...payload(), quoteId: quote.quoteId, clientRequestId: 'cap-new' })), 429, 'MEDIA_RATE_LIMITED');
    expect((await service.submit(claims, MediaGatewayRequestSchema.parse({ ...payload(), quoteId: quote.quoteId, clientRequestId: 'cap-0' }))).status).toBe('SUCCEEDED');
  });

  it('discloses process-local persistence instead of pretending restart recovery is durable', async () => {
    await submit(); const restarted = new MediaGatewayService(config, prisma as unknown as PrismaService, adapter);
    await error(restarted.findByClientId(claims, 'request-1'), 404, 'MEDIA_NOT_FOUND');
  });
});
