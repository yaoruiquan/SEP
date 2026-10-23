import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { MediaGatewayMemoryStore } from '../../../test/helpers/media-gateway-memory-store';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import { MediaGatewayQuoteRequestSchema, MediaGatewayRequestSchema } from 'shared';
import type { MediaGatewayQuoteRequest } from 'shared';
import { MediaGatewayService } from './media-gateway.service';
import { MediaGatewayMockAdapter, MEDIA_MOCK_PNG } from './media-gateway-mock.adapter';
import { mediaStorageUnavailable } from './media-gateway.store';
import type { MediaGatewayStore, RequestClaim } from './media-gateway.store';

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
  let store: MediaGatewayMemoryStore;
  const prisma = { enterpriseMember: { findFirst: jest.fn() }, subscription: { findFirst: jest.fn() } };

  beforeEach(() => {
    jest.restoreAllMocks();
    environment = { NODE_ENV: 'test', MEDIA_GATEWAY_MOCK_ENABLED: 'true' };
    config = { get: jest.fn((key: string) => environment[key]) } as unknown as ConfigService;
    prisma.enterpriseMember.findFirst.mockReset().mockResolvedValue({ departmentId: 'department-1' });
    prisma.subscription.findFirst.mockReset().mockResolvedValue({ id: 'sub-1' });
    adapter = new MediaGatewayMockAdapter();
    store = new MediaGatewayMemoryStore();
    service = instance(store);
  });
  afterEach(() => jest.restoreAllMocks());

  function instance(sharedStore = new MediaGatewayMemoryStore(store.state), instanceAdapter = adapter) {
    return new MediaGatewayService(config, prisma as unknown as PrismaService, instanceAdapter, sharedStore as unknown as MediaGatewayStore);
  }

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
    expect(profiles).toMatchObject({ mock: true, persistence: 'database', billingStatus: 'MOCK_NOT_CHARGED' });
    expect(profiles.profiles).toHaveLength(9);
    expect(Buffer.from(profiles.referenceFixtureBase64, 'base64')).toEqual(MEDIA_MOCK_PNG);
  });

  it('rechecks active user membership and subscription/member/department grant expiry', async () => {
    await service.profiles(claims);
    expect(prisma.enterpriseMember.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: 'member-1', enterpriseId: 'enterprise-1', userId: 'user-1', user: { status: 'ACTIVE' }, enterprise: { status: 'ACTIVE' },
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

  it.each(['enterpriseMember', 'subscription'] as const)('maps %s authorization query failures to storage 503 before claiming', async (kind) => {
    const dto = payload(); const quote = await service.quote(claims, dto);
    const input = MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'authorization-db-failure' });
    const spy = jest.spyOn(adapter, 'submit');
    prisma[kind].findFirst.mockRejectedValueOnce(new Error('private database detail'));
    await error(service.submit(claims, input), 503, 'MEDIA_STORAGE_UNAVAILABLE');
    expect(store.state.requests.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(['subscription expiry', 'grant expiry', 'member revocation', 'grant revocation'])('blocks dispatch after claim-delayed %s and retains the failed ID', async (change) => {
    const start = Date.now();
    jest.useFakeTimers({ now: start });
    try {
      if (change.endsWith('expiry')) {
        const expiresAt = start + 500;
        prisma.subscription.findFirst.mockImplementation(async ({ where }) => {
          const checkedAt = change === 'subscription expiry'
            ? where.OR[1].endDate.gt : where.grants.some.AND[0].OR[1].expiresAt.gt;
          return checkedAt.getTime() < expiresAt ? { id: 'sub-1' } : null;
        });
      }
      const dto = payload('mock-async'); const quote = await service.quote(claims, dto);
      const input = MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'delayed-authorization' });
      const spy = jest.spyOn(adapter, 'submit');
      const originalClaim = store.claim.bind(store);
      jest.spyOn(store, 'claim').mockImplementationOnce(async (claim) => {
        const result = await originalClaim(claim);
        jest.setSystemTime(start + 1000);
        if (change === 'member revocation') prisma.enterpriseMember.findFirst.mockResolvedValue(null);
        if (change === 'grant revocation') prisma.subscription.findFirst.mockResolvedValue(null);
        return result;
      });
      await error(service.submit(claims, input), 403, 'MEDIA_FORBIDDEN');
      const saved = (await store.findByClientId(claims.enterpriseId, input.clientRequestId))!;
      expect(saved.receipt).toMatchObject({ status: 'FAILED', errorCode: 'MEDIA_FORBIDDEN', pollAfterMs: null,
        outputs: [], recovery: { canQuery: false, canCancel: false, canDownload: false } });
      prisma.enterpriseMember.findFirst.mockResolvedValue({ departmentId: 'department-1' });
      prisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1' });
      expect(await instance().submit(claims, input)).toEqual(saved.receipt);
      expect(store.state.requests.size).toBe(1);
      expect(spy).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
  });

  it.each(['enterpriseMember', 'subscription'] as const)('retains a failed claim when the pre-dispatch %s query fails', async (kind) => {
    const dto = payload('mock-async'); const quote = await service.quote(claims, dto);
    const input = MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'claimed-authorization-db-failure' });
    const spy = jest.spyOn(adapter, 'submit');
    const originalClaim = store.claim.bind(store);
    jest.spyOn(store, 'claim').mockImplementationOnce(async (claim) => {
      const result = await originalClaim(claim);
      prisma[kind].findFirst.mockRejectedValueOnce(new Error('private database detail'));
      return result;
    });
    await error(service.submit(claims, input), 503, 'MEDIA_STORAGE_UNAVAILABLE');
    const saved = (await store.findByClientId(claims.enterpriseId, input.clientRequestId))!;
    expect(saved.receipt).toMatchObject({ status: 'FAILED', errorCode: 'MEDIA_STORAGE_UNAVAILABLE', pollAfterMs: null,
      recovery: { canQuery: false, canCancel: false, canDownload: false } });
    expect(await instance().submit(claims, input)).toEqual(saved.receipt);
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps the claim recoverable if persisting a pre-dispatch rejection fails', async () => {
    const dto = payload('mock-async'); const quote = await service.quote(claims, dto);
    const input = MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'rejection-save-failure' });
    const spy = jest.spyOn(adapter, 'submit');
    const originalClaim = store.claim.bind(store);
    jest.spyOn(store, 'claim').mockImplementationOnce(async (claim) => {
      const result = await originalClaim(claim);
      prisma.subscription.findFirst.mockResolvedValueOnce(null);
      return result;
    });
    jest.spyOn(store, 'save').mockImplementationOnce(async () => mediaStorageUnavailable());
    await error(service.submit(claims, input), 503, 'MEDIA_STORAGE_UNAVAILABLE');
    const saved = (await store.findByClientId(claims.enterpriseId, input.clientRequestId))!;
    expect(saved.receipt.status).toBe('SUBMITTING');
    expect((await instance().submit(claims, input)).receiptId).toBe(saved.receipt.receiptId);
    jest.spyOn(Date, 'now').mockReturnValue(saved.submissionDeadline.getTime() + 1);
    expect((await instance().submit(claims, input)).status).toBe('SUBMISSION_UNKNOWN');
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

  describe('existing jobs after live authorization loss', () => {
    const losses = ['subscription expiry', 'grant expiry', 'member disabled', 'grant revocation', 'department reassignment'] as const;
    type AccessLoss = typeof losses[number];
    const start = Date.parse('2026-10-14T00:00:00.000Z');

    beforeEach(() => jest.useFakeTimers({ now: start }));
    afterEach(() => jest.useRealTimers());

    function accessFixture(loss: AccessLoss) {
      const access = { activeUser: true, grantPresent: true, departmentId: 'department-1' };
      const expiresAt = start + 1000;
      prisma.enterpriseMember.findFirst.mockImplementation(async ({ where }) => {
        expect(where).toEqual({ id: claims.memberId, enterpriseId: claims.enterpriseId,
          userId: claims.sub, user: { status: 'ACTIVE' }, enterprise: { status: 'ACTIVE' } });
        return access.activeUser ? { departmentId: access.departmentId } : null;
      });
      prisma.subscription.findFirst.mockImplementation(async ({ where }) => {
        expect(where).toMatchObject({ id: claims.subscriptionId, enterpriseId: claims.enterpriseId, status: 'ACTIVE' });
        expect(where.OR).toEqual([{ endDate: null }, { endDate: { gt: new Date(Date.now()) } }]);
        expect(where.grants.some.AND).toEqual([{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(Date.now()) } }] }]);
        expect(where.grants.some.OR).toEqual([{ memberId: claims.memberId }, { departmentId: access.departmentId }]);
        if (loss === 'subscription expiry' && where.OR[1].endDate.gt.getTime() >= expiresAt) return null;
        if (loss === 'grant expiry' && where.grants.some.AND[0].OR[1].expiresAt.gt.getTime() >= expiresAt) return null;
        if (!access.grantPresent) return null;
        if (loss === 'department reassignment' && !where.grants.some.OR.some(
          (grant: { departmentId?: string }) => grant.departmentId === 'department-1',
        )) return null;
        return { id: claims.subscriptionId };
      });
      return () => {
        jest.setSystemTime(expiresAt);
        if (loss === 'member disabled') access.activeUser = false;
        if (loss === 'grant revocation') access.grantPresent = false;
        if (loss === 'department reassignment') access.departmentId = 'department-2';
      };
    }

    function observeEffects() {
      const snapshot = () => ({ references: Array.from(store.state.references.entries()),
        quotes: Array.from(store.state.quotes.entries()), requests: Array.from(store.state.requests.entries()),
        clientIds: Array.from(store.state.clientIds.entries()) });
      const state = structuredClone(snapshot());
      const writes = [jest.spyOn(store, 'saveReference'), jest.spyOn(store, 'saveQuote'),
        jest.spyOn(store, 'claim'), jest.spyOn(store, 'save')];
      const reads = [jest.spyOn(store, 'findReference'), jest.spyOn(store, 'findQuote'),
        jest.spyOn(store, 'findRequest'), jest.spyOn(store, 'findByClientId')];
      const dispatch = jest.spyOn(adapter, 'submit');
      const query = jest.spyOn(adapter, 'query');
      return () => {
        for (const spy of [...reads, ...writes, dispatch, query]) expect(spy).not.toHaveBeenCalled();
        expect(snapshot()).toEqual(state);
      };
    }

    it.each(losses.flatMap((loss) => ['SUCCEEDED', 'QUEUED', 'RUNNING'].map((status) => ({ loss, status }))))(
      'denies old $status jobs, downloads, quotes and submissions after $loss without store/provider effects',
      async ({ loss, status }) => {
        const loseAccess = accessFixture(loss);
        const ref = await service.uploadReference(claims, referenceFile());
        const dto = payload(status === 'SUCCEEDED' ? 'mock-sync' : 'mock-async', {
          operation: 'edit', referenceIds: [ref.referenceId],
        });
        const quote = await service.quote(claims, dto);
        const input = MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'original-job' });
        let original = await service.submit(claims, input);
        if (status === 'RUNNING') original = await service.receipt(claims, original.receiptId);
        expect(original.status).toBe(status);
        const downloadable = status === 'SUCCEEDED' ? original : await submit('mock-sync', {}, 'downloadable-job');
        const freshQuote = await service.quote(claims, dto);
        const freshInput = MediaGatewayRequestSchema.parse({ ...dto, quoteId: freshQuote.quoteId, clientRequestId: 'new-job' });
        const assertNoEffects = observeEffects();
        loseAccess();

        const operations = [
          () => service.findByClientId(claims, original.clientRequestId),
          () => service.receipt(claims, original.receiptId),
          () => service.content(claims, downloadable.receiptId, downloadable.outputs[0].outputId),
          () => service.quote(claims, dto),
          () => service.submit(claims, input),
          () => service.submit(claims, freshInput),
          () => service.cancel(claims, original.receiptId),
        ];
        for (const operation of operations) {
          prisma.enterpriseMember.findFirst.mockClear();
          prisma.subscription.findFirst.mockClear();
          await error(operation(), 403, 'MEDIA_FORBIDDEN');
          expect(prisma.enterpriseMember.findFirst).toHaveBeenCalledTimes(1);
          expect(prisma.subscription.findFirst).toHaveBeenCalledTimes(loss === 'member disabled' ? 0 : 1);
          assertNoEffects();
        }

        prisma.enterpriseMember.findFirst.mockResolvedValue({ departmentId: 'department-1' });
        prisma.subscription.findFirst.mockResolvedValue({ id: claims.subscriptionId });
        const restarted = instance();
        expect(await restarted.findByClientId(claims, original.clientRequestId)).toEqual(original);
        expect(await restarted.submit(claims, input)).toEqual(original);
        expect((await restarted.content(claims, downloadable.receiptId, downloadable.outputs[0].outputId)).bytes).toEqual(MEDIA_MOCK_PNG);
        assertNoEffects();
      },
    );

    it.each(losses)('does not recover or mutate an overdue SUBMITTING job after %s', async (loss) => {
      const loseAccess = accessFixture(loss);
      const dto = payload('mock-async');
      const quote = await service.quote(claims, dto);
      const input = MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'unacknowledged-job' });
      const originalClaim = store.claim.bind(store);
      jest.spyOn(store, 'claim').mockImplementationOnce(async (claim) => {
        await originalClaim(claim);
        mediaStorageUnavailable();
      });
      const dispatch = jest.spyOn(adapter, 'submit');
      await error(service.submit(claims, input), 503, 'MEDIA_STORAGE_UNAVAILABLE');
      expect(dispatch).not.toHaveBeenCalled();
      const pending = (await store.findByClientId(claims.enterpriseId, input.clientRequestId))!;
      expect(pending.receipt.status).toBe('SUBMITTING');
      jest.mocked(store.claim).mockClear();
      const assertNoEffects = observeEffects();
      loseAccess();
      jest.setSystemTime(pending.submissionDeadline.getTime());

      for (const operation of [
        () => service.findByClientId(claims, input.clientRequestId),
        () => service.receipt(claims, pending.receipt.receiptId),
        () => service.submit(claims, input),
      ]) {
        await error(operation(), 403, 'MEDIA_FORBIDDEN');
        assertNoEffects();
      }

      prisma.enterpriseMember.findFirst.mockResolvedValue({ departmentId: 'department-1' });
      prisma.subscription.findFirst.mockResolvedValue({ id: claims.subscriptionId });
      expect(await instance().findByClientId(claims, input.clientRequestId)).toMatchObject({
        receiptId: pending.receipt.receiptId, status: 'SUBMISSION_UNKNOWN', errorCode: 'SUBMISSION_UNKNOWN',
      });
      expect(dispatch).not.toHaveBeenCalled();
      expect(store.state.requests.size).toBe(1);
    });
  });

  it('retains idempotency keys beyond 1000 requests without eviction or a process-local cap', async () => {
    const quote = await service.quote(claims, payload());
    const spy = jest.spyOn(adapter, 'submit');
    for (let i = 0; i < 1002; i++) {
      await service.submit(claims, MediaGatewayRequestSchema.parse({ ...payload(), quoteId: quote.quoteId, clientRequestId: `cap-${i}` }));
    }
    const restarted = instance();
    expect((await restarted.submit(claims, MediaGatewayRequestSchema.parse({ ...payload(), quoteId: quote.quoteId, clientRequestId: 'cap-0' }))).status).toBe('SUCCEEDED');
    expect(store.state.requests.size).toBe(1002);
    expect(spy).toHaveBeenCalledTimes(1002);
  });

  it('recovers receipts and downloads through a new service and store sharing persisted state', async () => {
    const original = await submit();
    const restarted = instance(undefined, new MediaGatewayMockAdapter());
    const recovered = await restarted.findByClientId(claims, original.clientRequestId);
    expect(recovered).toEqual(original);
    expect(await restarted.receipt(claims, recovered.receiptId)).toEqual(original);
    const content = await restarted.content(claims, recovered.receiptId, recovered.outputs[0].outputId);
    expect(content.bytes).toEqual(MEDIA_MOCK_PNG);
    expect(content.output.sha256).toBe(createHash('sha256').update(content.bytes).digest('hex'));
  });

  it('shares references and quotes across instances and resumes async work with a fresh adapter', async () => {
    const ref = await service.uploadReference(claims, referenceFile());
    const dto = payload('mock-async', { operation: 'edit', referenceIds: [ref.referenceId], parameters: { size: '1x1', count: 2 } });
    const second = instance();
    const quote = await second.quote(claims, dto);
    const receipt = await instance().submit(claims, MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'shared-edit' }));
    const restarted = instance(undefined, new MediaGatewayMockAdapter());
    expect((await restarted.receipt(claims, receipt.receiptId)).status).toBe('RUNNING');
    const completed = await restarted.receipt(claims, receipt.receiptId);
    expect(completed).toMatchObject({ status: 'SUCCEEDED' });
    expect(completed.outputs).toHaveLength(2);
  });

  it('uses an atomic shared claim for simultaneous submissions from different service instances', async () => {
    const dto = payload('mock-async');
    const quote = await service.quote(claims, dto);
    const input = MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'cross-instance' });
    let release!: (value: 'QUEUED') => void;
    const spy = jest.spyOn(adapter, 'submit').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const submissions = [service, instance()].map((current) => current.submit(claims, input));
    await new Promise((resolve) => setImmediate(resolve));
    try {
      expect(spy).toHaveBeenCalledTimes(1);
      expect((await instance().findByClientId(claims, input.clientRequestId)).status).toBe('SUBMITTING');
    } finally { release('QUEUED'); }
    const receipts = await Promise.all(submissions);
    expect(new Set(receipts.map((item) => item.receiptId)).size).toBe(1);
    expect(store.state.requests.size).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each(['RUNNING', 'SUCCEEDED'] as const)('does not let a stale cross-instance %s query overwrite cancellation', async (status) => {
    const receipt = await submit('mock-async');
    let release!: (value: typeof status) => void;
    jest.spyOn(adapter, 'query').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const query = service.receipt(claims, receipt.receiptId);
    await new Promise((resolve) => setImmediate(resolve));
    try {
      expect((await instance().cancel(claims, receipt.receiptId)).status).toBe('CANCELLED');
    } finally { release(status); }
    expect(await query).toMatchObject({ status: 'CANCELLED', outputs: [], recovery: { canDownload: false } });
    expect((await instance().findByClientId(claims, receipt.clientRequestId)).status).toBe('CANCELLED');
  });

  it('returns the winning terminal query when a cross-instance cancellation loses CAS', async () => {
    const receipt = await submit('mock-async');
    const cancellingStore = new MediaGatewayMemoryStore(store.state);
    const originalSave = cancellingStore.save.bind(cancellingStore);
    let release!: () => void;
    jest.spyOn(cancellingStore, 'save').mockImplementation(async (record) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return originalSave(record);
    });
    const cancellation = instance(cancellingStore).cancel(claims, receipt.receiptId);
    await new Promise((resolve) => setImmediate(resolve));
    try {
      jest.spyOn(adapter, 'query').mockResolvedValue('SUCCEEDED');
      expect((await service.receipt(claims, receipt.receiptId)).status).toBe('SUCCEEDED');
    } finally { release(); }
    expect(await cancellation).toMatchObject({ status: 'SUCCEEDED', recovery: { canDownload: true } });
    expect((await instance().findByClientId(claims, receipt.clientRequestId)).status).toBe('SUCCEEDED');
  });

  it('keeps configuration and semantic hashes frozen without storing the creative prompt', async () => {
    const creativeBrief = 'private prompt that must never enter persisted metadata';
    const ref = await service.uploadReference(claims, referenceFile());
    const dto = payload('mock-async', { creativeBrief, operation: 'edit', referenceIds: [ref.referenceId], parameters: { size: '1x1', count: 3 } });
    const quote = await service.quote(claims, dto);
    const receipt = await service.submit(claims, MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'frozen' }));
    const original = await store.findRequest(receipt.receiptId);
    expect(original).toMatchObject({
      semanticSha256: quote.semanticSha256, referenceIds: [ref.referenceId], referenceHashes: [ref.sha256], count: 3,
      configuration: { adapter: 'static-png-v1', profileId: 'mock-async', configVersion: 'mock-v1', operation: 'edit',
        parameters: { size: '1x1', count: 3 }, pricingVersion: quote.pricingVersion, amountCny: quote.amountCny },
    });
    expect(original?.semanticSha256).toBe(createHash('sha256').update(JSON.stringify({
      profileId: dto.profileId, configVersion: dto.configVersion, operation: dto.operation,
      creativeBrief, parameters: dto.parameters, references: [ref.sha256],
    })).digest('hex'));
    dto.creativeBrief = 'changed locally'; dto.parameters.count = 1;
    await instance().receipt(claims, receipt.receiptId);
    await instance().receipt(claims, receipt.receiptId);
    const saved = await store.findRequest(receipt.receiptId);
    expect(saved?.configuration).toEqual(original?.configuration);
    expect(saved?.semanticSha256).toBe(original?.semanticSha256);
    expect(saved?.receipt.outputs).toHaveLength(3);
    const serialized = JSON.stringify([Array.from(store.state.requests.values()), Array.from(store.state.quotes.values()), Array.from(store.state.references.values())]);
    expect(serialized).not.toContain(creativeBrief);
    expect(serialized).not.toContain('creativeBrief');
    expect(serialized).not.toMatch(/"prompt"|"buffer"/);
  });

  it('isolates persisted JSON from mutated response and store-read objects', async () => {
    const receipt = await submit();
    const original = structuredClone(receipt);
    receipt.outputs.length = 0;
    receipt.recovery.canDownload = false;
    const record = (await store.findRequest(receipt.receiptId))!;
    record.receipt.outputs[0].sha256 = 'mutated';
    record.configuration.parameters.count = 4;
    expect(await instance().findByClientId(claims, receipt.clientRequestId)).toEqual(original);
    expect((await store.findRequest(receipt.receiptId))?.configuration.parameters.count).toBe(1);
  });

  it('surfaces storage lookup failure without falling back to a process-local submission', async () => {
    const dto = payload(); const quote = await service.quote(claims, dto);
    const input = MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'lookup-failure' });
    const spy = jest.spyOn(adapter, 'submit');
    jest.spyOn(store, 'findByClientId').mockImplementationOnce(async () => mediaStorageUnavailable());
    await error(service.submit(claims, input), 503, 'MEDIA_STORAGE_UNAVAILABLE');
    expect(spy).not.toHaveBeenCalled();
    expect(store.state.requests.size).toBe(0);
  });

  it('does not submit when claim fails before any acknowledged insert', async () => {
    const dto = payload(); const quote = await service.quote(claims, dto);
    const input = MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'claim-failure' });
    const spy = jest.spyOn(adapter, 'submit');
    jest.spyOn(store, 'claim').mockImplementationOnce(async () => mediaStorageUnavailable());
    await error(service.submit(claims, input), 503, 'MEDIA_STORAGE_UNAVAILABLE');
    expect(spy).not.toHaveBeenCalled();
    expect(store.state.requests.size).toBe(0);
  });

  it.each(['findByClientId', 'receipt'] as const)('persists UNKNOWN on %s after an unacknowledged claim expires and never resubmits', async (read) => {
    const dto = payload('mock-async'); const quote = await service.quote(claims, dto);
    const input = MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'claim-timeout' });
    const spy = jest.spyOn(adapter, 'submit');
    const originalClaim = store.claim.bind(store);
    jest.spyOn(store, 'claim').mockImplementationOnce(async (claim: RequestClaim) => {
      await originalClaim(claim);
      mediaStorageUnavailable();
    });
    await error(service.submit(claims, input), 503, 'MEDIA_STORAGE_UNAVAILABLE');
    expect(spy).not.toHaveBeenCalled();
    const pending = (await store.findByClientId(claims.enterpriseId, input.clientRequestId))!;
    const restarted = instance();
    jest.spyOn(Date, 'now').mockReturnValue(pending.submissionDeadline.getTime() - 1);
    expect((await restarted.findByClientId(claims, input.clientRequestId)).status).toBe('SUBMITTING');
    jest.spyOn(Date, 'now').mockReturnValue(pending.submissionDeadline.getTime() + 1);
    const recovered = read === 'receipt'
      ? await restarted.receipt(claims, pending.receipt.receiptId)
      : await restarted.findByClientId(claims, input.clientRequestId);
    expect(recovered).toMatchObject({ status: 'SUBMISSION_UNKNOWN', errorCode: 'SUBMISSION_UNKNOWN', pollAfterMs: null,
      recovery: { canQuery: false, canCancel: false, canDownload: false } });
    const persisted = (await store.findRequest(recovered.receiptId))!;
    expect(persisted.receipt.status).toBe('SUBMISSION_UNKNOWN');
    expect(persisted.revision).toBeGreaterThan(pending.revision);
    expect(await restarted.submit(claims, input)).toEqual(recovered);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not dispatch an adapter after an acknowledged claim is delayed past the two-minute deadline', async () => {
    const dto = payload('mock-async'); const quote = await service.quote(claims, dto);
    const input = MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'delayed-claim' });
    const spy = jest.spyOn(adapter, 'submit');
    const originalClaim = store.claim.bind(store);
    const start = Date.now();
    jest.spyOn(store, 'claim').mockImplementationOnce(async (claim) => {
      const result = await originalClaim(claim);
      expect(result.record.submissionDeadline.getTime() - start).toBeGreaterThanOrEqual(120_000);
      expect(result.record.submissionDeadline.getTime() - start).toBeLessThan(121_000);
      jest.spyOn(Date, 'now').mockReturnValue(result.record.submissionDeadline.getTime() + 1);
      return result;
    });
    expect(await service.submit(claims, input)).toMatchObject({ status: 'SUBMISSION_UNKNOWN' });
    expect((await store.findByClientId(claims.enterpriseId, input.clientRequestId))?.receipt.status).toBe('SUBMISSION_UNKNOWN');
    expect(await instance().submit(claims, input)).toMatchObject({ status: 'SUBMISSION_UNKNOWN' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not dispatch when reauthorization consumes the remaining submission deadline', async () => {
    const dto = payload('mock-async'); const quote = await service.quote(claims, dto);
    const input = MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'delayed-reauthorization' });
    const spy = jest.spyOn(adapter, 'submit');
    const originalClaim = store.claim.bind(store);
    jest.spyOn(store, 'claim').mockImplementationOnce(async (claim) => {
      const result = await originalClaim(claim);
      prisma.subscription.findFirst.mockImplementationOnce(async () => {
        jest.spyOn(Date, 'now').mockReturnValue(result.record.submissionDeadline.getTime() + 1);
        return { id: 'sub-1' };
      });
      return result;
    });
    expect(await service.submit(claims, input)).toMatchObject({ status: 'SUBMISSION_UNKNOWN', errorCode: 'SUBMISSION_UNKNOWN' });
    expect(await instance().submit(claims, input)).toMatchObject({ status: 'SUBMISSION_UNKNOWN' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not let a delayed adapter completion overwrite a persisted UNKNOWN timeout', async () => {
    const dto = payload('mock-async'); const quote = await service.quote(claims, dto);
    const input = MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'late-completion' });
    let release!: (value: 'QUEUED') => void;
    const spy = jest.spyOn(adapter, 'submit').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const submission = service.submit(claims, input);
    await new Promise((resolve) => setImmediate(resolve));
    const pending = (await store.findByClientId(claims.enterpriseId, input.clientRequestId))!;
    try {
      jest.spyOn(Date, 'now').mockReturnValue(pending.submissionDeadline.getTime() + 1);
      expect((await instance().findByClientId(claims, input.clientRequestId)).status).toBe('SUBMISSION_UNKNOWN');
    } finally { release('QUEUED'); }
    expect((await submission).status).toBe('SUBMISSION_UNKNOWN');
    expect((await store.findRequest(pending.receipt.receiptId))?.receipt.status).toBe('SUBMISSION_UNKNOWN');
    expect((await instance().submit(claims, input)).status).toBe('SUBMISSION_UNKNOWN');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('propagates a final-save failure and recovers only the original claim without another adapter call', async () => {
    const dto = payload(); const quote = await service.quote(claims, dto);
    const input = MediaGatewayRequestSchema.parse({ ...dto, quoteId: quote.quoteId, clientRequestId: 'save-failure' });
    const spy = jest.spyOn(adapter, 'submit');
    jest.spyOn(store, 'save').mockImplementationOnce(async () => mediaStorageUnavailable());
    await error(service.submit(claims, input), 503, 'MEDIA_STORAGE_UNAVAILABLE');
    const pending = (await store.findByClientId(claims.enterpriseId, input.clientRequestId))!;
    expect(pending.receipt).toMatchObject({ status: 'SUBMITTING', outputs: [] });
    expect((await instance().submit(claims, input)).receiptId).toBe(pending.receipt.receiptId);
    jest.spyOn(Date, 'now').mockReturnValue(pending.submissionDeadline.getTime() + 1);
    expect((await instance().submit(claims, input)).status).toBe('SUBMISSION_UNKNOWN');
    expect((await store.findRequest(pending.receipt.receiptId))?.receipt.status).toBe('SUBMISSION_UNKNOWN');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each(['query', 'cancel'] as const)('preserves storage 503 during %s instead of mapping it to an adapter error', async (operation) => {
    const receipt = await submit('mock-async');
    jest.spyOn(store, 'save').mockImplementationOnce(async () => mediaStorageUnavailable());
    await error(operation === 'query' ? service.receipt(claims, receipt.receiptId) : service.cancel(claims, receipt.receiptId),
      503, 'MEDIA_STORAGE_UNAVAILABLE');
    expect((await store.findRequest(receipt.receiptId))?.receipt.status).toBe('QUEUED');
    expect((await instance().findByClientId(claims, receipt.clientRequestId)).status).toBe('QUEUED');
  });
});
