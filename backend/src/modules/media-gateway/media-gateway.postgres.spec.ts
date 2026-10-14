import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { MediaGatewayQuoteRequestSchema, MediaGatewayRequestSchema } from 'shared';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import { MediaGatewayMockAdapter, MEDIA_MOCK_PNG } from './media-gateway-mock.adapter';
import { MediaGatewayService } from './media-gateway.service';
import { MediaGatewayStore } from './media-gateway.store';

// Never fall back to DATABASE_URL: integration tests must explicitly target a disposable local DB.
const databaseUrl = process.env.MEDIA_GATEWAY_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/sep_media_mock_[a-z0-9_]+$/.test(url.pathname)) {
    throw new Error('MEDIA_GATEWAY_TEST_DATABASE_URL must name a local sep_media_mock_* database');
  }
}
const databaseSuite = databaseUrl ? describe : describe.skip;

databaseSuite('Media gateway PostgreSQL durability and idempotency', () => {
  const clients: PrismaClient[] = [];
  let first: PrismaClient;
  let second: PrismaClient;
  let stores: MediaGatewayStore[];
  let services: MediaGatewayService[];
  let adapters: MediaGatewayMockAdapter[];
  let claims: ClientEmploymentClaims;
  const enterprises: string[] = [];
  const config = { get: (key: string) => ({ NODE_ENV: 'test', MEDIA_GATEWAY_MOCK_ENABLED: 'true' })[key] } as ConfigService;
  const authorization = {
    enterpriseMember: { findFirst: async () => ({ departmentId: null }) },
    subscription: { findFirst: async () => ({ id: 'subscription' }) },
  } as unknown as PrismaService;

  beforeAll(async () => {
    first = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    clients.push(first, second);
    await Promise.all(clients.map((client) => client.$connect()));
  });
  beforeEach(() => {
    claims = {
      sub: 'user', sid: 'session', enterpriseId: `media-test-${randomUUID()}`, subscriptionId: 'subscription',
      memberId: 'member', type: 'client-employment', iat: 1, exp: 9999999999,
    };
    enterprises.push(claims.enterpriseId);
    stores = [first, second].map((client) => new MediaGatewayStore(client as unknown as PrismaService));
    adapters = [new MediaGatewayMockAdapter(), new MediaGatewayMockAdapter()];
    services = stores.map((store, index) => new MediaGatewayService(config, authorization, adapters[index], store));
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    try {
      // Remove only rows belonging to this test run, never all tables or other test runs.
      await first?.mediaGatewayRequest.deleteMany({ where: { enterpriseId: { in: enterprises } } });
      const scopes = enterprises.map((id) => JSON.stringify([id, 'subscription', 'member', 'user']));
      await first?.mediaGatewayReference.deleteMany({ where: { scope: { in: scopes } } });
      await first?.mediaGatewayQuote.deleteMany({ where: { scope: { in: scopes } } });
    } finally {
      await Promise.all(clients.map((client) => client.$disconnect()));
    }
  });

  async function request(profileId = 'mock-sync', referenceIds: string[] = []) {
    const input = MediaGatewayQuoteRequestSchema.parse({
      profileId, configVersion: 'mock-v1', operation: referenceIds.length ? 'edit' : 'generate',
      creativeBrief: 'Private product prompt must never be persisted', referenceIds,
    });
    const quote = await services[0].quote(claims, input);
    return MediaGatewayRequestSchema.parse({ ...input, quoteId: quote.quoteId, clientRequestId: randomUUID() });
  }
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  }

  it('uses the database unique key across independent connections, with exactly one mock submit', async () => {
    const input = await request();
    // Force both reads to miss so the real INSERT unique conflict path is exercised.
    const bothRead = deferred<void>();
    let reads = 0;
    for (const store of stores) {
      const find = store.findByClientId.bind(store);
      jest.spyOn(store, 'findByClientId').mockImplementationOnce(async (...args) => {
        const result = await find(...args);
        if (++reads === 2) bothRead.resolve();
        await bothRead.promise;
        return result;
      });
    }
    const submit = adapters.map((adapter) => jest.spyOn(adapter, 'submit'));
    const results = await Promise.all(services.map((service) => service.submit(claims, input)));
    expect(results[0].receiptId).toBe(results[1].receiptId);
    expect(submit.reduce((total, spy) => total + spy.mock.calls.length, 0)).toBe(1);
    expect(await first.mediaGatewayRequest.count({ where: { enterpriseId: claims.enterpriseId } })).toBe(1);
  });

  it('restores reference, quote, frozen configuration, receipt and static download on a fresh instance', async () => {
    const ref = await services[0].uploadReference(claims, {
      originalname: 'fixture.png', buffer: MEDIA_MOCK_PNG, size: MEDIA_MOCK_PNG.length, mimetype: 'image/png',
    } as Express.Multer.File);
    const input = await request('mock-sync', [ref.referenceId]);
    const receipt = await services[1].submit(claims, input);
    const restarted = new MediaGatewayService(config, authorization, new MediaGatewayMockAdapter(), new MediaGatewayStore(first as unknown as PrismaService));
    expect(await restarted.findByClientId(claims, input.clientRequestId)).toEqual(receipt);
    expect((await restarted.content(claims, receipt.receiptId, receipt.outputs[0].outputId)).bytes).toEqual(MEDIA_MOCK_PNG);
    const row = await first.mediaGatewayRequest.findUniqueOrThrow({ where: { id: receipt.receiptId } });
    expect(row.configuration).toMatchObject({ adapter: 'static-png-v1', pricingVersion: 'mock-v1', amountCny: '0.010000' });
    expect(JSON.stringify(row)).not.toContain(input.creativeBrief);
    expect(JSON.stringify(row)).not.toContain(MEDIA_MOCK_PNG.toString('base64'));
    expect(await stores[1].findReference(ref.referenceId)).toMatchObject({ value: ref });
  });

  it('rejects semantic conflicts and cross-member replay while retaining the original key', async () => {
    const input = await request();
    await services[0].submit(claims, input);
    await expect(services[1].submit(claims, { ...input, creativeBrief: 'Changed' })).rejects.toMatchObject({ status: 409 });
    await expect(services[1].submit({ ...claims, memberId: 'other' }, input)).rejects.toMatchObject({ status: 404 });
    expect(await first.mediaGatewayRequest.count({ where: { enterpriseId: claims.enterpriseId } })).toBe(1);
  });

  it('allows the same client ID in a different enterprise without sharing receipts', async () => {
    const input = await request();
    const original = await services[0].submit(claims, input);
    const other = { ...claims, enterpriseId: `media-test-${randomUUID()}` };
    enterprises.push(other.enterpriseId);
    const { quoteId: _quoteId, clientRequestId: _clientRequestId, ...quoteInput } = input;
    const quote = await services[1].quote(other, quoteInput);
    const receipt = await services[1].submit(other, { ...input, quoteId: quote.quoteId });
    expect(receipt.receiptId).not.toBe(original.receiptId);
  });

  it('persists UNKNOWN after a stale claim and never resends or accepts late completion', async () => {
    const input = await request();
    const entered = deferred<void>();
    const finish = deferred<'SUCCEEDED'>();
    const submit = jest.spyOn(adapters[0], 'submit').mockImplementation(async () => {
      entered.resolve(); return finish.promise;
    });
    const pending = services[0].submit(claims, input);
    await entered.promise;
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 120_001);
    const recovered = await services[1].findByClientId(claims, input.clientRequestId);
    expect(recovered.status).toBe('SUBMISSION_UNKNOWN');
    finish.resolve('SUCCEEDED');
    expect((await pending).status).toBe('SUBMISSION_UNKNOWN');
    expect((await services[1].submit(claims, input)).status).toBe('SUBMISSION_UNKNOWN');
    expect(submit).toHaveBeenCalledTimes(1);
    expect((await stores[1].findRequest(recovered.receiptId))?.receipt.status).toBe('SUBMISSION_UNKNOWN');
  });

  it('does not overwrite cancellation with a stale query from another instance', async () => {
    const input = await request('mock-async');
    const receipt = await services[0].submit(claims, input);
    const entered = deferred<void>();
    const finish = deferred<'RUNNING'>();
    jest.spyOn(adapters[0], 'query').mockImplementation(async () => { entered.resolve(); return finish.promise; });
    const pending = services[0].receipt(claims, receipt.receiptId);
    await entered.promise;
    expect((await services[1].cancel(claims, receipt.receiptId)).status).toBe('CANCELLED');
    finish.resolve('RUNNING');
    expect((await pending).status).toBe('CANCELLED');
    expect((await stores[0].findRequest(receipt.receiptId))?.receipt.status).toBe('CANCELLED');
  });

  it('merges cross-instance query transitions by revision rather than advancing twice', async () => {
    const input = await request('mock-async');
    const receipt = await services[0].submit(claims, input);
    const bothEntered = deferred<void>();
    let entered = 0;
    for (const adapter of adapters) jest.spyOn(adapter, 'query').mockImplementation(async () => {
      if (++entered === 2) bothEntered.resolve();
      await bothEntered.promise; return 'RUNNING';
    });
    const results = await Promise.all(services.map((service) => service.receipt(claims, receipt.receiptId)));
    expect(results.map((result) => result.status)).toEqual(['RUNNING', 'RUNNING']);
    expect((await stores[0].findRequest(receipt.receiptId))?.revision).toBe(2);
  });

  it('retains an ambiguously committed insert without invoking the adapter or retrying', async () => {
    const input = await request();
    const submit = jest.spyOn(adapters[0], 'submit');
    const ambiguousCreate = jest.fn(async (args: Prisma.MediaGatewayRequestCreateArgs) => {
        await first.mediaGatewayRequest.create(args);
        throw new Error('insert committed but acknowledgement lost');
    });
    const ambiguousPrisma = { mediaGatewayQuote: first.mediaGatewayQuote, mediaGatewayRequest: {
      findUnique: (args: Prisma.MediaGatewayRequestFindUniqueArgs) => first.mediaGatewayRequest.findUnique(args),
      create: ambiguousCreate,
    } } as unknown as PrismaService;
    services[0] = new MediaGatewayService(config, authorization, adapters[0], new MediaGatewayStore(ambiguousPrisma));
    await expect(services[0].submit(claims, input)).rejects.toMatchObject({ status: 503, response: { error: { code: 'MEDIA_STORAGE_UNAVAILABLE' } } });
    expect(ambiguousCreate).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
    expect((await services[1].submit(claims, input)).status).toBe('SUBMITTING');
    expect(await first.mediaGatewayRequest.count({ where: { enterpriseId: claims.enterpriseId } })).toBe(1);
  });

  it('does not resubmit when adapter success cannot be saved to the database', async () => {
    const input = await request();
    const submit = jest.spyOn(adapters[0], 'submit');
    jest.spyOn(first.mediaGatewayRequest, 'updateMany').mockRejectedValueOnce(new Error('write unavailable'));
    await expect(services[0].submit(claims, input)).rejects.toMatchObject({ status: 503 });
    expect((await services[1].findByClientId(claims, input.clientRequestId)).status).toBe('SUBMITTING');
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 120_001);
    expect((await services[1].submit(claims, input)).status).toBe('SUBMISSION_UNKNOWN');
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('keeps the original key when an insert commits after its caller already received a storage error', async () => {
    const input = await request();
    const release = deferred<void>();
    let lateCommit!: Promise<unknown>;
    const delayedPrisma = { mediaGatewayQuote: first.mediaGatewayQuote, mediaGatewayRequest: {
      findUnique: (args: Prisma.MediaGatewayRequestFindUniqueArgs) => first.mediaGatewayRequest.findUnique(args),
      create: async (args: Prisma.MediaGatewayRequestCreateArgs) => {
        lateCommit = release.promise.then(() => first.mediaGatewayRequest.create(args));
        throw new Error('caller timed out while database transaction was pending');
      },
    } } as unknown as PrismaService;
    const uncertain = new MediaGatewayService(config, authorization, adapters[0], new MediaGatewayStore(delayedPrisma));
    const submit = jest.spyOn(adapters[0], 'submit');
    await expect(uncertain.submit(claims, input)).rejects.toMatchObject({ status: 503 });
    await expect(services[1].findByClientId(claims, input.clientRequestId)).rejects.toMatchObject({ status: 404 });
    release.resolve();
    await lateCommit;
    expect((await services[1].submit(claims, input)).status).toBe('SUBMITTING');
    expect(submit).not.toHaveBeenCalled();
    expect(await first.mediaGatewayRequest.count({ where: { enterpriseId: claims.enterpriseId } })).toBe(1);
  });

  it('recovers a committed completion even if the final write acknowledgement is lost', async () => {
    const input = await request();
    const completionPrisma = { mediaGatewayQuote: first.mediaGatewayQuote, mediaGatewayRequest: {
      findUnique: (args: Prisma.MediaGatewayRequestFindUniqueArgs) => first.mediaGatewayRequest.findUnique(args),
      create: (args: Prisma.MediaGatewayRequestCreateArgs) => first.mediaGatewayRequest.create(args),
      updateMany: async (args: Prisma.MediaGatewayRequestUpdateManyArgs) => {
        await first.mediaGatewayRequest.updateMany(args);
        throw new Error('completion committed but acknowledgement lost');
      },
    } } as unknown as PrismaService;
    const uncertain = new MediaGatewayService(config, authorization, adapters[0], new MediaGatewayStore(completionPrisma));
    const submit = jest.spyOn(adapters[0], 'submit');
    await expect(uncertain.submit(claims, input)).rejects.toMatchObject({ status: 503 });
    const recovered = await services[1].submit(claims, input);
    expect(recovered.status).toBe('SUCCEEDED');
    expect((await services[1].content(claims, recovered.receiptId, recovered.outputs[0].outputId)).bytes).toEqual(MEDIA_MOCK_PNG);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('never dispatches a successful database claim whose acknowledgement arrives after the deadline', async () => {
    const input = await request('mock-async');
    const original = stores[0].claim.bind(stores[0]);
    jest.spyOn(stores[0], 'claim').mockImplementationOnce(async (claim) => {
      const result = await original(claim);
      jest.spyOn(Date, 'now').mockReturnValue(result.record.submissionDeadline.getTime() + 1);
      return result;
    });
    const submit = jest.spyOn(adapters[0], 'submit');
    expect((await services[0].submit(claims, input)).status).toBe('SUBMISSION_UNKNOWN');
    expect((await services[1].findByClientId(claims, input.clientRequestId)).status).toBe('SUBMISSION_UNKNOWN');
    expect(submit).not.toHaveBeenCalled();
  });

  it('replays frozen references after reference and quote expiry, without bypassing new-request validation', async () => {
    const ref = await services[0].uploadReference(claims, {
      originalname: 'fixture.png', buffer: MEDIA_MOCK_PNG, size: MEDIA_MOCK_PNG.length, mimetype: 'image/png',
    } as Express.Multer.File);
    const input = await request('mock-sync', [ref.referenceId]);
    const receipt = await services[0].submit(claims, input);
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(ref.expiresAt) + 1);
    expect((await services[1].submit(claims, input)).receiptId).toBe(receipt.receiptId);
    const { quoteId: _quoteId, clientRequestId: _clientRequestId, ...quoteInput } = input;
    await expect(services[1].quote(claims, quoteInput)).rejects.toMatchObject({ status: 410 });
  });

  it('fails closed on database read failure without leaking connection details', async () => {
    const input = await request();
    const submit = jest.spyOn(adapters[0], 'submit');
    jest.spyOn(first.mediaGatewayRequest, 'findUnique').mockRejectedValueOnce(new Error('private database URL'));
    await expect(services[0].submit(claims, input)).rejects.toMatchObject({
      status: 503, response: { error: { code: 'MEDIA_STORAGE_UNAVAILABLE', source: 'platform' } },
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects corrupt frozen configuration instead of executing with an unchecked database snapshot', async () => {
    const input = await request('mock-async');
    const receipt = await services[0].submit(claims, input);
    await first.mediaGatewayRequest.update({ where: { id: receipt.receiptId }, data: {
      configuration: { adapter: 'unknown-adapter', profileId: 'real-model' },
    } });
    const query = jest.spyOn(adapters[1], 'query');
    await expect(services[1].receipt(claims, receipt.receiptId)).rejects.toMatchObject({ status: 503 });
    expect(query).not.toHaveBeenCalled();
  });
});
