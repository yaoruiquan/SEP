import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { MediaVideoGatewayReceiptSchema } from 'shared';
import fixture from '../../shared/fixtures/media-video-v1.json';
import { MediaVideoGatewayService } from './media-video-gateway.service';
import { MediaVideoGatewayStore } from './media-video-gateway.store';
import { createVideoPrismaMock, videoClaims as claims, videoFile, videoInput, videoScope } from './media-video-gateway.test-support';
import type { VideoPrismaMock } from './media-video-gateway.test-support';

describe('MediaVideoGatewayService persisted static mock', () => {
  let prisma: VideoPrismaMock;
  let store: MediaVideoGatewayStore;
  let service: MediaVideoGatewayService;
  beforeEach(() => {
    prisma = createVideoPrismaMock();
    store = new MediaVideoGatewayStore(prisma as never);
    service = new MediaVideoGatewayService(prisma as never, store);
  });
  afterEach(() => jest.restoreAllMocks());

  async function preparedRequest(clientRequestId = 'video-request-1') {
    const reference = await service.reference(claims, videoFile(), {});
    const input = videoInput(reference.referenceId);
    const quote = await service.quote(claims, input);
    return { ...input, quoteId: quote.quoteId, clientRequestId };
  }

  it('persists reference, quote and request without prompt, and binds the reference hashes in the quote hash', async () => {
    const dto = await preparedRequest();
    const quoteRow = prisma.state.quotes.get(dto.quoteId)!;
    const metadata = quoteRow.metadata as Prisma.JsonObject;
    const referenceHashes = (metadata.referenceHashes as string[]);
    const expected = createHash('sha256').update(JSON.stringify({
      profileId: dto.profileId, configVersion: dto.configVersion, operation: dto.operation,
      referenceIds: dto.referenceIds, referenceHashes, creativeBrief: dto.creativeBrief, parameters: dto.parameters,
    })).digest('hex');
    expect((metadata.value as Prisma.JsonObject).semanticSha256).toBe(expected);
    await service.submit(claims, dto);
    const serialized = JSON.stringify([...prisma.state.references.values(), ...prisma.state.quotes.values(), ...prisma.state.requests.values()]);
    expect(serialized).not.toContain(dto.creativeBrief);
    expect(serialized).not.toContain('creativeBrief');
    expect(serialized).not.toContain(fixture.mediaFixture.base64);
  });

  it('restarts over the same database, looks up without advancing and replays after quote/reference expiry', async () => {
    const dto = await preparedRequest();
    const first = await service.submit(claims, dto);
    const restarted = new MediaVideoGatewayService(prisma as never, new MediaVideoGatewayStore(prisma as never));
    expect(await restarted.findByClientId(claims, dto.clientRequestId)).toEqual(first);
    prisma.state.references.clear();
    prisma.state.quotes.clear();
    expect(await restarted.submit(claims, dto)).toEqual(first);
    expect(prisma.mediaGatewayRequest.create).toHaveBeenCalledTimes(1);
    expect((await restarted.receipt(claims, first.receiptId)).status).toBe('RUNNING');
    const done = await restarted.receipt(claims, first.receiptId);
    expect(done.status).toBe('SUCCEEDED');
    const content = await restarted.content(claims, first.receiptId, done.outputs[0].outputId);
    expect(content.bytes.length).toBe(fixture.mediaFixture.byteLength);
    expect(createHash('sha256').update(content.bytes).digest('hex')).toBe(fixture.mediaFixture.sha256);
    expect(content.bytes.subarray(4, 8).toString()).toBe('ftyp');
    expect(content.output).toMatchObject({ durationSeconds: 5, width: 720, height: 1280, frameRate: 24 });
  });

  it('arbitrates concurrent claims using the enterprise index and rejects differing semantic replay', async () => {
    const dto = await preparedRequest();
    const receipts = await Promise.all(Array.from({ length: 8 }, () => service.submit(claims, dto)));
    expect(new Set(receipts.map(receipt => receipt.receiptId)).size).toBe(1);
    expect(prisma.state.requests.size).toBe(1);
    await expect(service.submit(claims, { ...dto, creativeBrief: 'Different intent' })).rejects.toMatchObject({ status: 409 });
    await expect(service.submit(claims, { ...dto, parameters: { ...dto.parameters, durationSeconds: 10 } })).rejects.toMatchObject({ status: 409 });
  });

  it('rechecks reference expiry on first submission and rejects changed quote semantics', async () => {
    const dto = await preparedRequest();
    const ref = prisma.state.references.get(dto.referenceIds[0])!;
    const value = (ref.metadata as Prisma.JsonObject).value as Prisma.JsonObject;
    ref.expiresAt = new Date(Date.now() - 1);
    value.expiresAt = ref.expiresAt.toISOString();
    await expect(service.submit(claims, dto)).rejects.toMatchObject({ status: 404 });
    expect(prisma.state.requests.size).toBe(0);
    ref.expiresAt = new Date(Date.now() + 60_000); value.expiresAt = ref.expiresAt.toISOString();
    await expect(service.submit(claims, { ...dto, creativeBrief: 'Different quote intent' })).rejects.toMatchObject({ status: 409 });
    expect(prisma.state.requests.size).toBe(0);
  });

  it('rejects an expired quote without reserving a key', async () => {
    const dto = await preparedRequest();
    const quote = prisma.state.quotes.get(dto.quoteId)!;
    quote.expiresAt = new Date(Date.now() - 1);
    ((quote.metadata as Prisma.JsonObject).value as Prisma.JsonObject).expiresAt = quote.expiresAt.toISOString();
    await expect(service.submit(claims, dto)).rejects.toMatchObject({ status: 409 });
    expect(prisma.state.requests.size).toBe(0);
  });

  it.each(['enterpriseId', 'memberId', 'subscriptionId', 'sub'] as const)('isolates quotes, references, receipt, lookup, download and cancel by %s', async field => {
    const dto = await preparedRequest();
    const first = await service.submit(claims, dto);
    await service.receipt(claims, first.receiptId);
    const done = await service.receipt(claims, first.receiptId);
    const foreign = { ...claims, [field]: 'other' };
    for (const action of [
      () => service.quote(foreign, videoInput(dto.referenceIds[0])), () => service.submit(foreign, dto),
      () => service.receipt(foreign, first.receiptId), () => service.findByClientId(foreign, dto.clientRequestId),
      () => service.content(foreign, first.receiptId, done.outputs[0].outputId), () => service.cancel(foreign, first.receiptId),
    ]) await expect(action()).rejects.toMatchObject({ status: 404 });
    expect(prisma.state.requests.size).toBe(1);
    expect(prisma.state.requests.get(first.receiptId)!.scope).toBe(videoScope());
  });

  it.each(['enterpriseMember', 'subscription'] as const)('rechecks %s authorization on every entry, including cancel', async kind => {
    const dto = await preparedRequest();
    const first = await service.submit(claims, dto);
    prisma[kind].findFirst.mockResolvedValue(null);
    for (const action of [
      () => service.profiles(claims), () => service.reference(claims, videoFile()), () => service.quote(claims, dto),
      () => service.submit(claims, dto), () => service.findByClientId(claims, dto.clientRequestId),
      () => service.receipt(claims, first.receiptId), () => service.content(claims, first.receiptId, 'output'),
      () => service.cancel(claims, first.receiptId),
    ]) await expect(action()).rejects.toMatchObject({ status: 403 });
  });

  it('checks cancel resource and scope before reporting unsupported, without modifying receipt', async () => {
    const dto = await preparedRequest(); const receipt = await service.submit(claims, dto);
    await expect(service.cancel(claims, 'missing')).rejects.toMatchObject({ status: 404 });
    await expect(service.cancel(claims, receipt.receiptId)).rejects.toMatchObject({ status: 409 });
    expect(await service.findByClientId(claims, dto.clientRequestId)).toEqual(receipt);
    expect(prisma.mediaGatewayRequest.updateMany).not.toHaveBeenCalled();
  });

  it('advances only one state for concurrent polls, with the same result across service instances', async () => {
    const dto = await preparedRequest(); const first = await service.submit(claims, dto);
    const other = new MediaVideoGatewayService(prisma as never, new MediaVideoGatewayStore(prisma as never));
    const running = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? service : other).receipt(claims, first.receiptId)));
    expect(running.every(receipt => receipt.status === 'RUNNING')).toBe(true);
    expect(prisma.state.requests.get(first.receiptId)!.revision).toBe(1);
    const finished = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? service : other).receipt(claims, first.receiptId)));
    expect(finished.every(receipt => receipt.status === 'SUCCEEDED')).toBe(true);
    expect(prisma.state.requests.get(first.receiptId)!.revision).toBe(2);
    expect(new Set(finished.map(receipt => receipt.outputs[0].expiresAt)).size).toBe(1);
  });

  it.each(['enterpriseMember', 'subscription'] as const)('maps %s DB failure to a sanitized 503', async kind => {
    prisma[kind].findFirst.mockRejectedValueOnce(new Error('private DB detail'));
    await expect(service.cancel(claims, 'missing')).rejects.toMatchObject({ status: 503 });
  });

  it('does not recreate a request after an ambiguous acknowledged database write failure', async () => {
    const dto = await preparedRequest();
    const create = prisma.mediaGatewayRequest.create.getMockImplementation()!;
    prisma.mediaGatewayRequest.create.mockImplementationOnce(async args => {
      await create(args);
      throw new Error('connection lost after commit');
    });
    await expect(service.submit(claims, dto)).rejects.toMatchObject({ status: 503 });
    const restarted = new MediaVideoGatewayService(prisma as never, new MediaVideoGatewayStore(prisma as never));
    const original = await restarted.findByClientId(claims, dto.clientRequestId);
    expect(original.status).toBe('QUEUED');
    expect(await restarted.submit(claims, dto)).toEqual(original);
    expect(prisma.mediaGatewayRequest.create).toHaveBeenCalledTimes(1);
  });

  it('keeps committed CAS progress on ambiguous failure and recovers via original client ID without dispatch', async () => {
    const dto = await preparedRequest(); const first = await service.submit(claims, dto);
    const update = prisma.mediaGatewayRequest.updateMany.getMockImplementation()!;
    prisma.mediaGatewayRequest.updateMany.mockImplementationOnce(async args => {
      await update(args); throw new Error('lost ack');
    });
    await expect(service.receipt(claims, first.receiptId)).rejects.toMatchObject({ status: 503 });
    expect((await service.findByClientId(claims, dto.clientRequestId)).status).toBe('RUNNING');
    expect((await service.submit(claims, dto)).status).toBe('RUNNING');
    expect(prisma.mediaGatewayRequest.create).toHaveBeenCalledTimes(1);
  });

  it('downloads a partial result but never invents success for failed, unknown or expired receipts', async () => {
    const dto = await preparedRequest(); const first = await service.submit(claims, dto);
    await service.receipt(claims, first.receiptId);
    const done = await service.receipt(claims, first.receiptId);
    const row = prisma.state.requests.get(first.receiptId)!;
    for (const status of ['PARTIAL_SUCCEEDED', 'FAILED', 'SUBMISSION_UNKNOWN', 'RESULT_EXPIRED'] as const) {
      const delivered = status === 'PARTIAL_SUCCEEDED';
      const receipt = MediaVideoGatewayReceiptSchema.parse({ ...done, status, errorCode: delivered ? 'OUTPUT_FAILED' : status,
        outputs: delivered || status === 'RESULT_EXPIRED' ? done.outputs : [],
        recovery: { canQuery: false, canCancel: false, canDownload: delivered } });
      const { receiptId: _id, ...value } = receipt;
      row.status = status; row.receipt = value;
      expect((await service.receipt(claims, first.receiptId)).status).toBe(status);
      if (delivered) expect((await service.content(claims, first.receiptId, done.outputs[0].outputId)).bytes.length).toBe(fixture.mediaFixture.byteLength);
      else await expect(service.content(claims, first.receiptId, done.outputs[0].outputId)).rejects.toMatchObject({ status: status === 'RESULT_EXPIRED' ? 410 : 404 });
    }
  });

  it.each([
    ['SUCCEEDED', 'future'], ['SUCCEEDED', 'no-expiry'],
    ['PARTIAL_SUCCEEDED', 'future'], ['PARTIAL_SUCCEEDED', 'no-expiry'],
  ] as const)('preserves %s and downloadable outputs when another output expired (%s)', async (status, retention) => {
    const dto = await preparedRequest(); const first = await service.submit(claims, dto);
    await service.receipt(claims, first.receiptId);
    const done = await service.receipt(claims, first.receiptId);
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    const expiredOutput = { ...done.outputs[0], expiresAt: expiredAt };
    const availableOutput = { ...done.outputs[0], outputId: `${first.receiptId}-output-2`,
      expiresAt: retention === 'future' ? new Date(Date.now() + 60_000).toISOString() : null };
    const mixed = MediaVideoGatewayReceiptSchema.parse({ ...done, status, outputs: [expiredOutput, availableOutput] });
    const { receiptId: _id, ...value } = mixed;
    const row = prisma.state.requests.get(first.receiptId)!;
    row.status = status; row.receipt = value;
    prisma.mediaGatewayRequest.updateMany.mockClear();

    expect(await service.receipt(claims, first.receiptId)).toEqual(mixed);
    expect(await service.findByClientId(claims, dto.clientRequestId)).toEqual(mixed);
    expect(await service.submit(claims, dto)).toEqual(mixed);
    await expect(service.content(claims, first.receiptId, expiredOutput.outputId)).rejects.toMatchObject({ status: 410 });
    const content = await service.content(claims, first.receiptId, availableOutput.outputId);
    expect(content.bytes).toEqual(Buffer.from(fixture.mediaFixture.base64, 'base64'));
    expect(prisma.mediaGatewayRequest.updateMany).not.toHaveBeenCalled();
    expect(prisma.state.requests.get(first.receiptId)!.revision).toBe(2);

    const restarted = new MediaVideoGatewayService(prisma as never, new MediaVideoGatewayStore(prisma as never));
    expect(await restarted.findByClientId(claims, dto.clientRequestId)).toEqual(mixed);
    expect((await restarted.content(claims, first.receiptId, availableOutput.outputId)).bytes).toEqual(content.bytes);

    // The entire receipt expires only after the last available output also expires.
    ((prisma.state.requests.get(first.receiptId)!.receipt as Prisma.JsonObject).outputs as Prisma.JsonObject[])[1].expiresAt = expiredAt;
    const expired = await restarted.receipt(claims, first.receiptId);
    expect(expired).toMatchObject({ receiptId: first.receiptId, status: 'RESULT_EXPIRED',
      recovery: { canQuery: false, canCancel: false, canDownload: false } });
    expect(expired.outputs).toEqual([expiredOutput, { ...availableOutput, expiresAt: expiredAt }]);
    expect(prisma.state.requests.get(first.receiptId)!.revision).toBe(3);
    expect(prisma.mediaGatewayRequest.updateMany).toHaveBeenCalledTimes(1);
    await expect(restarted.content(claims, first.receiptId, availableOutput.outputId)).rejects.toMatchObject({ status: 410 });
    expect(prisma.mediaGatewayRequest.create).toHaveBeenCalledTimes(1);
  });

  it.each(['receipt', 'findByClientId', 'submit'] as const)('persists output expiration through %s and recovers the same expired receipt after restart', async entry => {
    const dto = await preparedRequest(); const first = await service.submit(claims, dto);
    await service.receipt(claims, first.receiptId);
    const done = await service.receipt(claims, first.receiptId);
    const row = prisma.state.requests.get(first.receiptId)!;
    ((row.receipt as Prisma.JsonObject).outputs as Prisma.JsonObject[])[0].expiresAt = new Date(Date.now() - 1).toISOString();
    const expired = entry === 'receipt' ? await service.receipt(claims, first.receiptId)
      : entry === 'findByClientId' ? await service.findByClientId(claims, dto.clientRequestId) : await service.submit(claims, dto);
    expect(expired).toMatchObject({ receiptId: first.receiptId, status: 'RESULT_EXPIRED', errorCode: 'RESULT_EXPIRED',
      recovery: { canQuery: false, canCancel: false, canDownload: false } });
    expect(prisma.state.requests.get(first.receiptId)!.revision).toBe(3);
    const restarted = new MediaVideoGatewayService(prisma as never, new MediaVideoGatewayStore(prisma as never));
    expect(await restarted.findByClientId(claims, dto.clientRequestId)).toEqual(expired);
    await expect(restarted.content(claims, first.receiptId, done.outputs[0].outputId)).rejects.toMatchObject({ status: 410 });
    expect(prisma.mediaGatewayRequest.create).toHaveBeenCalledTimes(1);
  });
});
