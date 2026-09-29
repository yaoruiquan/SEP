import { DingtalkOAuthProvider } from './dingtalk.provider';

const config = {
  get: jest.fn((key: string) => ({
    DINGTALK_OAUTH_ENABLED: 'true',
    DINGTALK_CLIENT_ID: 'client-id',
    DINGTALK_CLIENT_SECRET: 'client-secret',
    DINGTALK_REDIRECT_URI: 'https://app.test/oauth/dingtalk/callback',
    DINGTALK_SCOPE: 'openid',
  } as Record<string, string>)[key]),
} as any;

describe('DingtalkOAuthProvider', () => {
  beforeEach(() => config.get.mockClear());

  it('builds the current DingTalk OAuth 2.0 authorization URL without exposing the secret', async () => {
    const provider = new DingtalkOAuthProvider(config);
    const url = new URL(await provider.buildAuthorizationUrl({
      state: 'state-123',
      redirectUri: 'https://app.test/auth/oauth/dingtalk/callback',
    }));

    expect(url.origin + url.pathname).toBe('https://login.dingtalk.com/oauth2/auth');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/auth/oauth/dingtalk/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('scope')).toBe('openid');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.toString()).not.toContain('client-secret');
  });

  it('exchanges code through the current JSON token endpoint and normalizes unionId profile', async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expireIn: 7200,
        corpId: 'corp-id',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        nick: '钉钉用户',
        avatarUrl: 'https://img.test/avatar',
        openId: 'open-id',
        unionId: 'union-id',
        email: 'user@example.com',
        stateCode: '86',
      }), { status: 200 }));
    const provider = Object.assign(new DingtalkOAuthProvider(config), { fetcher });

    const tokens = await provider.exchangeCode({ code: 'oauth-code', redirectUri: 'https://app.test/callback' });
    const profile = await provider.fetchUserProfile(tokens);

    expect(fetcher).toHaveBeenNthCalledWith(1, 'https://api.dingtalk.com/v1.0/oauth2/userAccessToken', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        code: 'oauth-code',
        grantType: 'authorization_code',
      }),
    }));
    expect(fetcher).toHaveBeenNthCalledWith(2, 'https://api.dingtalk.com/v1.0/contact/users/me', expect.objectContaining({
      headers: expect.objectContaining({ 'x-acs-dingtalk-access-token': 'access-token' }),
    }));
    expect(profile).toMatchObject({
      provider: 'dingtalk',
      providerAccountId: 'union-id',
      email: 'user@example.com',
      name: '钉钉用户',
      avatar: 'https://img.test/avatar',
      emailVerified: null,
    });
    expect(JSON.stringify(profile)).not.toContain('access-token');
  });

  it('falls back to openId and rejects a profile without a stable identity', async () => {
    const provider = Object.assign(new DingtalkOAuthProvider(config), {
      fetcher: jest.fn().mockResolvedValue(new Response(JSON.stringify({ openId: 'open-id' }), { status: 200 })),
    });
    await expect(provider.fetchUserProfile({ accessToken: 'access-token', raw: {} })).resolves.toMatchObject({ providerAccountId: 'open-id' });

    provider.fetcher = jest.fn().mockResolvedValue(new Response(JSON.stringify({ nick: '无 ID' }), { status: 200 }));
    await expect(provider.fetchUserProfile({ accessToken: 'access-token', raw: {} })).rejects.toThrow('钉钉身份标识缺失');
  });
});
