import { OAuthStateService } from './oauth-state.service';

describe('OAuthStateService', () => {
  const prisma = {
    authOAuthTransaction: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  } as any;
  const config = { get: jest.fn() } as any;
  let service: OAuthStateService;

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockReturnValue(undefined);
    service = new OAuthStateService(prisma, config);
  });

  it('creates opaque state and nonce and stores only hashes', async () => {
    prisma.authOAuthTransaction.create.mockImplementation(async ({ data }: any) => ({
      id: 'tx-1',
      expiresAt: data.expiresAt,
    }));
    const result = await service.create({ provider: 'wechat', redirectUri: 'https://app.test/callback' });
    const data = prisma.authOAuthTransaction.create.mock.calls[0][0].data;
    expect(result.state).toHaveLength(43);
    expect(result.nonce).toHaveLength(43);
    expect(data.stateHash).not.toBe(result.state);
    expect(data.nonceHash).not.toBe(result.nonce);
    expect(data.provider).toBe('wechat');
  });

  it('consumes a state once and verifies provider and redirect uri', async () => {
    const state = 'a'.repeat(32);
    const now = new Date(Date.now() + 60_000);
    prisma.authOAuthTransaction.findUnique.mockResolvedValue({
      id: 'tx-1', provider: 'wechat', intent: 'LOGIN', redirectUri: 'https://app.test/callback',
      userId: null, metadata: null, expiresAt: now, consumedAt: null,
    });
    prisma.authOAuthTransaction.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.consume({ provider: 'wechat', state, redirectUri: 'https://app.test/callback' }))
      .resolves.toMatchObject({ id: 'tx-1', provider: 'wechat' });
    expect(prisma.authOAuthTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'tx-1', consumedAt: null }),
    }));
  });

  it('rejects replay and mismatched callback data', async () => {
    prisma.authOAuthTransaction.findUnique.mockResolvedValue(null);
    await expect(service.consume({ provider: 'qq', state: 'short', redirectUri: 'x' })).rejects.toThrow('OAuth state');
    await expect(service.consume({ provider: 'qq', state: 'a'.repeat(32), redirectUri: 'x' })).rejects.toThrow('OAuth state');
  });
});
