import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import type { PrismaService } from '../../prisma/prisma.service';
import { MediaRealBillingService } from './media-real-billing.service';
import { MediaRealStore, type RealRequestRecord } from './media-real.store';

// Never fall back to DATABASE_URL: only an explicitly named disposable local database is accepted.
const databaseUrl = process.env.MEDIA_REAL_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1'].includes(url.hostname) || !/^\/sep_media_real_[a-z0-9_]+$/.test(url.pathname)) {
    throw new Error('MEDIA_REAL_TEST_DATABASE_URL must target localhost/127.0.0.1 and a sep_media_real_* database');
  }
}
const postgresSuite = databaseUrl ? describe : describe.skip;

const HASH = 'a'.repeat(64);
const requestRecord = (claims: ClientEmploymentClaims, clientRequestId: string): Omit<RealRequestRecord, 'id' | 'revision'> => ({
  enterpriseId: claims.enterpriseId,
  clientRequestId,
  quoteId: `quote-${clientRequestId}`,
  upstreamRequestId: null,
  scope: `${claims.enterpriseId}:${claims.sub}:${claims.subscriptionId}`,
  semanticSha256: HASH,
  referenceIds: [],
  referenceHashes: [],
  count: 1,
  configuration: {
    profileId: 'profile-test', configVersion: 'config-test', operation: 'generate',
    parameters: { count: 1, size: '1024x1024', quality: 'medium' },
  },
  receipt: {
    mock: false, receiptId: 'pending', clientRequestId, profileId: 'profile-test', configVersion: 'config-test',
    executionMode: 'sync-response', status: 'SUBMITTING', pollAfterMs: null, outputs: [], billingStatus: 'RESERVED',
    errorCode: null, outputErrors: [], recovery: { canQuery: true, canCancel: false, canDownload: false },
  },
  submissionDeadline: new Date(Date.now() + 60_000),
});

