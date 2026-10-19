import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import { MediaVideoGatewayService } from './media-video-gateway.service';
import { MediaVideoGatewayStore } from './media-video-gateway.store';
import { videoFile, videoInput } from './media-video-gateway.test-support';
import fixture from '../../shared/fixtures/media-video-v1.json';

// Never fall back to DATABASE_URL: only an explicitly named disposable local DB is accepted.
const databaseUrl = process.env.MEDIA_VIDEO_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/sep_media_video_[a-z0-9_]+$/.test(url.pathname)) {
    throw new Error('MEDIA_VIDEO_TEST_DATABASE_URL must target localhost/127.0.0.1 and a sep_media_video_* database');
  }
}
const databaseSuite = databaseUrl ? describe : describe.skip;

databaseSuite('Media video gateway isolated PostgreSQL persistence', () => {
  const clients: PrismaClient[] = [];
  const enterprises = new Set<string>();
  let first: PrismaClient;
  let second: PrismaClient;
  let stores: MediaVideoGatewayStore[];
  let services: MediaVideoGatewayService[];
  let claims: ClientEmploymentClaims;
  const authorization = {
    enterpriseMember: { findFirst: async () => ({ departmentId: null }) },
    subscription: { findFirst: async () => ({ id: 'video-test-subscription' }) },
  } as unknown as PrismaService;

  beforeAll(async () => {
    first = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    clients.push(first, second);
    await Promise.all(clients.map(client => client.$connect()));
  });

  beforeEach(() => {
    claims = {
      sub: 'video-test-user', sid: 'video-test-session', enterpriseId: `video-test-${randomUUID()}`,
      subscriptionId: 'video-test-subscription', memberId: 'video-test-member',
      type: 'client-employment', iat: 1, exp: 9999999999,
    };
    enterprises.add(claims.enterpriseId);
    stores = [first, second].map(client => new MediaVideoGatewayStore(client as unknown as PrismaService));
    services = stores.map(store => new MediaVideoGatewayService(authorization, store));
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    try {
      const scopes = [...enterprises].map(id => JSON.stringify([id, claims.subscriptionId, claims.memberId, claims.sub]));
      await first?.mediaGatewayRequest.deleteMany({ where: { enterpriseId: { in: [...enterprises] } } });
      await first?.mediaGatewayReference.deleteMany({ where: { scope: { in: scopes } } });
      await first?.mediaGatewayQuote.deleteMany({ where: { scope: { in: scopes } } });
    } finally {
      await Promise.all(clients.map(client => client.$disconnect()));
    }
  });

  async function prepare(service = services[0], owner = claims, clientRequestId = randomUUID()) {
    const reference = await service.reference(owner, videoFile());
    const input = videoInput(reference.referenceId);
    const quote = await service.quote(owner, input);
    return { ...input, quoteId: quote.quoteId, clientRequestId };
  }

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  }

  it('deduplicates concurrent submits across independent Prisma clients at the database unique key', async () => {
    const input = await prepare();
    const bothRead = deferred();
    let reads = 0;
    for (const store of stores) {
      const find = store.findByClientId.bind(store);
      jest.spyOn(store, 'findByClientId').mockImplementation(async (...args) => {
        const result = await find(...args);
        if (++reads === 2) bothRead.resolve();
        await bothRead.promise;
        return result;
      });
    }

    const receipts = await Promise.all(services.map(service => service.submit(claims, input)));
    expect(receipts[0].receiptId).toBe(receipts[1].receiptId);
    expect(receipts.map(receipt => receipt.status)).toEqual(['QUEUED', 'QUEUED']);
    expect(await first.mediaGatewayRequest.count({ where: { enterpriseId: claims.enterpriseId } })).toBe(1);
  });

  it('keeps semantic requests immutable and recovers the original receipt in a fresh service instance', async () => {
    const input = await prepare();
    const original = await services[0].submit(claims, input);
    await expect(services[1].submit(claims, { ...input, creativeBrief: 'Changed semantic request' }))
      .rejects.toMatchObject({ status: 409 });
    await expect(services[1].findByClientId({ ...claims, memberId: 'other-member' }, input.clientRequestId))
      .rejects.toMatchObject({ status: 404 });

    const restarted = new MediaVideoGatewayService(authorization,
      new MediaVideoGatewayStore(first as unknown as PrismaService));
    expect(await restarted.findByClientId(claims, input.clientRequestId)).toEqual(original);
    expect(await first.mediaGatewayRequest.count({ where: { enterpriseId: claims.enterpriseId } })).toBe(1);
  });

  it('allows the same id in another enterprise without changing the original enterprise receipt', async () => {
    const input = await prepare();
    const original = await services[0].submit(claims, input);
    const otherEnterprise = { ...claims, enterpriseId: `video-test-${randomUUID()}` };
    enterprises.add(otherEnterprise.enterpriseId);
    const otherInput = await prepare(services[1], otherEnterprise, input.clientRequestId);
    const otherReceipt = await services[1].submit(otherEnterprise, otherInput);

    expect(otherReceipt.receiptId).not.toBe(original.receiptId);
    expect((await services[1].findByClientId(claims, input.clientRequestId)).receiptId).toBe(original.receiptId);
    expect((await services[0].findByClientId(otherEnterprise, input.clientRequestId)).receiptId).toBe(otherReceipt.receiptId);
  });

  it('persists CAS poll progression, revision and output content across fresh instances', async () => {
    const input = await prepare();
    const queued = await services[0].submit(claims, input);
    const bothReadQueued = deferred();
    let reads = 0;
    for (const store of stores) {
      const find = store.findRequest.bind(store);
      jest.spyOn(store, 'findRequest').mockImplementation(async (scope, receiptId) => {
        const record = await find(scope, receiptId);
        if (receiptId === queued.receiptId && record?.revision === 0) {
          if (++reads === 2) bothReadQueued.resolve();
          await bothReadQueued.promise;
        }
        return record;
      });
    }

    const concurrentPolls = await Promise.all(services.map(service => service.receipt(claims, queued.receiptId)));
    expect(concurrentPolls.map(receipt => receipt.status)).toEqual(['RUNNING', 'RUNNING']);
    expect((await first.mediaGatewayRequest.findUniqueOrThrow({ where: { id: queued.receiptId } })).revision).toBe(1);

    const restarted = new MediaVideoGatewayService(authorization,
      new MediaVideoGatewayStore(second as unknown as PrismaService));
    const succeeded = await restarted.receipt(claims, queued.receiptId);
    expect(succeeded).toMatchObject({ status: 'SUCCEEDED', recovery: { canDownload: true } });
    expect(succeeded.outputs).toHaveLength(1);
    const content = await restarted.content(claims, queued.receiptId, succeeded.outputs[0].outputId);
    expect(content.bytes).toEqual(Buffer.from(fixture.mediaFixture.base64, 'base64'));
    expect(content.output).toMatchObject({ sha256: fixture.mediaFixture.sha256, byteLength: fixture.mediaFixture.byteLength });

    const persisted = await second.mediaGatewayRequest.findUniqueOrThrow({ where: { id: queued.receiptId } });
    expect(persisted.status).toBe('SUCCEEDED');
    expect(persisted.revision).toBe(2);
    expect((persisted.receipt as Prisma.JsonObject).status).toBe('SUCCEEDED');
    expect(JSON.stringify(persisted)).not.toContain(input.creativeBrief);
  });
});
