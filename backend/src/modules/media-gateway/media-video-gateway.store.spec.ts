import type { Prisma } from '@prisma/client';
import { MediaVideoGatewayService } from './media-video-gateway.service';
import { MediaVideoGatewayStore } from './media-video-gateway.store';
import { createVideoPrismaMock, videoClaims as claims, videoFile, videoInput, videoScope } from './media-video-gateway.test-support';
import type { VideoPrismaMock } from './media-video-gateway.test-support';

describe('MediaVideoGatewayStore shared Prisma tables', () => {
  let prisma: VideoPrismaMock;
  let store: MediaVideoGatewayStore;
  let service: MediaVideoGatewayService;
  beforeEach(() => {
    prisma = createVideoPrismaMock(); store = new MediaVideoGatewayStore(prisma as never);
    service = new MediaVideoGatewayService(prisma as never, store);
  });
  async function prepare(id = 'shared-key') {
    const reference = await service.reference(claims, videoFile());
    const input = videoInput(reference.referenceId);
    const quote = await service.quote(claims, input);
    return { ...input, quoteId: quote.quoteId, clientRequestId: id };
  }

  it('never decodes or adopts another adapter reference, quote or receipt', async () => {
    const dto = await prepare(); const receipt = await service.submit(claims, dto);
    prisma.state.references.get(dto.referenceIds[0])!.metadata = { mock: true };
    prisma.state.quotes.get(dto.quoteId)!.metadata = { mock: true };
    prisma.state.requests.get(receipt.receiptId)!.configuration = { adapter: 'static-png-v1' };
    expect(await store.findReference(videoScope(), dto.referenceIds[0])).toBeNull();
    expect(await store.findQuote(videoScope(), dto.quoteId)).toBeNull();
    expect(await store.findRequest(videoScope(), receipt.receiptId)).toBeNull();
    expect(await store.findByClientId(claims.enterpriseId, dto.clientRequestId, videoScope())).toBeNull();
    await expect(service.submit(claims, dto)).rejects.toMatchObject({ status: 409 });
    expect(prisma.mediaGatewayRequest.create).toHaveBeenCalledTimes(1);
    expect(prisma.mediaGatewayRequest.updateMany).not.toHaveBeenCalled();
  });

  it('reserves clientRequestId per enterprise across subscriptions and users, without disclosing rows', async () => {
    const dto = await prepare(); await service.submit(claims, dto);
    const foreignScope = videoScope({ ...claims, memberId: 'other-member' });
    expect(await store.findByClientId(claims.enterpriseId, dto.clientRequestId, foreignScope)).toBeNull();
    await expect(store.findByClientId(claims.enterpriseId, dto.clientRequestId, foreignScope, true)).rejects.toMatchObject({ status: 404 });
    expect(await store.findByClientId('other-enterprise', dto.clientRequestId, foreignScope)).toBeNull();
  });

  it('handles unique conflicts introduced after the initial lookup, including an image key and foreign scope', async () => {
    const dto = await prepare(); const receipt = await service.submit(claims, dto);
    const record = (await store.findRequest(videoScope(), receipt.receiptId))!;
    const { receiptId: _id, ...value } = record.receipt;
    const { revision: _revision, ...input } = record;
    const claim = { ...input, receipt: value };
    const same = await store.claim(claim);
    expect(same.receipt.receiptId).toBe(receipt.receiptId);
    await expect(store.claim({ ...claim, scope: 'other' })).rejects.toMatchObject({ status: 404 });
    prisma.state.requests.get(receipt.receiptId)!.configuration = { adapter: 'static-png-v1' };
    await expect(store.claim(claim)).rejects.toMatchObject({ status: 409 });
    expect(prisma.state.requests.size).toBe(1);
  });

  it('allows the same clientRequestId in different enterprises while keeping each original receipt', async () => {
    const dto = await prepare(); const original = await service.submit(claims, dto);
    const other = { ...claims, enterpriseId: 'other-enterprise' };
    const ref = await service.reference(other, videoFile());
    const input = videoInput(ref.referenceId);
    const quote = await service.quote(other, input);
    const second = await service.submit(other, { ...input, quoteId: quote.quoteId, clientRequestId: dto.clientRequestId });
    expect(second.receiptId).not.toBe(original.receiptId);
    expect((await service.findByClientId(other, dto.clientRequestId)).receiptId).toBe(second.receiptId);
    expect(prisma.state.requests.size).toBe(2);
  });

  it('does not overwrite a newer state with a stale CAS and does not retry the update', async () => {
    const dto = await prepare(); const queued = await service.submit(claims, dto);
    const stale = (await store.findRequest(videoScope(), queued.receiptId))!;
    await service.receipt(claims, queued.receiptId);
    const done = await service.receipt(claims, queued.receiptId);
    const before = prisma.mediaGatewayRequest.updateMany.mock.calls.length;
    const result = await store.advance(stale, { ...stale.receipt, status: 'RUNNING' });
    expect(result.receipt).toEqual(done);
    expect(result.revision).toBe(2);
    expect(prisma.mediaGatewayRequest.updateMany.mock.calls.length - before).toBe(1);
    expect(prisma.mediaGatewayRequest.updateMany.mock.calls.at(-1)![0].where).toMatchObject({
      id: queued.receiptId, revision: 0, status: 'QUEUED', scope: videoScope(),
      configuration: { path: ['adapter'], equals: 'static-video-v1' },
    });
  });

  it.each(['semanticSha256', 'configuration', 'receipt', 'status'] as const)('fails closed for malformed owned %s metadata', async field => {
    const dto = await prepare(); const receipt = await service.submit(claims, dto);
    const row = prisma.state.requests.get(receipt.receiptId)!;
    if (field === 'semanticSha256') row.semanticSha256 = 'bad';
    if (field === 'configuration') (row.configuration as Prisma.JsonObject).creativeBrief = 'must be rejected';
    if (field === 'receipt') (row.receipt as Prisma.JsonObject).clientRequestId = 'wrong';
    if (field === 'status') row.status = 'RUNNING';
    await expect(store.findRequest(videoScope(), receipt.receiptId)).rejects.toMatchObject({ status: 503 });
    // Unrelated scopes see a missing resource instead of owned corruption.
    expect(await store.findRequest('other-scope', receipt.receiptId)).toBeNull();
  });

  it('returns 503 for a committed CAS followed by a failed reread, and retains the state for recovery', async () => {
    const dto = await prepare(); const receipt = await service.submit(claims, dto);
    const original = prisma.mediaGatewayRequest.updateMany.getMockImplementation()!;
    prisma.mediaGatewayRequest.updateMany.mockImplementationOnce(async args => {
      const result = await original(args);
      prisma.mediaGatewayRequest.findUnique.mockRejectedValueOnce(new Error('private read failure'));
      return result;
    });
    await expect(service.receipt(claims, receipt.receiptId)).rejects.toMatchObject({ status: 503 });
    expect((await service.findByClientId(claims, dto.clientRequestId)).status).toBe('RUNNING');
    expect(prisma.mediaGatewayRequest.create).toHaveBeenCalledTimes(1);
  });

  it('sanitizes failed reference, quote and request persistence without memory fallback', async () => {
    prisma.mediaGatewayReference.create.mockRejectedValueOnce(new Error('private reference DB failure'));
    await expect(service.reference(claims, videoFile())).rejects.toMatchObject({ status: 503 });
    expect(prisma.state.references.size).toBe(0);
    const ref = await service.reference(claims, videoFile());
    prisma.mediaGatewayQuote.create.mockRejectedValueOnce(new Error('private quote DB failure'));
    await expect(service.quote(claims, videoInput(ref.referenceId))).rejects.toMatchObject({ status: 503 });
    expect(prisma.state.quotes.size).toBe(0);
    const dto = await prepare();
    prisma.mediaGatewayRequest.create.mockRejectedValueOnce(new Error('private request DB failure'));
    await expect(service.submit(claims, dto)).rejects.toMatchObject({ status: 503 });
    expect(prisma.state.requests.size).toBe(0);
  });
});
