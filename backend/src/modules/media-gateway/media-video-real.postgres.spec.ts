import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../prisma/prisma.service';
import { MediaVideoRealStore, type VideoRealClaim, type VideoRealRecord } from './media-video-real.store';
import { input, policy, quoteMetadata } from './media-video-real.test-support';

// Opt-in only. Never read DATABASE_URL or allow a remote/non-disposable database.
const databaseUrl = process.env.MEDIA_VIDEO_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^\/sep_media_video_[a-z0-9_]+$/.test(url.pathname) || url.search || url.hash) {
    throw new Error('MEDIA_VIDEO_TEST_DATABASE_URL must target localhost and a sep_media_video_* database without URL overrides');
  }
}
const databaseSuite = databaseUrl ? describe : describe.skip;

databaseSuite('MediaVideoRealStore isolated PostgreSQL concurrency', () => {
  const clients: PrismaClient[] = [];
  let first: PrismaClient;
  let second: PrismaClient;
  let stores: MediaVideoRealStore[];
  let enterpriseId: string;
  let scope: string;

  beforeAll(async () => {
    first = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    clients.push(first, second);
    await Promise.all(clients.map(client => client.$connect()));
    const connections = await Promise.all(clients.map(client => client.$queryRaw<{ pid: number; database: string }[]>`
      SELECT pg_backend_pid() AS pid, current_database() AS database
    `));
    expect(connections[0][0].pid).not.toBe(connections[1][0].pid);
    expect(connections.map(rows => rows[0].database)).toEqual([new URL(databaseUrl!).pathname.slice(1), new URL(databaseUrl!).pathname.slice(1)]);
  });

  beforeEach(async () => {
    enterpriseId = `video-real-pg-${randomUUID()}`;
    scope = JSON.stringify([enterpriseId, 'test-subscription', 'test-member', 'test-user']);
    await first.enterprise.create({ data: { id: enterpriseId, name: enterpriseId } });
    await first.enterpriseModelConfig.create({ data: { enterpriseId, mediaPolicy: { video: policy } } });
    stores = clients.map(client => new MediaVideoRealStore(client as unknown as PrismaService));
  });

  afterEach(async () => {
    if (!first || !enterpriseId) return;
    await first.mediaRealBillingReservation.deleteMany({ where: { enterpriseId } });
    await first.mediaGatewayRequest.deleteMany({ where: { enterpriseId } });
    await first.mediaGatewayQuote.deleteMany({ where: { scope } });
    await first.enterpriseModelConfig.deleteMany({ where: { enterpriseId } });
    await first.enterprise.deleteMany({ where: { id: enterpriseId } });
  });

  afterAll(async () => { await Promise.all(clients.map(client => client.$disconnect())); });

  async function prepare(clientRequestId = randomUUID()): Promise<VideoRealClaim> {
    const metadata = quoteMetadata();
    const quote = await stores[0].saveQuote(scope, metadata);
    return {
      enterpriseId, scope, clientRequestId, semanticSha256: metadata.value.semanticSha256,
      referenceIds: [], referenceHashes: [], submissionDeadline: new Date(Date.now() + 180_000),
      configuration: { ...metadata.configuration, quoteId: quote.quoteId, upstreamTaskId: null, upstreamRequestId: null,
        dispatchState: 'NOT_DISPATCHED', outputExpiresAt: null },
      receipt: { mock: false, clientRequestId, profileId: input.profileId, configVersion: input.configVersion,
        operation: input.operation, status: 'SUBMITTING', pollAfterMs: 2000, outputs: [], billingStatus: 'NOT_RESERVED',
        amountCny: metadata.value.amountCny, amountUsd: metadata.value.amountUsd, errorCode: null,
        recovery: { canQuery: true, canCancel: false, canDownload: false } },
    };
  }

  async function configure(overrides: Partial<typeof policy>) {
    await first.enterpriseModelConfig.update({ where: { enterpriseId }, data: { mediaPolicy: { video: { ...policy, ...overrides } } } });
  }

  // Delay only the first matching operation on each client. All reads, writes,
  // isolation and serialization failures still come from real PostgreSQL.
  function racingStores(operationToGate: 'findMany' | 'updateMany', onQueryError?: (error: unknown) => void) {
    let arrivals = 0;
    let release!: () => void;
    let reject!: (error: Error) => void;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ready = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
    const wait = async () => {
      if (++arrivals === 2) { clearTimeout(timer); release(); }
      else timer = setTimeout(() => reject(new Error('Both independent transactions must reach the race barrier')), 4000);
      await ready;
    };
    return clients.map(client => {
      let reached = false;
      const observed = client.$extends({ query: { mediaGatewayRequest: {
        async $allOperations({ operation, args, query }) {
          const gate = !reached && operation === operationToGate;
          if (gate) reached = true;
          if (gate && operation === 'updateMany') await wait();
          let result: Awaited<ReturnType<typeof query>>;
          try { result = await query(args); }
          catch (error) { onQueryError?.(error); throw error; }
          if (gate && operation === 'findMany') await wait();
          return result;
        },
      } } });
      return new MediaVideoRealStore(observed as unknown as PrismaService);
    });
  }

  async function assertSingleClaim(attempts: PromiseSettledResult<{ created: boolean; record: VideoRealRecord }>[], errorCode: string) {
    const successes = attempts.filter((result): result is PromiseFulfilledResult<{ created: boolean; record: VideoRealRecord }> => result.status === 'fulfilled');
    const failures = attempts.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(successes[0].value.created).toBe(true);
    expect(failures[0].reason).toMatchObject({ response: { error: { code: errorCode } } });
    expect(await first.mediaGatewayRequest.count({ where: { enterpriseId } })).toBe(1);
    return successes[0].value.record;
  }

  it.each([1, 2, 3])('deduplicates the same key and quote across two concurrent clients (race %s)', async () => {
    const claim = await prepare();
    const racers = racingStores('findMany');
    const results = await Promise.all(racers.map(store => store.claim(claim)));
    expect(results.map(result => result.created).sort()).toEqual([false, true]);
    expect(results[0].record.receipt.receiptId).toBe(results[1].record.receipt.receiptId);
    expect(results.map(result => result.record.revision)).toEqual([0, 0]);
    expect(await first.mediaGatewayRequest.count({ where: { enterpriseId, clientRequestId: claim.clientRequestId } })).toBe(1);
    const quote = await stores[1].findQuote(scope, claim.configuration.quoteId);
    expect(quote?.consumedByClientRequestId).toBe(claim.clientRequestId);
  });

  it.each([1, 2, 3])('consumes one quote once when different keys race (race %s)', async () => {
    const claim = await prepare();
    const other = { ...claim, clientRequestId: randomUUID(), receipt: { ...claim.receipt, clientRequestId: '' } };
    other.receipt.clientRequestId = other.clientRequestId;
    const racers = racingStores('findMany');
    const winner = await assertSingleClaim(await Promise.allSettled([racers[0].claim(claim), racers[1].claim(other)]), 'QUOTE_ALREADY_USED');
    expect((await stores[1].findQuote(scope, claim.configuration.quoteId))?.consumedByClientRequestId).toBe(winner.clientRequestId);
  });

  it.each([1, 2, 3])('cannot exceed maxConcurrentJobs with different quotes (race %s)', async () => {
    await configure({ maxConcurrentJobs: 1, periodBudget: 100 });
    const claims = await Promise.all([prepare(), prepare()]);
    const racers = racingStores('findMany');
    const winner = await assertSingleClaim(await Promise.allSettled(claims.map((claim, index) => racers[index].claim(claim))), 'VIDEO_CONCURRENCY_LIMIT');
    const unused = claims.find(claim => claim.clientRequestId !== winner.clientRequestId)!;
    expect((await stores[0].findQuote(scope, unused.configuration.quoteId))?.consumedByClientRequestId).toBeNull();
  });

  it.each([1, 2, 3])('cannot exceed periodBudget before wallet reservation exists (race %s)', async () => {
    await configure({ maxConcurrentJobs: 8, periodBudget: 2.1 });
    const claims = await Promise.all([prepare(), prepare()]);
    const racers = racingStores('findMany');
    const winner = await assertSingleClaim(await Promise.allSettled(claims.map((claim, index) => racers[index].claim(claim))), 'VIDEO_BUDGET_EXCEEDED');
    expect(await first.mediaRealBillingReservation.count({ where: { enterpriseId } })).toBe(0);
    const rows = await first.mediaGatewayRequest.findMany({ where: { enterpriseId } });
    const liability = rows.reduce((total, row) => total.add((row.configuration as Prisma.JsonObject).amountCny as string), new Prisma.Decimal(0));
    expect(liability.toFixed(6)).toBe(winner.configuration.amountCny);
    expect(liability.lte('2.100000')).toBe(true);
    const unused = claims.find(claim => claim.clientRequestId !== winner.clientRequestId)!;
    expect((await stores[1].findQuote(scope, unused.configuration.quoteId))?.consumedByClientRequestId).toBeNull();
  });

  it('persists CAS state and recovers it after rebuilding clients and stores', async () => {
    const claim = await prepare();
    const { record } = await stores[0].claim(claim);
    const changed = structuredClone(record);
    changed.configuration.dispatchState = 'ACCEPTED';
    changed.configuration.upstreamTaskId = 'original-task';
    changed.configuration.upstreamRequestId = `client:${randomUUID()}`;
    changed.receipt.status = 'QUEUED'; changed.receipt.billingStatus = 'RESERVED';
    const saved = await stores[0].save(changed);
    expect(saved.updated).toBe(true);
    expect(saved.record.revision).toBe(1);
    const stale = await stores[1].save(record);
    expect(stale.updated).toBe(false);
    expect(stale.record).toEqual(saved.record);

    const rebuilt = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      await rebuilt.$connect();
      const recovered = new MediaVideoRealStore(rebuilt as unknown as PrismaService);
      expect(await recovered.findByClientId(enterpriseId, claim.clientRequestId, scope)).toEqual(saved.record);
      expect(await recovered.findRequest(scope, record.receipt.receiptId)).toEqual(saved.record);
      expect(await recovered.hasUniqueUpstreamRequest(saved.record)).toBe(true);
      expect(await recovered.claim(claim)).toEqual({ created: false, record: saved.record });
      expect(await recovered.findRequest('different-scope', record.receipt.receiptId)).toBeNull();
    } finally { await rebuilt.$disconnect(); }
  });

  it('has one CAS winner and returns the winning state to a simultaneous stale writer', async () => {
    const { record } = await stores[0].claim(await prepare());
    const contenders = [structuredClone(record), structuredClone(record)];
    for (const [index, contender] of contenders.entries()) {
      contender.configuration.dispatchState = 'ACCEPTED';
      contender.configuration.upstreamTaskId = `task-${index}`;
      contender.configuration.upstreamRequestId = `client:cas-${index}-${randomUUID()}`;
      contender.receipt.status = 'QUEUED'; contender.receipt.billingStatus = 'RESERVED';
    }
    const databaseErrorCodes: string[] = [];
    const racers = racingStores('updateMany', error => {
      databaseErrorCodes.push(error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'UNKNOWN');
    });
    const outcomes = await Promise.allSettled(contenders.map((contender, index) => racers[index].save(contender)));
    const persisted = await stores[0].findRequest(scope, record.receipt.receiptId);
    expect(persisted?.revision).toBe(1);
    expect(contenders.map(contender => contender.configuration.upstreamTaskId)).toContain(persisted?.configuration.upstreamTaskId);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled' && outcome.value.updated)).toHaveLength(1);
    expect(databaseErrorCodes).toEqual(['P2034']);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toEqual([]);
    const results = outcomes.map(outcome => (outcome as PromiseFulfilledResult<Awaited<ReturnType<MediaVideoRealStore['save']>>>).value);
    expect(results.map(result => result.updated).sort()).toEqual([false, true]);
    expect(results.map(result => result.record)).toEqual([persisted, persisted]);
  });
});
