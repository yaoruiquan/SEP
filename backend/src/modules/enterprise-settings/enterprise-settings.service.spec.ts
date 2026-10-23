import { EnterpriseSettingsService } from './enterprise-settings.service';

describe('EnterpriseSettingsService API key lifecycle', () => {
  it('does not issue an API key if the enterprise closed after authorization', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ status: 'CLOSED' }]),
      enterpriseApiKey: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (work: any) => work(tx)) };
    const context = { resolve: jest.fn().mockResolvedValue({ enterpriseId: 'enterprise-1', role: 'ENTERPRISE_ADMIN' }) };
    const service = new EnterpriseSettingsService(prisma as never, context as never);
    await expect(service.createApiKey('user-1', { name: 'Integration', scopes: [] } as never)).rejects.toThrow('企业已关闭');
    expect(tx.$queryRaw.mock.calls[0][0].join('?')).toContain('FROM enterprises WHERE id = ? FOR UPDATE');
    expect(tx.enterpriseApiKey.create).not.toHaveBeenCalled();
  });
});
