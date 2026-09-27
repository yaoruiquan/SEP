import { WechatOAuthProvider } from './wechat.provider';

describe('WechatOAuthProvider', () => {
  const config = { get: jest.fn((key: string) => ({ WECHAT_OAUTH_ENABLED: 'true', WECHAT_APP_ID: 'wx-app', WECHAT_APP_SECRET: 'secret', WECHAT_REDIRECT_URI: 'https://app.test/oauth/wechat/callback' } as any)[key]) } as any;
  it('builds QR authorization URL without exposing app secret', async () => {
    const provider = new WechatOAuthProvider(config);
    const url = await provider.buildAuthorizationUrl({ state: 'state-123', redirectUri: 'https://app.test/callback' });
    expect(url).toContain('https://open.weixin.qq.com/connect/qrconnect');
    expect(url).toContain('scope=snsapi_login');
    expect(url).toContain('state=state-123');
    expect(url).not.toContain('secret');
  });

  it('exchanges code and normalizes profile', async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access', openid: 'openid', unionid: 'unionid', expires_in: 7200 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ unionid: 'unionid', nickname: '微信用户', headimgurl: 'https://img.test/a' }), { status: 200 }));
    const provider = Object.assign(new WechatOAuthProvider(config), { fetcher });
    const token = await provider.exchangeCode({ code: 'code', redirectUri: 'https://app.test/callback' });
    const profile = await provider.fetchUserProfile(token);
    expect(profile).toMatchObject({ provider: 'wechat', providerAccountId: 'unionid', name: '微信用户', email: null });
  });
});
