import { HttpException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { MediaRealService } from './media-real.service';
import { ImageDispatchError } from './sub2api-image.adapter';
import { MediaRealQuoteRequestSchema } from 'shared';
import { MEDIA_MOCK_PNG } from './media-gateway-mock.adapter';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import type { RealRequestRecord } from './media-real.store';

const claims = { enterpriseId: 'enterprise', sub: 'user', memberId: 'member', subscriptionId: 'subscription' } as ClientEmploymentClaims;
const scope = JSON.stringify([claims.enterpriseId, claims.sub, claims.memberId, claims.subscriptionId]);
const hash = createHash('sha256').update(MEDIA_MOCK_PNG).digest('hex');
const profile = { profileId: 'image', configVersion: 'cfg_1', executionMode: 'sync-response', operations: ['generate', 'edit'],
  capabilities: { sizes: ['1024x1024'], maxOutputs: 4, supportsReferenceImage: true } };
const quoteInput = MediaRealQuoteRequestSchema.parse({ profileId: 'image', configVersion: 'cfg_1', operation: 'generate', creativeBrief: 'Draw a product' });
const request = { ...quoteInput, clientRequestId: 'request', quoteId: 'quote' };

function harness() {
  let record: RealRequestRecord | null = null;
  let quote: any = null;
  const prisma = { enterpriseMember: { findFirst: jest.fn().mockResolvedValue({ departmentId: null }) },
    subscription: { findFirst: jest.fn().mockResolvedValue({ id: 'subscription' }) },
    mediaModelProfile: { findUnique: jest.fn().mockResolvedValue({ ...profile, modelId: 'gpt-image-2', enabled: true, verified: true }) } };
  const config = { get: jest.fn().mockReturnValue('true') };
  const settings = { getEffectiveValue: jest.fn().mockResolvedValue('7.2') };
  const mediaConfig = { getConnection: jest.fn().mockResolvedValue({ configured: true }),
    getRuntimeMedia: jest.fn().mockResolvedValue({ executionAvailable: true, profiles: [profile] }) };
  const adapter = { pricing: jest.fn().mockResolvedValue({ amount_usd: '0.10', pricing_version: 'price1', expires_at: new Date(Date.now() + 60_000).toISOString() }),
    execute: jest.fn().mockResolvedValue({ requestId: 'upstream', images: [MEDIA_MOCK_PNG] }),
    usage: jest.fn().mockResolvedValue({ status: 'settled', actual_cost_usd: '0.08', model: 'gpt-image-2', image_count: 1 }) };
  const cache = { put: jest.fn().mockResolvedValue(undefined), get: jest.fn().mockResolvedValue(MEDIA_MOCK_PNG) };
  const billing = { quoteFunding: jest.fn().mockResolvedValue({ creditCny: '0.720000', memberWalletCny: '0.000000', personalCny: '0.000000' }),
    status: jest.fn().mockResolvedValue('RESERVED'),
    reserve: jest.fn().mockResolvedValue(undefined), release: jest.fn().mockResolvedValue(undefined), settle: jest.fn().mockResolvedValue('SETTLED') };
  const store = {
    saveQuote: jest.fn(async (_scope: string, value: any, usdToCnyRate: number) => { quote = { scope: _scope, value: { ...value, quoteId: 'quote' }, usdToCnyRate }; return quote.value; }),
    findQuote: jest.fn(async () => quote), findReference: jest.fn(async () => ({ scope, value: { sha256: hash, byteLength: MEDIA_MOCK_PNG.length, expiresAt: new Date(Date.now() + 60_000).toISOString() } })),
    findByClientId: jest.fn(async () => record), findRequest: jest.fn(async () => record),
    pendingRequests: jest.fn(async () => ({ records: record ? [structuredClone(record)] : [], afterId: undefined })),
    claim: jest.fn(async (input: any) => {
      if (record) return { record: structuredClone(record), created: false };
      record = { ...input, id: 'receipt', receipt: { ...input.receipt, receiptId: 'receipt' }, revision: 0 };
      return { record: structuredClone(record), created: true };
    }),
    save: jest.fn(async (value: RealRequestRecord) => {
      if (record?.revision === value.revision) record = structuredClone({ ...value, revision: value.revision + 1 });
      return structuredClone(record!);
    }),
    saveReference: jest.fn(async (_scope: string, value: any) => ({ ...value, referenceId: 'reference' })),
  };
  const service = new MediaRealService(config as any, prisma as any, settings as any, mediaConfig as any, adapter as any, cache as any, billing as any, store as any);
  return { service, config, settings, mediaConfig, prisma, adapter, cache, billing, store,
    quote: () => quote, record: () => record! };
}

describe('MediaRealService', () => {
  it('returns client profiles contract and respects disabled runtime', async () => {
    const h = harness();
    expect(await h.service.profiles(claims)).toMatchObject({ mock: false, persistence: 'database', profiles: [profile] });
    h.mediaConfig.getRuntimeMedia.mockResolvedValue({ executionAvailable: false, profiles: [profile] });
    expect((await h.service.profiles(claims)).profiles).toEqual([]);
  });

  it('does not reserve or dispatch at quote and freezes the exchange rate', async () => {
    const h = harness(); const quote = await h.service.quote(claims, quoteInput);
    expect(quote.amountCny).toBe('0.720000');
    expect(h.billing.reserve).not.toHaveBeenCalled(); expect(h.adapter.execute).not.toHaveBeenCalled();
    h.settings.getEffectiveValue.mockResolvedValue('9');
    const receipt = await h.service.submit(claims, request);
    expect(receipt.billingStatus).toBe('SETTLED');
    expect(h.billing.reserve).toHaveBeenCalledWith(claims, 'receipt', '0.720000', 7.2);
    expect(h.billing.settle).toHaveBeenCalledWith('receipt', '0.576000', '0.080000', 'gpt-image-2');
    expect(h.record().configuration).not.toHaveProperty('creativeBrief');
  });

  it('freezes the selected profile model from quote through execution and billing reconciliation', async () => {
    const h = harness();
    h.prisma.mediaModelProfile.findUnique.mockResolvedValue({ ...profile, modelId: 'gpt-image-1.5', enabled: true, verified: true });
    h.adapter.usage.mockResolvedValue({ status: 'settled', actual_cost_usd: '0.08', model: 'gpt-image-1.5', image_count: 1 });
    await h.service.quote(claims, quoteInput);
    expect(h.adapter.pricing).toHaveBeenCalledWith(quoteInput, 'gpt-image-1.5');
    await h.service.submit(claims, request);
    expect(h.store.claim.mock.calls[0][0].configuration).toMatchObject({ modelId: 'gpt-image-1.5' });
    expect(h.adapter.execute).toHaveBeenCalledWith(expect.objectContaining({ ...quoteInput, ...request }), [], expect.any(Function), 'gpt-image-1.5');
    expect(h.billing.settle).toHaveBeenCalledWith('receipt', '0.576000', '0.080000', 'gpt-image-1.5');
  });

  it('concurrent identical requests dispatch only once', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput);
    await Promise.all([h.service.submit(claims, request), h.service.submit(claims, request)]);
    expect(h.adapter.execute).toHaveBeenCalledTimes(1); expect(h.billing.reserve).toHaveBeenCalledTimes(1);
  });

  it('settles from verified usage without consulting a changed current profile', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput);
    h.adapter.usage.mockResolvedValueOnce({ status: 'pending', actual_cost_usd: null, model: null, image_count: 0 } as any);
    await h.service.submit(claims, request);
    h.prisma.mediaModelProfile.findUnique.mockClear();
    h.prisma.mediaModelProfile.findUnique.mockResolvedValue({ ...profile, modelId: 'changed-model', enabled: true, verified: true });
    expect(await h.service.receipt(claims, 'receipt')).toMatchObject({ billingStatus: 'SETTLED' });
    expect(h.billing.settle).toHaveBeenCalledWith('receipt', '0.576000', '0.080000', 'gpt-image-2');
    expect(h.prisma.mediaModelProfile.findUnique).not.toHaveBeenCalled();
  });

  it.each([null, undefined, '', 'other-model'])('does not settle unverified upstream model %s', async model => {
    const h = harness(); await h.service.quote(claims, quoteInput);
    h.adapter.usage.mockResolvedValue({ status: 'settled', actual_cost_usd: '0.08', model, image_count: 1 } as any);
    expect(await h.service.submit(claims, request)).toMatchObject({ billingStatus: 'RECONCILING' });
    expect(h.billing.settle).not.toHaveBeenCalled();
  });

  it('rejects a changed payload under the same key', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput); await h.service.submit(claims, request);
    await expect(h.service.submit(claims, { ...request, creativeBrief: 'Different prompt' })).rejects.toMatchObject({ status: 409 });
    expect(h.adapter.execute).toHaveBeenCalledTimes(1);
  });

  it('recovers by original key even if edit references have expired', async () => {
    const h = harness(); const edit = { ...quoteInput, operation: 'edit' as const, referenceIds: ['reference'] };
    await h.service.quote(claims, edit); await h.service.submit(claims, { ...edit, quoteId: 'quote', clientRequestId: 'request' });
    h.store.findReference.mockRejectedValue(new Error('expired'));
    expect((await h.service.submit(claims, { ...edit, quoteId: 'quote', clientRequestId: 'request' })).status).toBe('SUCCEEDED');
    expect(h.adapter.execute).toHaveBeenCalledTimes(1);
  });

  it('never resubmits or releases an ambiguous upstream result', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput);
    h.adapter.execute.mockRejectedValue(new ImageDispatchError('upstream', false));
    expect((await h.service.submit(claims, request)).status).toBe('SUBMISSION_UNKNOWN');
    expect((await h.service.submit(claims, request)).status).toBe('SUBMISSION_UNKNOWN');
    expect(h.adapter.execute).toHaveBeenCalledTimes(1); expect(h.billing.release).not.toHaveBeenCalled(); expect(h.billing.settle).not.toHaveBeenCalled();
  });

  it('releases the reservation only for a definite dispatch rejection', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput);
    h.adapter.execute.mockRejectedValue(new ImageDispatchError(null, true));
    expect(await h.service.submit(claims, request)).toMatchObject({ status: 'FAILED', billingStatus: 'RELEASED' });
    expect(h.billing.release).toHaveBeenCalledWith('receipt');
  });

  it('marks an uncertain reservation as reconciling without dispatch or release', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput);
    h.billing.reserve.mockRejectedValue(new Error('unknown commit'));
    await expect(h.service.submit(claims, request)).rejects.toThrow('unknown commit');
    expect(h.record().receipt).toMatchObject({ status: 'SUBMISSION_UNKNOWN', billingStatus: 'RECONCILING' });
    expect(h.adapter.execute).not.toHaveBeenCalled(); expect(h.billing.release).not.toHaveBeenCalled();
  });

  it('rejects insufficient funds without upstream execution', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput);
    h.billing.reserve.mockRejectedValue(new HttpException({}, 402));
    await expect(h.service.submit(claims, request)).rejects.toMatchObject({ status: 402 });
    expect(h.record().receipt).toMatchObject({ status: 'FAILED', billingStatus: 'RELEASED' });
    expect(h.adapter.execute).not.toHaveBeenCalled();
  });

  it('checks reference cache before reserving', async () => {
    const h = harness(); const edit = { ...quoteInput, operation: 'edit' as const, referenceIds: ['reference'] };
    await h.service.quote(claims, edit); h.cache.get.mockRejectedValue(new HttpException({}, 410));
    await expect(h.service.submit(claims, { ...edit, quoteId: 'quote', clientRequestId: 'request' })).rejects.toMatchObject({ status: 410 });
    expect(h.billing.reserve).not.toHaveBeenCalled(); expect(h.store.claim).not.toHaveBeenCalled();
  });

  it('recovers download and billing from a new service instance without another dispatch', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput);
    h.adapter.usage.mockResolvedValueOnce({ status: 'pending', actual_cost_usd: null, model: null, image_count: 0 } as any);
    const receipt = await h.service.submit(claims, request);
    expect(receipt).toMatchObject({ status: 'SUCCEEDED', billingStatus: 'RECONCILING' });
    const restarted = new MediaRealService(h.config as any, h.prisma as any, h.settings as any, h.mediaConfig as any, h.adapter as any, h.cache as any, h.billing as any, h.store as any);
    expect((await restarted.receipt(claims, 'receipt')).billingStatus).toBe('SETTLED');
    expect((await restarted.content(claims, 'receipt', 'receipt_0')).bytes).toEqual(MEDIA_MOCK_PNG);
    expect(h.adapter.execute).toHaveBeenCalledTimes(1);
  });

  it('returns partial upstream output without regenerating missing outputs', async () => {
    const h = harness(); const input = { ...quoteInput, parameters: { ...quoteInput.parameters, count: 2 } };
    await h.service.quote(claims, input);
    expect(await h.service.submit(claims, { ...input, clientRequestId: 'request', quoteId: 'quote' })).toMatchObject({ status: 'PARTIAL_SUCCEEDED', outputErrors: [{ index: 1, code: 'OUTPUT_FAILED' }] });
    expect(h.adapter.execute).toHaveBeenCalledTimes(1);
  });

  it('denies revoked membership and cross enterprise receipt/download access', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput); await h.service.submit(claims, request);
    const other = { ...claims, enterpriseId: 'other' };
    await expect(h.service.receipt(other, 'receipt')).rejects.toMatchObject({ status: 404 });
    await expect(h.service.content(other, 'receipt', 'receipt_0')).rejects.toMatchObject({ status: 404 });
    h.prisma.subscription.findFirst.mockResolvedValue(null);
    await expect(h.service.content(claims, 'receipt', 'receipt_0')).rejects.toMatchObject({ status: 403 });
  });

  it('rejects expired quotes and unverified/currently changed profiles before claim', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput);
    h.quote().value.expiresAt = new Date(Date.now() - 1).toISOString();
    await expect(h.service.submit(claims, request)).rejects.toMatchObject({ status: 409 });
    expect(h.store.claim).not.toHaveBeenCalled();
    h.prisma.mediaModelProfile.findUnique.mockResolvedValue({ ...profile, modelId: 'gpt-image-2', enabled: true, verified: false });
    await expect(h.service.quote(claims, quoteInput)).rejects.toMatchObject({ status: 409 });
  });

  it('marks expired downloads without generating or changing billing', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput); await h.service.submit(claims, request);
    h.record().receipt.outputs[0].expiresAt = new Date(Date.now() - 1).toISOString();
    expect(await h.service.receipt(claims, 'receipt')).toMatchObject({ status: 'RESULT_EXPIRED', billingStatus: 'SETTLED', recovery: { canDownload: false } });
    await expect(h.service.content(claims, 'receipt', 'receipt_0')).rejects.toMatchObject({ status: 410 });
    expect(h.adapter.execute).toHaveBeenCalledTimes(1);
  });

  it('persists the upstream request ID before receiving image bytes', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput);
    h.adapter.execute.mockImplementationOnce(async (_input, _bytes, onRequestId) => {
      await onRequestId('early-upstream');
      expect(h.record().upstreamRequestId).toBe('early-upstream');
      expect(h.record().receipt.outputs).toEqual([]);
      throw new ImageDispatchError('early-upstream', false);
    });
    expect(await h.service.submit(claims, request)).toMatchObject({ status: 'SUBMISSION_UNKNOWN' });
    expect(h.record().upstreamRequestId).toBe('early-upstream');
  });

  it('keeps history authorized and downloadable after new execution is disabled', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput); await h.service.submit(claims, request);
    h.config.get.mockReturnValue('false');
    expect((await h.service.receipt(claims, 'receipt')).status).toBe('SUCCEEDED');
    expect((await h.service.content(claims, 'receipt', 'receipt_0')).bytes).toEqual(MEDIA_MOCK_PNG);
    await expect(h.service.quote(claims, quoteInput)).rejects.toMatchObject({ status: 503 });
    h.prisma.subscription.findFirst.mockResolvedValue(null);
    await expect(h.service.receipt(claims, 'receipt')).rejects.toMatchObject({ status: 403 });
  });

  it('retries a definite rejection refund after a transient release failure, never dispatching again', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput);
    h.adapter.execute.mockRejectedValueOnce(new ImageDispatchError(null, true));
    h.billing.release.mockRejectedValueOnce(new Error('commit unknown'));
    expect(await h.service.submit(claims, request)).toMatchObject({ status: 'FAILED', billingStatus: 'RECONCILING' });
    expect(await h.service.receipt(claims, 'receipt')).toMatchObject({ status: 'FAILED', billingStatus: 'RELEASED' });
    expect(h.adapter.execute).toHaveBeenCalledTimes(1);
  });

  it('repairs a receipt from an already committed ledger without re-settling', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput);
    h.adapter.usage.mockResolvedValueOnce({ status: 'pending', actual_cost_usd: null, model: null, image_count: 0 } as any);
    await h.service.submit(claims, request);
    h.billing.status.mockResolvedValueOnce('SETTLED');
    expect(await h.service.receipt(claims, 'receipt')).toMatchObject({ billingStatus: 'SETTLED' });
    expect(h.billing.settle).not.toHaveBeenCalled();
  });

  it('background reconciliation works without client queries or enabling new execution', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput);
    h.adapter.usage.mockResolvedValueOnce({ status: 'pending', actual_cost_usd: null, model: null, image_count: 0 } as any);
    await h.service.submit(claims, request); h.config.get.mockReturnValue('false');
    await h.service.reconcilePending();
    expect(h.record().receipt.billingStatus).toBe('SETTLED');
    expect(h.adapter.execute).toHaveBeenCalledTimes(1);
    expect(h.store.pendingRequests).toHaveBeenCalledWith(20, undefined);
  });

  it('releases a confirmed reservation when reserve acknowledgement was lost before dispatch', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput);
    h.billing.reserve.mockRejectedValueOnce(new Error('commit unknown'));
    await expect(h.service.submit(claims, request)).rejects.toThrow();
    expect(await h.service.receipt(claims, 'receipt')).toMatchObject({ status: 'FAILED', billingStatus: 'RELEASED' });
    expect(h.billing.release).toHaveBeenCalledWith('receipt');
    expect(h.adapter.execute).not.toHaveBeenCalled();
  });

  it('preserves late successful outputs when a timeout sweep wins the receipt CAS', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput);
    h.cache.put.mockImplementationOnce(async () => {
      h.record().submissionDeadline = new Date(Date.now() - 1);
      await h.service.reconcilePending();
      expect(h.record().receipt.status).toBe('SUBMISSION_UNKNOWN');
    });
    expect(await h.service.submit(claims, request)).toMatchObject({
      status: 'SUCCEEDED', billingStatus: 'SETTLED', outputs: [{ outputId: 'receipt_0' }], errorCode: null,
    });
    expect(h.record().upstreamRequestId).toBe('upstream');
    expect(h.adapter.execute).toHaveBeenCalledTimes(1);
    expect(h.billing.settle).toHaveBeenCalledTimes(1);
  });

  it('persists an early upstream ID even when a timeout sweep wins its first CAS', async () => {
    const h = harness(); await h.service.quote(claims, quoteInput);
    h.adapter.execute.mockImplementationOnce(async (_input, _bytes, onRequestId) => {
      h.record().submissionDeadline = new Date(Date.now() - 1);
      await h.service.reconcilePending();
      await onRequestId('early-upstream');
      expect(h.record().upstreamRequestId).toBe('early-upstream');
      expect(h.record().receipt.status).toBe('SUBMISSION_UNKNOWN');
      return { requestId: 'early-upstream', images: [MEDIA_MOCK_PNG] };
    });
    expect(await h.service.submit(claims, request)).toMatchObject({ status: 'SUCCEEDED', billingStatus: 'SETTLED', errorCode: null });
    expect(h.record().upstreamRequestId).toBe('early-upstream');
    expect(h.adapter.execute).toHaveBeenCalledTimes(1);
    expect(h.billing.release).not.toHaveBeenCalled();
  });
});
