import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { GatewayExecutionService } from './gateway-execution.service';

const integration = process.env.GATEWAY_DATABASE_TEST_URL ? describe : describe.skip;
integration('Gateway journal on isolated PostgreSQL', () => {
  let prisma: PrismaService;
  let service: GatewayExecutionService;
  let charge: jest.Mock;
  const ids: string[] = [];
  const claims = { sub: 'test-user', enterpriseId: 'test-enterprise', memberId: 'test-member', subscriptionId: 'test-subscription' } as never;
  const usage = { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 };
  const start = async () => {
    const row = await service.start(claims, 'test-employee', 'test-model', 'same-client-request-id');
    ids.push(row.id);
    return row;
  };

  beforeAll(async () => {
    const url = new URL(process.env.GATEWAY_DATABASE_TEST_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.startsWith('/sep_gateway_test')) {
      throw new Error('Gateway integration requires an explicitly isolated local test database');
    }
    prisma = new PrismaService({ datasources: { db: { url: url.toString() } } });
    await prisma.$connect();
  });
  beforeEach(() => {
    charge = jest.fn().mockResolvedValue({ usageRecordId: 'test-ledger-record', alreadyCharged: false });
    service = new GatewayExecutionService(prisma, { chargeUsage: charge } as never, new ConfigService());
  });
  afterAll(async () => {
    try { await prisma.gatewayExecution.deleteMany({ where: { id: { in: ids } } }); }
    finally { await prisma.$disconnect(); }
  });

  it('allocates independent server executions for identical client correlation IDs', async () => {
    const [first, second] = await Promise.all([start(), start()]);
    expect(first.id).not.toBe(second.id);
    for (const row of [first, second]) {
      await service.saveUsage(row.id, usage);
      await service.finish(row.id, {});
      await service.settle(row.id);
    }
    expect(charge.mock.calls.map(([params]) => params.messageId)).toEqual([first.id, second.id]);
  });

  it('does not settle a live stream and accepts its final usage update', async () => {
    const row = await start();
    await service.saveUsage(row.id, usage);
    await service.settle(row.id);
    expect(charge).not.toHaveBeenCalled();
    await service.saveUsage(row.id, { ...usage, completion_tokens: 10 });
    await service.finish(row.id, { finishReason: 'stop', done: true });
    await service.settle(row.id);
    expect(charge).toHaveBeenCalledWith(expect.objectContaining({ outputTokens: 10 }));
    expect(await prisma.gatewayExecution.findUnique({ where: { id: row.id } })).toMatchObject({ status: 'SETTLED', done: true });
  });

  it('atomically grants only one settlement lease across competing workers', async () => {
    const row = await start();
    await service.saveUsage(row.id, usage);
    await prisma.gatewayExecution.update({ where: { id: row.id }, data: { settlementReady: true } });
    await Promise.all(Array.from({ length: 10 }, () => service.settle(row.id)));
    expect(charge).toHaveBeenCalledTimes(1);
    await service.settle(row.id);
    expect(charge).toHaveBeenCalledTimes(1);
  });

  it('resumes a failed settlement from another service instance', async () => {
    const row = await start();
    await service.saveUsage(row.id, usage);
    charge.mockRejectedValueOnce(new Error('transient ledger failure'));
    await service.finish(row.id, {});
    await service.settle(row.id);
    expect(await prisma.gatewayExecution.findUnique({ where: { id: row.id } })).toMatchObject({ status: 'USAGE_PENDING', settlementAttempts: 1 });
    const restarted = new GatewayExecutionService(prisma, { chargeUsage: charge } as never, new ConfigService());
    await restarted.reconcile();
    expect(await prisma.gatewayExecution.findUnique({ where: { id: row.id } })).toMatchObject({ status: 'SETTLED', settlementAttempts: 2 });
  });

  it.each([false, true])('does not let a late worker overwrite a newer settlement (failure=%s)', async (failure) => {
    const row = await start();
    await service.saveUsage(row.id, usage);
    await prisma.gatewayExecution.update({ where: { id: row.id }, data: { settlementReady: true } });
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    charge.mockImplementationOnce(() => new Promise((resolve, reject) => {
      release = () => failure ? reject(new Error('late failure')) : resolve({ usageRecordId: 'old-ledger', alreadyCharged: true });
      entered();
    }));
    const oldWorker = service.settle(row.id);
    await started;
    try {
      await prisma.gatewayExecution.update({ where: { id: row.id }, data: { settlementLeaseUntil: new Date(0) } });
      await service.settle(row.id);
    } finally {
      release();
      await oldWorker;
    }
    expect(await prisma.gatewayExecution.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 'SETTLED', usageRecordId: 'test-ledger-record', settlementLeaseUntil: null, errorCode: null,
    });
  });

  it('durably distinguishes unknown usage and definitive admission rejection', async () => {
    const unknown = await start();
    await service.finish(unknown.id, { errorCode: 'CLIENT_DISCONNECTED' });
    expect(await prisma.gatewayExecution.findUnique({ where: { id: unknown.id } })).toMatchObject({ status: 'NEEDS_RECONCILIATION', inputTokens: null });
    const denied = await start();
    await service.fail(denied.id, 'PLATFORM_CONCURRENCY_LIMIT_EXCEEDED', true);
    expect(await prisma.gatewayExecution.findUnique({ where: { id: denied.id } })).toMatchObject({ status: 'FAILED' });
    expect(charge).not.toHaveBeenCalled();
  });

  it('requires reconciliation for crashed streams without a confirmed final usage snapshot', async () => {
    const withUsage = await start();
    await service.saveUsage(withUsage.id, usage);
    const withoutUsage = await start();
    await prisma.gatewayExecution.updateMany({ where: { id: { in: [withUsage.id, withoutUsage.id] } }, data: { expiresAt: new Date(0) } });
    await service.reconcile();
    expect(await prisma.gatewayExecution.findUnique({ where: { id: withUsage.id } })).toMatchObject({
      status: 'NEEDS_RECONCILIATION', settlementReady: false, errorCode: 'EXECUTION_EXPIRED_WITH_UNCONFIRMED_USAGE',
    });
    expect(await prisma.gatewayExecution.findUnique({ where: { id: withoutUsage.id } })).toMatchObject({ status: 'NEEDS_RECONCILIATION' });
    expect(charge).not.toHaveBeenCalled();
  });

  it.each([false, true])('never settles an older snapshot when a late checkpoint arrives before freezing=%s', async (writeFirst) => {
    const row = await start();
    await service.saveUsage(row.id, usage);
    const newer = { ...usage, completion_tokens: 100, total_tokens: 112 };
    if (writeFirst) await service.saveUsage(row.id, newer);
    await service.fail(row.id, 'EXECUTION_JOURNAL_TIMEOUT', false, true);
    if (!writeFirst) await expect(service.saveUsage(row.id, newer)).rejects.toMatchObject({ status: 503 });
    await prisma.gatewayExecution.update({ where: { id: row.id }, data: { expiresAt: new Date(0) } });
    await service.reconcile();
    await service.settle(row.id);
    expect(charge).not.toHaveBeenCalled();
    expect(await prisma.gatewayExecution.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 'NEEDS_RECONCILIATION', settlementReady: false, errorCode: 'USAGE_CHECKPOINT_UNCERTAIN',
      outputTokens: writeFirst ? 100 : 8,
    });
  });
});