postgresSuite('Media real PostgreSQL claim and billing integration', () => {
  const clients: PrismaClient[] = [];
  let first: PrismaClient;
  let second: PrismaClient;
  let claims: ClientEmploymentClaims;
  let storeA: MediaRealStore;
  let storeB: MediaRealStore;
  let billing: MediaRealBillingService;
  let billingB: MediaRealBillingService;
  let employeeId: string;
  let subscriptionId: string;

  beforeAll(async () => {
    first = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    clients.push(first, second);
    await Promise.all(clients.map(client => client.$connect()));
  });

  beforeEach(async () => {
    const suffix = randomUUID().replace(/-/g, '');
    const userId = `media-real-it-user-${suffix}`;
    const enterpriseId = `media-real-it-enterprise-${suffix}`;
    employeeId = `media-real-it-employee-${suffix}`;
    subscriptionId = `media-real-it-subscription-${suffix}`;
    claims = {
      sub: userId, sid: `session-${suffix}`, enterpriseId, subscriptionId,
      memberId: `member-${suffix}`, type: 'client-employment', iat: 1, exp: 9_999_999_999,
    };
    await first.enterprise.create({ data: { id: enterpriseId, name: `Media real integration ${suffix}` } });
    await first.user.create({ data: { id: userId, email: `${suffix}@media-real.invalid` } });
    await first.digitalEmployee.create({ data: {
      id: employeeId, name: `Media real integration ${suffix}`, description: 'Integration fixture',
      industry: 'testing', position: 'integration', systemPrompt: 'Integration fixture',
    } });
    await first.subscription.create({ data: {
      id: subscriptionId, enterpriseId, employeeId, templateVersion: 'integration-test',
    } });
    await first.personalWallet.create({ data: { userId, balance: '10.000000' } });
    storeA = new MediaRealStore(first as unknown as PrismaService);
    storeB = new MediaRealStore(second as unknown as PrismaService);
    billing = new MediaRealBillingService(first as unknown as PrismaService);
    billingB = new MediaRealBillingService(second as unknown as PrismaService);
  });

  afterEach(async () => {
    if (!first || !claims) return;
    // Delete only this test's randomly named tenant and its fixtures.
    await first.computeUsageRecord.deleteMany({ where: { enterpriseId: claims.enterpriseId } });
    await first.mediaRealBillingReservation.deleteMany({ where: { enterpriseId: claims.enterpriseId } });
    await first.mediaRealRequest.deleteMany({ where: { enterpriseId: claims.enterpriseId } });
    await first.personalWallet.deleteMany({ where: { userId: claims.sub } });
    await first.subscription.deleteMany({ where: { id: subscriptionId } });
    await first.digitalEmployee.deleteMany({ where: { id: employeeId } });
    await first.user.deleteMany({ where: { id: claims.sub } });
    await first.enterprise.deleteMany({ where: { id: claims.enterpriseId } });
  });

  afterAll(async () => {
    await Promise.all(clients.map(client => client.$disconnect()));
  });

  it('uniquely claims a clientRequestId and allows only one CAS update at a revision', async () => {
    const input = requestRecord(claims, randomUUID());
    const [left, right] = await Promise.all([storeA.claim(input), storeB.claim(input)]);

    expect(left.record.id).toBe(right.record.id);
    expect([left.record.revision, right.record.revision]).toEqual([0, 0]);
    expect(left.record.receipt.receiptId).toBe(left.record.id);
    expect(right.record.receipt.receiptId).toBe(right.record.id);
    expect([left.created, right.created].sort()).toEqual([false, true]);
    expect(await first.mediaRealRequest.count({ where: { enterpriseId: claims.enterpriseId, clientRequestId: input.clientRequestId } })).toBe(1);

    const contenders = await Promise.all([
      storeA.save(left.record, 'upstream-a'),
      storeB.save(right.record, 'upstream-b'),
    ]);
    expect(contenders.map(record => record.revision)).toEqual([1, 1]);
    const persisted = await storeA.findByClientId(claims.enterpriseId, input.clientRequestId);
    expect(persisted?.revision).toBe(1);
    expect(['upstream-a', 'upstream-b']).toContain(persisted?.upstreamRequestId);
    expect(contenders.map(record => record.upstreamRequestId)).toEqual([
      persisted?.upstreamRequestId, persisted?.upstreamRequestId,
    ]);
    const staleRetry = await storeB.save(right.record, 'stale-retry');
    expect(staleRetry.revision).toBe(1);
    expect(staleRetry.upstreamRequestId).toBe(persisted?.upstreamRequestId);
  });

  it('prevents concurrent over-reservation and keeps settle/release retries idempotent', async () => {
    const receipts = [randomUUID(), randomUUID()];
    const attempts = await Promise.allSettled([
      billing.reserve(claims, receipts[0], '7.000000', 7),
      billingB.reserve(claims, receipts[1], '7.000000', 7),
    ]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ status: 402, response: { error: { code: 'INSUFFICIENT_FUNDS' } } });
    expect(await first.mediaRealBillingReservation.count({ where: { enterpriseId: claims.enterpriseId } })).toBe(1);

    const winner = receipts[attempts.findIndex(result => result.status === 'fulfilled')];
    await billing.reserve(claims, winner, '7.000000', 7);
    let wallet = await first.personalWallet.findUniqueOrThrow({ where: { userId: claims.sub } });
    expect(wallet.balance.toFixed(6)).toBe('3.000000');
    expect(await first.personalWalletTransaction.count({ where: { relatedId: winner, type: 'CONSUME' } })).toBe(1);

    await expect(billing.settle(winner, '4.000000', '0.571429', 'gpt-image-2')).resolves.toBe('SETTLED');
    await expect(billing.settle(winner, '4.000000', '0.571429', 'gpt-image-2')).resolves.toBe('SETTLED');
    wallet = await first.personalWallet.findUniqueOrThrow({ where: { userId: claims.sub } });
    expect(wallet.balance.toFixed(6)).toBe('6.000000');
    expect(wallet.totalConsumeCNY.toFixed(6)).toBe('4.000000');
    expect(await first.personalWalletTransaction.count({ where: { relatedId: winner, type: 'REFUND' } })).toBe(1);
    expect(await first.computeUsageRecord.count({ where: { idempotencyKey: `media-real:${winner}` } })).toBe(1);
    expect(await first.computeUsageRecord.findUnique({ where: { idempotencyKey: `media-real:${winner}` } }))
      .toMatchObject({ modelId: 'gpt-image-2', employeeId });

    const releaseReceipt = randomUUID();
    await billing.reserve(claims, releaseReceipt, '2.000000', 7);
    await billing.release(releaseReceipt);
    await billing.release(releaseReceipt);
    wallet = await first.personalWallet.findUniqueOrThrow({ where: { userId: claims.sub } });
    expect(wallet.balance.toFixed(6)).toBe('6.000000');
    expect(wallet.totalConsumeCNY.toFixed(6)).toBe('4.000000');
    expect(await first.personalWalletTransaction.count({ where: { relatedId: releaseReceipt, type: 'CONSUME' } })).toBe(1);
    expect(await first.personalWalletTransaction.count({ where: { relatedId: releaseReceipt, type: 'REFUND' } })).toBe(1);
  });

  it('reserves, settles and refunds the same receipt only once across independent connections', async () => {
    const id = randomUUID();
    await Promise.all([billing.reserve(claims, id, '7.000000', 7), billingB.reserve(claims, id, '7.000000', 7)]);
    expect(await first.mediaRealBillingReservation.count({ where: { receiptId: id } })).toBe(1);
    expect(await first.personalWalletTransaction.count({ where: { relatedId: id, type: 'CONSUME' } })).toBe(1);
    await expect(billingB.reserve(claims, id, '8.000000', 7)).rejects.toMatchObject({
      response: { error: { code: 'IDEMPOTENCY_CONFLICT' } },
    });
    await expect(Promise.all([
      billing.settle(id, '4.000000', '0.571429', 'gpt-image-2'), billingB.settle(id, '4.000000', '0.571429', 'gpt-image-2'),
    ])).resolves.toEqual(['SETTLED', 'SETTLED']);
    await expect(billing.settle(id, '5.000000', '0.714286', 'gpt-image-2')).rejects.toMatchObject({
      response: { error: { code: 'IDEMPOTENCY_CONFLICT' } },
    });
    const wallet = await first.personalWallet.findUniqueOrThrow({ where: { userId: claims.sub } });
    expect(wallet.balance.toFixed(6)).toBe('6.000000');
    expect(wallet.totalConsumeCNY.toFixed(6)).toBe('4.000000');
    expect(await first.personalWalletTransaction.count({ where: { relatedId: id, type: 'REFUND' } })).toBe(1);
    expect(await first.computeUsageRecord.count({ where: { idempotencyKey: `media-real:${id}` } })).toBe(1);
  });

  it('releases a reservation concurrently without double refunding', async () => {
    const id = randomUUID();
    await billing.reserve(claims, id, '7.000000', 7);
    await Promise.all([billing.release(id), billingB.release(id)]);
    await billing.release(id);
    const wallet = await first.personalWallet.findUniqueOrThrow({ where: { userId: claims.sub } });
    expect(wallet.balance.toFixed(6)).toBe('10.000000');
    expect(wallet.totalConsumeCNY.toFixed(6)).toBe('0.000000');
    expect(await billing.status(id)).toBe('RELEASED');
    expect(await first.personalWalletTransaction.count({ where: { relatedId: id, type: 'REFUND' } })).toBe(1);
    expect(await first.computeUsageRecord.count({ where: { idempotencyKey: `media-real:${id}` } })).toBe(0);
  });

  it.each(['settle', 'release'] as const)('refunds all three real funding sources on %s without duplicate mutations', async action => {
    const credit = await first.subscriptionCredit.create({ data: {
      enterpriseId: claims.enterpriseId, subscriptionId, employeeId, grantedCNY: '3.000000',
    } });
    const topUp = await first.memberAllowanceTopUp.create({ data: {
      enterpriseId: claims.enterpriseId, userId: claims.sub, amountCNY: '4.000000',
    } });
    const id = randomUUID();
    await billing.reserve(claims, id, '9.000000', 7);
    const reserved = await first.mediaRealBillingReservation.findUniqueOrThrow({ where: { receiptId: id } });
    expect([reserved.creditCny, reserved.memberWalletCny, reserved.personalCny].map(value => value.toFixed(6)))
      .toEqual(['3.000000', '4.000000', '2.000000']);
    expect((await first.subscriptionCredit.findUniqueOrThrow({ where: { id: credit.id } })).usedCNY.toFixed(6)).toBe('3.000000');
    expect((await first.memberAllowanceTopUp.findUniqueOrThrow({ where: { id: topUp.id } })).consumedCNY.toFixed(6)).toBe('4.000000');
    if (action === 'settle') {
      await billing.settle(id, '1.000000', '0.142857', 'gpt-image-2');
      await billingB.settle(id, '1.000000', '0.142857', 'gpt-image-2');
    } else {
      await billing.release(id);
      await billingB.release(id);
    }
    const updatedCredit = await first.subscriptionCredit.findUniqueOrThrow({ where: { id: credit.id } });
    const updatedTopUp = await first.memberAllowanceTopUp.findUniqueOrThrow({ where: { id: topUp.id } });
    const wallet = await first.personalWallet.findUniqueOrThrow({ where: { userId: claims.sub } });
    expect(updatedCredit.usedCNY.toFixed(6)).toBe(action === 'settle' ? '1.000000' : '0.000000');
    expect(updatedCredit.status).toBe('ACTIVE');
    expect(updatedTopUp.consumedCNY.toFixed(6)).toBe('0.000000');
    expect(wallet.balance.toFixed(6)).toBe('10.000000');
    expect(wallet.totalConsumeCNY.toFixed(6)).toBe('0.000000');
    expect(await first.personalWalletTransaction.count({ where: { relatedId: id, type: 'REFUND' } })).toBe(1);
    expect(await first.computeUsageRecord.count({ where: { idempotencyKey: `media-real:${id}` } })).toBe(action === 'settle' ? 1 : 0);
  });
});
