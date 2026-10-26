import { Prisma } from '@prisma/client';
import { MediaVideoRealStore } from './media-video-real.store';
import { newClaim, scope, videoClaims, videoRealPrisma } from './media-video-real.test-support';

const code = (value: string) => ({ response: { error: { code: value } } });
describe('MediaVideoRealStore', () => {
  let db: ReturnType<typeof videoRealPrisma>;
  let store: MediaVideoRealStore;
  beforeEach(() => { db = videoRealPrisma(); store = new MediaVideoRealStore(db as never); });

  it('has exactly one created winner for concurrent same-key requests', async () => {
    const input = await newClaim(store);
    const results = await Promise.all([store.claim(input), store.claim(input)]);
    expect(results.map(r => r.created)).toEqual([true, false]);
    expect(results[0].record.receipt.receiptId).toBe(results[1].record.receipt.receiptId);
    expect(db.state.requests.size).toBe(1);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });

  it('consumes a quote once even for different client IDs', async () => {
    const input = await newClaim(store);
    const result = await store.claim(input);
    await expect(store.claim({ ...input, clientRequestId: 'other', receipt: { ...input.receipt, clientRequestId: 'other' } })).rejects.toMatchObject(code('QUOTE_ALREADY_USED'));
    expect(db.state.requests.size).toBe(1);
    expect(db.state.quotes.get(input.configuration.quoteId).metadata.consumedByClientRequestId).toBe(result.record.clientRequestId);
  });

  it('ignores deprecated enterprise concurrency restrictions', async () => {
    db.state.enterprise.mediaPolicy.video.maxConcurrentJobs = 1;
    await store.claim(await newClaim(store));
    const second = await newClaim(store, 'client-2');
    await expect(store.claim(second)).resolves.toMatchObject({ created: true });
    expect(db.state.quotes.get(second.configuration.quoteId).metadata.consumedByClientRequestId).toBe('client-2');
  });

  it.each(['SUBMITTING', 'SUBMISSION_UNKNOWN', 'QUEUED', 'RUNNING'])('does not count %s against enterprise concurrency', async status => {
    const first = await store.claim(await newClaim(store));
    const row = db.state.requests.get(first.record.receipt.receiptId);
    row.status = row.receipt.status = status;
    db.state.enterprise.mediaPolicy.video.maxConcurrentJobs = 1;
    await expect(store.claim(await newClaim(store, 'client-2'))).resolves.toMatchObject({ created: true });
  });

  it('does not enforce the deprecated real budget field', async () => {
    db.state.enterprise.mediaPolicy.video.periodBudget = 0;
    await expect(store.claim(await newClaim(store))).resolves.toMatchObject({ created: true });
    expect(db.state.requests.size).toBe(1);
    expect(db.mediaRealBillingReservation?.findMany).not.toHaveBeenCalled();
  });

  it('does not scan historical requests or reservations for the deprecated budget', async () => {
    const first = await store.claim(await newClaim(store));
    const row = db.state.requests.get(first.record.receipt.receiptId);
    row.createdAt = new Date('2020-01-01T00:00:00Z');
    row.receipt.billingStatus = 'RECONCILING';
    db.state.enterprise.mediaPolicy.video.periodBudget = 0.01;
    await expect(store.claim(await newClaim(store, 'client-2'))).resolves.toMatchObject({ created: true });
    expect(db.state.requests.size).toBe(2);
    expect(db.mediaGatewayRequest.findMany).not.toHaveBeenCalled();
    expect(db.mediaRealBillingReservation.findMany).not.toHaveBeenCalled();
  });

  it('isolates scope and reserves keys against mock/image records', async () => {
    const claim = await newClaim(store);
    const first = await store.claim(claim);
    await expect(store.findRequest('other-scope', first.record.receipt.receiptId)).resolves.toBeNull();
    await expect(store.findByClientId(videoClaims.enterpriseId, claim.clientRequestId, 'other-scope', true)).rejects.toMatchObject(code('IDEMPOTENCY_CONFLICT'));
    db.state.requests.get(first.record.receipt.receiptId).configuration.adapter = 'static-video-v1';
    await expect(store.findByClientId(videoClaims.enterpriseId, claim.clientRequestId, scope, true)).rejects.toMatchObject(code('IDEMPOTENCY_CONFLICT'));
  });

  it('uses CAS and does not overwrite the winning task ID or receipt state', async () => {
    const { record } = await store.claim(await newClaim(store));
    const winner = structuredClone(record);
    winner.configuration.upstreamTaskId = 'original-task';
    winner.configuration.upstreamRequestId = 'billing-id';
    winner.configuration.dispatchState = 'ACCEPTED';
    winner.receipt.status = 'QUEUED'; winner.receipt.billingStatus = 'RESERVED';
    expect((await store.save(winner)).updated).toBe(true);
    const loser = await store.save(record);
    expect(loser.updated).toBe(false);
    expect(loser.record.configuration.upstreamTaskId).toBe('original-task');
  });

  it('retries a rolled-back save serialization failure with the original revision', async () => {
    const { record } = await store.claim(await newClaim(store));
    db.$transaction.mockClear();
    db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('retry', { code: 'P2034', clientVersion: 'test' }));
    const result = await store.save(record);
    expect(result.updated).toBe(true);
    expect(result.record.revision).toBe(1);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it('keeps the winner after a stale save serialization failure', async () => {
    const { record } = await store.claim(await newClaim(store));
    const winner = structuredClone(record);
    winner.configuration.upstreamTaskId = 'original-task';
    winner.configuration.upstreamRequestId = 'billing-id';
    winner.configuration.dispatchState = 'ACCEPTED';
    winner.receipt.status = 'QUEUED'; winner.receipt.billingStatus = 'RESERVED';
    await store.save(winner);
    db.$transaction.mockClear();
    db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('retry', { code: 'P2034', clientVersion: 'test' }));
    const result = await store.save(record);
    expect(result.updated).toBe(false);
    expect(result.record.configuration.upstreamTaskId).toBe('original-task');
    expect(result.record.revision).toBe(1);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it('bounds save retries and preserves storage failure on exhaustion', async () => {
    const { record } = await store.claim(await newClaim(store));
    db.$transaction.mockClear();
    db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('retry', { code: 'P2034', clientVersion: 'test' }));
    await expect(store.save(record)).rejects.toMatchObject(code('MEDIA_STORAGE_UNAVAILABLE'));
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    expect(db.state.requests.get(record.receipt.receiptId).revision).toBe(0);
  });

  it('rejects corrupted private metadata and never silently substitutes a model', async () => {
    const { record } = await store.claim(await newClaim(store));
    db.state.requests.get(record.receipt.receiptId).configuration.modelId = 'other';
    await expect(store.findRequest(scope, record.receipt.receiptId)).rejects.toMatchObject(code('MEDIA_STORAGE_UNAVAILABLE'));
  });

  it('retries serialization failures without making any upstream call', async () => {
    const input = await newClaim(store);
    db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('retry', { code: 'P2034', clientVersion: 'test' }));
    await expect(store.claim(input)).resolves.toMatchObject({ created: true });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });
});
