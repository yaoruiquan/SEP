import { QqOAuthProvider } from './qq.provider';

describe('QqOAuthProvider', () => {
  const config = { get: jest.fn((key: string) => ({ QQ_OAUTH_ENABLED: 'true', QQ_APP_ID: 'qq-app', QQ_APP_KEY: 'key', QQ_REDIRECT_URI: 'https://app.test/oauth/qq/callback' } as any)[key]) } as any;
  it('builds authorization URL', async () => {
    const provider = new QqOAuthProvider(config);
    const url = await provider.buildAuthorizationUrl({ state: 'state-123', redirectUri: 'https://app.test/callback' });
    expect(url).toContain('https://graph.qq.com/oauth2.0/authorize');
    expect(url).toContain('client_id=qq-app');
    expect(url).toContain('state=state-123');
  });

  it('parses QQ token, openid callback and profile', async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(new Response('access_token=access&expires_in=7777', { status: 200 }))
      .mockResolvedValueOnce(new Response('callback( {"client_id":"qq-app","openid":"openid"} );', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ret: 0, nickname: 'QQ用户', figureurl_qq_2: 'https://img.test/q' }), { status: 200 }));
    const provider = Object.assign(new QqOAuthProvider(config), { fetcher });
    const token = await provider.exchangeCode({ code: 'code', redirectUri: 'https://app.test/callback' });
    const profile = await provider.fetchUserProfile(token);
    expect(profile).toMatchObject({ provider: 'qq', providerAccountId: 'openid', name: 'QQ用户', email: null });
  });
});
