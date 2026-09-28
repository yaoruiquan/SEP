import { ConflictException } from '@nestjs/common';
import { OAuthService } from './oauth.service';

function makeService(withEvents = false) {
  const prisma: any = {
    authIdentity: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    user: { findUnique: jest.fn(), create: jest.fn() },
    authCredential: { findUnique: jest.fn() },
    enterpriseInvitation: { findUnique: jest.fn(), updateMany: jest.fn() },
    enterpriseMember: { findMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  const config: any = { get: jest.fn((key: string) => ({
    WEB_BASE_URL: 'http://localhost:3000',
    WECHAT_REDIRECT_URI: 'http://localhost:3001/api/auth/oauth/wechat/callback',
  } as any)[key]) };
  const state: any = { create: jest.fn(), consume: jest.fn() };
  const auth: any = { loginWithUser: jest.fn() };
  const invitations: any = { findUsableByToken: jest.fn() };
  const wechat: any = { id: 'wechat', displayName: '微信', isConfigured: () => true };
  const qq: any = { id: 'qq', displayName: 'QQ', isConfigured: () => true };
  const events: any = { record: jest.fn().mockResolvedValue(undefined) };
  return { service: new OAuthService(prisma, config, state, auth, invitations, wechat, qq, withEvents ? events : undefined), prisma, state, auth, invitations, events };
}

describe('OAuthService identity policy', () => {
  it('creates a new identity without merging by provider email', async () => {
    const { service, prisma } = makeService();
    prisma.authIdentity.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'user-1' });
    const userId = await (service as any).resolveIdentity(
      { provider: 'wechat', intent: 'LOGIN', redirectUri: 'x', userId: null, metadata: null },
      { provider: 'wechat', providerAccountId: 'unionid-1', email: 'same@example.com', name: '用户', avatar: null, rawProfile: { unionid: 'unionid-1' }, emailVerified: null },
    );
    expect(userId).toBe('user-1');
    expect(prisma.user.create).toHaveBeenCalled();
  });

  it('rejects a provider email collision instead of silently taking over the account', async () => {
    const { service, prisma } = makeService();
    prisma.authIdentity.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });
    await expect((service as any).resolveIdentity(
      { provider: 'qq', intent: 'LOGIN', redirectUri: 'x', userId: null, metadata: null },
      { provider: 'qq', providerAccountId: 'openid-1', email: 'same@example.com', name: null, avatar: null, rawProfile: {}, emailVerified: null },
    )).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects linking an identity owned by another user', async () => {
    const { service, prisma } = makeService();
    prisma.authIdentity.findUnique.mockResolvedValue({ id: 'identity-1', userId: 'user-2' });
    await expect((service as any).resolveIdentity(
      { provider: 'wechat', intent: 'LINK', redirectUri: 'x', userId: 'user-1', metadata: null },
      { provider: 'wechat', providerAccountId: 'unionid-1', email: null, name: null, avatar: null, rawProfile: {}, emailVerified: null },
    )).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('OAuthService invitation flow', () => {
  function invitationFixture(over: Record<string, unknown> = {}) {
    return {
      id: 'inv-1',
      email: 'newhire@example.com',
      enterpriseId: 'ent-1',
      role: 'MEMBER',
      departmentId: null,
      position: null,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
      ...over,
    };
  }

  it('startInvitation 只把 invitationId 写入 OAuth transaction，不保存明文 token', async () => {
    const { service, invitations, state } = makeService();
    invitations.findUsableByToken.mockResolvedValue({ id: 'inv-1' });
    state.create.mockResolvedValue({
      state: 'state-value',
      nonce: 'nonce-value',
      expiresAt: new Date(Date.now() + 300_000),
    });
    const provider = (service as any).providers.get('wechat');
    provider.buildAuthorizationUrl = jest.fn().mockResolvedValue('https://wechat.example/auth');

    const result = await service.startInvitation('wechat', 'secret-invitation-token');

    expect(result.authorizationUrl).toBe('https://wechat.example/auth');
    expect(invitations.findUsableByToken).toHaveBeenCalledWith('secret-invitation-token');
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'wechat',
      intent: 'INVITATION',
      metadata: { invitationId: 'inv-1' },
    }));
    expect(JSON.stringify(state.create.mock.calls[0][0])).not.toContain('secret-invitation-token');
  });

  it('微信/QQ 无邮箱时，以邀请邮箱创建账号并原子加入企业', async () => {
    const { service, prisma } = makeService();
    const tx: any = {
      enterpriseInvitation: { findUnique: jest.fn().mockResolvedValue(invitationFixture()), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      authIdentity: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      enterpriseMember: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: 'member-1' }) },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    const userId = await (service as any).resolveInvitationIdentity(
      { provider: 'wechat', intent: 'INVITATION', redirectUri: 'x', userId: null, metadata: { invitationId: 'inv-1' } },
      { provider: 'wechat', providerAccountId: 'unionid-1', email: null, name: '新员工', avatar: null, rawProfile: { unionid: 'unionid-1' }, emailVerified: null },
    );

    expect(userId).toBe('user-1');
    expect(tx.user.create.mock.calls[0][0].data.email).toBe('newhire@example.com');
    expect(tx.authIdentity.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { provider_providerAccountId: { provider: 'wechat', providerAccountId: 'unionid-1' } },
    }));
    expect(tx.enterpriseMember.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-1', enterpriseId: 'ent-1', role: 'MEMBER' }),
    }));
    expect(tx.enterpriseInvitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'inv-1', status: 'PENDING' }),
    }));
  });

  it('Provider 返回的邮箱与邀请不一致时拒绝加入', async () => {
    const { service, prisma } = makeService();
    const tx: any = {
      enterpriseInvitation: { findUnique: jest.fn().mockResolvedValue(invitationFixture()) },
      authIdentity: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      enterpriseMember: { findMany: jest.fn(), create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect((service as any).resolveInvitationIdentity(
      { provider: 'qq', intent: 'INVITATION', redirectUri: 'x', userId: null, metadata: { invitationId: 'inv-1' } },
      { provider: 'qq', providerAccountId: 'openid-1', email: 'other@example.com', name: null, avatar: null, rawProfile: {}, emailVerified: true },
    )).rejects.toThrow('第三方账号邮箱与邀请不匹配');
    expect(tx.authIdentity.findUnique).not.toHaveBeenCalled();
  });

  it('已有第三方身份且邮箱匹配时，更新身份并接受邀请', async () => {
    const { service, prisma } = makeService();
    const tx: any = {
      enterpriseInvitation: { findUnique: jest.fn().mockResolvedValue(invitationFixture()), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      authIdentity: { findUnique: jest.fn().mockResolvedValue({ id: 'identity-1', userId: 'user-1' }), update: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', email: 'newhire@example.com' }) },
      enterpriseMember: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect((service as any).resolveInvitationIdentity(
      { provider: 'wechat', intent: 'INVITATION', redirectUri: 'x', userId: null, metadata: { invitationId: 'inv-1' } },
      { provider: 'wechat', providerAccountId: 'unionid-1', email: null, name: '新员工', avatar: null, rawProfile: {}, emailVerified: null },
    )).resolves.toBe('user-1');
    expect(tx.authIdentity.update).toHaveBeenCalled();
    expect(tx.enterpriseMember.create).toHaveBeenCalled();
  });

  it('邀请邮箱已有本地账号时拒绝静默合并', async () => {
    const { service, prisma } = makeService();
    const tx: any = {
      enterpriseInvitation: { findUnique: jest.fn().mockResolvedValue(invitationFixture()) },
      authIdentity: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'existing-user' }), create: jest.fn() },
      enterpriseMember: { findMany: jest.fn(), create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect((service as any).resolveInvitationIdentity(
      { provider: 'qq', intent: 'INVITATION', redirectUri: 'x', userId: null, metadata: { invitationId: 'inv-1' } },
      { provider: 'qq', providerAccountId: 'openid-1', email: null, name: null, avatar: null, rawProfile: {}, emailVerified: null },
    )).rejects.toThrow('该邮箱已注册，请先登录后接受邀请');
    expect(tx.user.create).not.toHaveBeenCalled();
  });
});


describe('OAuthService callback auditing', () => {
  it('records an audit event when the user cancels the provider authorization', async () => {
    const { service, state, events } = makeService(true);
    state.consume.mockResolvedValue({
      intent: 'LOGIN',
      provider: 'wechat',
      redirectUri: 'http://localhost:3001/api/auth/oauth/wechat/callback',
      userId: null,
      metadata: null,
    });
    const response = { redirect: jest.fn() } as any;

    await service.callback({ provider: 'wechat', state: 'state-1', error: 'access_denied' }, response);

    expect(events.record).toHaveBeenCalledWith({
      userId: undefined,
      action: 'OAUTH_CALLBACK_FAILED',
      success: false,
      provider: 'wechat',
      metadata: { reason: 'oauth_cancelled' },
    });
    expect(response.redirect).toHaveBeenCalledWith(expect.stringContaining('status=cancelled'));
  });

  it('records an audit event when the provider is unavailable before state consumption', async () => {
    const { service, events } = makeService(true);

    await service.callback({ provider: 'unknown', state: 'state-1', code: 'code-1' }, { redirect: jest.fn() } as any);

    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'OAUTH_CALLBACK_FAILED',
      success: false,
      provider: 'unknown',
      metadata: { reason: 'provider_error' },
    }));
  });
});
