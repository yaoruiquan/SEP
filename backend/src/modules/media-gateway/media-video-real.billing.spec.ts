import { Decimal } from '@prisma/client/runtime/library';
import { MediaRealBillingService } from './media-real-billing.service';

const decimal = (value: string | number) => new Decimal(value);
const reservation = () => ({ receiptId: 'video-receipt', enterpriseId: 'enterprise-1', userId: 'user-1', subscriptionId: 'subscription-1',
  creditId: null, reservedCny: decimal(7), creditCny: decimal(0), memberWalletCny: decimal(0), personalCny: decimal(7),
  usdToCnyRate: decimal(7), status: 'RESERVED', settledCny: null, settledUsd: null,
  sourceSnapshot: { memberWalletAllocations: [], personalWalletId: 'wallet-1' } });
describe('MediaRealBillingService video settlement isolation', () => {
  let tx: any;
  let service: MediaRealBillingService;
  let prisma: { $transaction: jest.Mock };
  beforeEach(() => {
    tx = {
      mediaRealBillingReservation: { findUnique: jest.fn(async () => reservation()), updateMany: jest.fn(async () => ({ count: 1 })), update: jest.fn() },
      subscription: { findFirst: jest.fn(async () => ({ employeeId: 'employee-1' })) },
      computeUsageRecord: { create: jest.fn() },
      personalWallet: { findUnique: jest.fn(async () => ({ id: 'wallet-1', balance: decimal(10), totalConsumeCNY: decimal(7), version: 0 })),
        updateMany: jest.fn(async () => ({ count: 1 })) },
      personalWalletTransaction: { create: jest.fn(async () => ({ id: 'refund-1' })) },
    };
    prisma = { $transaction: jest.fn(async fn => fn(tx)) };
    service = new MediaRealBillingService(prisma as never);
  });

  it('settles minimax-h3 through the original atomic journal and refund transaction', async () => {
    await expect(service.settleVideo('video-receipt', '3.500000', '0.500000', 'minimax-h3')).resolves.toBe('SETTLED');
    expect(tx.computeUsageRecord.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      modelId: 'minimax-h3', idempotencyKey: 'media-real:video-receipt', costCNY: decimal('3.5'), employeeId: 'employee-1',
    }) });
    expect(tx.mediaRealBillingReservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ receiptId: 'video-receipt', status: 'RESERVED' }),
      data: expect.objectContaining({ status: 'SETTLED', settledCny: decimal('3.5'), settledUsd: decimal('0.5') }),
    }));
    expect(tx.personalWallet.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ balance: { increment: decimal('3.5') } }) }));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each(['gpt-image-2', 'MiniMax-H3', 'minimax-h3-max', 'another-model'])('does not let video settle accept %s', async model => {
    await expect(service.settleVideo('video-receipt', '7.000000', '1.000000', model)).rejects.toMatchObject({ response: { error: { code: 'INVALID_PARAMETER' } } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not widen the existing image settle model validator', async () => {
    await expect(service.settle('video-receipt', '7.000000', '1.000000', 'minimax-h3')).rejects.toMatchObject({ response: { error: { code: 'INVALID_PARAMETER' } } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps above-quote liabilities reconciling without refunding or posting duplicate usage', async () => {
    await expect(service.settleVideo('video-receipt', '8.000000', '1.142857', 'minimax-h3')).resolves.toBe('RECONCILING');
    expect(tx.personalWallet.updateMany).not.toHaveBeenCalled();
    expect(tx.computeUsageRecord.create).not.toHaveBeenCalled();
  });

  it('is idempotent for an already settled original bill', async () => {
    tx.mediaRealBillingReservation.findUnique.mockResolvedValue({ ...reservation(), status: 'SETTLED', settledCny: decimal(7), settledUsd: decimal(1) });
    await expect(service.settleVideo('video-receipt', '7.000000', '1.000000', 'minimax-h3')).resolves.toBe('SETTLED');
    expect(tx.computeUsageRecord.create).not.toHaveBeenCalled();
    expect(tx.mediaRealBillingReservation.updateMany).not.toHaveBeenCalled();
  });
});
