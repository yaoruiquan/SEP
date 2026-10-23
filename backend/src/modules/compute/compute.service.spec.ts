import { ConflictException } from '@nestjs/common';
import { ComputeService } from './compute.service';

describe('ComputeService recharge closure protection', () => {
  let prisma: any;
  let wallet: any;
  let service: ComputeService;
  const order = {
    id: 'recharge-1', orderNo: 'RCH1', status: 'PENDING', amount: 100,
    account: { enterpriseId: 'ent-1' },
  };

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ status: 'ACTIVE' }]),
      computeAccount: { findUnique: jest.fn().mockResolvedValue({ id: 'account-1', enterpriseId: 'ent-1' }), create: jest.fn() },
      rechargeOrder: {
        findUnique: jest.fn().mockResolvedValue(order),
        create: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue({ ...order, status: 'PAID' }),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    wallet = { deposit: jest.fn() };
    service = new ComputeService(prisma, { resolve: jest.fn().mockResolvedValue({ enterpriseId: 'ent-1' }) } as any, wallet);
  });

  it('rejects new recharge orders for closed enterprises', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ status: 'ACTIVE' }]).mockResolvedValueOnce([{ status: 'CLOSED' }]);
    await expect(service.createRechargeOrder('user-1', 100)).rejects.toThrow(ConflictException);
    expect(prisma.rechargeOrder.create).not.toHaveBeenCalled();
    expect(prisma.$queryRaw.mock.calls[0][0].join('')).toContain('FROM users');
    expect(prisma.$queryRaw.mock.calls[1][0].join('')).toContain('FROM enterprises');
  });

  it('does not lazily create a compute account after enterprise closure', async () => {
    prisma.computeAccount.findUnique.mockResolvedValue(null);
    prisma.$queryRaw.mockResolvedValue([{ status: 'CLOSED' }]);
    await expect(service.getAccount('user-1')).rejects.toThrow(ConflictException);
    expect(prisma.computeAccount.create).not.toHaveBeenCalled();
  });

  it('uses the same transaction for payment status and wallet credit', async () => {
    await service.fulfillRechargeOrder('RCH1', 'trade-1', 'ALIPAY');
    expect(wallet.deposit).toHaveBeenCalledWith('ent-1', 100, 'recharge-1', '充值订单 RCH1', prisma);
    expect(prisma.rechargeOrder.update).toHaveBeenCalled();
  });

  it('leaves a late payment uncredited when the enterprise is closed', async () => {
    prisma.$queryRaw.mockResolvedValue([{ status: 'CLOSED' }]);
    await expect(service.fulfillRechargeOrder('RCH1', 'trade-1', 'ALIPAY')).rejects.toThrow(ConflictException);
    expect(prisma.rechargeOrder.update).not.toHaveBeenCalled();
    expect(wallet.deposit).not.toHaveBeenCalled();
  });

  it('acknowledges a paid duplicate even after enterprise closure', async () => {
    prisma.rechargeOrder.findUnique.mockResolvedValue({ ...order, status: 'PAID' });
    prisma.$queryRaw.mockResolvedValue([{ status: 'CLOSED' }]);
    await expect(service.fulfillRechargeOrder('RCH1', 'trade-1', 'ALIPAY')).resolves.toMatchObject({ status: 'PAID' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(wallet.deposit).not.toHaveBeenCalled();
  });

  it('reloads payment status after acquiring the enterprise lock', async () => {
    prisma.rechargeOrder.findUnique.mockResolvedValueOnce(order).mockResolvedValueOnce({ ...order, status: 'PAID' });
    await expect(service.fulfillRechargeOrder('RCH1', 'trade-1', 'ALIPAY')).resolves.toMatchObject({ status: 'PAID' });
    expect(prisma.rechargeOrder.update).not.toHaveBeenCalled();
    expect(wallet.deposit).not.toHaveBeenCalled();
  });
});
