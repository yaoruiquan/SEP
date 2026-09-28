import { ConfigService } from '@nestjs/config';
import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { NormalizedOAuthProfile, OAuthCallbackInput, OAuthProviderAdapter, OAuthStartInput, OAuthTokenSet } from '../oauth.types';
import { getJson, OAuthFetch, requireProviderValue } from './oauth-http';
import { SettingService } from '../../setting/setting.service';
import { SETTING_KEYS } from 'shared';

interface WechatTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  openid?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

interface WechatProfileResponse {
  openid?: string;
  unionid?: string;
  nickname?: string;
  headimgurl?: string;
  errcode?: number;
  errmsg?: string;
}

@Injectable()
export class WechatOAuthProvider implements OAuthProviderAdapter {
  readonly id = 'wechat' as const;
  readonly displayName = '微信';
  readonly type = 'wechat-qr' as const;
  readonly fetcher: OAuthFetch;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly settings?: SettingService,
  ) {
    this.fetcher = (input, init) => fetch(input, init);
  }

  private async value(key: 'enabled' | 'appId' | 'appSecret' | 'redirectUri'): Promise<string | undefined> {
    const settingKey = {
      enabled: SETTING_KEYS.WECHAT_OAUTH_ENABLED,
      appId: SETTING_KEYS.WECHAT_APP_ID,
      appSecret: SETTING_KEYS.WECHAT_APP_SECRET,
      redirectUri: SETTING_KEYS.WECHAT_REDIRECT_URI,
    }[key];
    const envKey = {
      enabled: 'WECHAT_OAUTH_ENABLED',
      appId: 'WECHAT_APP_ID',
      appSecret: 'WECHAT_APP_SECRET',
      redirectUri: 'WECHAT_REDIRECT_URI',
    }[key];
    return this.settings
      ? await this.settings.getEffectiveValue(settingKey)
      : this.config.get<string>(envKey);
  }

  async isConfigured(): Promise<boolean> {
    const [enabled, appId, appSecret, redirectUri] = await Promise.all([
      this.value('enabled'), this.value('appId'), this.value('appSecret'), this.value('redirectUri'),
    ]);
    return enabled === 'true' && Boolean(appId && appSecret && redirectUri);
  }

  async buildAuthorizationUrl(input: OAuthStartInput): Promise<string> {
    const appId = requireProviderValue(await this.value('appId'), '微信登录尚未配置');
    const redirectUri = input.redirectUri || requireProviderValue(await this.value('redirectUri'), '微信登录回调地址尚未配置');
    const url = new URL('https://open.weixin.qq.com/connect/qrconnect');
    url.searchParams.set('appid', appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'snsapi_login');
    url.searchParams.set('state', input.state);
    return `${url.toString()}#wechat_redirect`;
  }

  async exchangeCode(input: OAuthCallbackInput): Promise<OAuthTokenSet> {
    const appId = requireProviderValue(await this.value('appId'), '微信登录尚未配置');
    const secret = requireProviderValue(await this.value('appSecret'), '微信登录尚未配置');
    if (!input.code) throw new BadRequestException('微信授权码缺失');
    const url = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
    url.searchParams.set('appid', appId);
    url.searchParams.set('secret', secret);
    url.searchParams.set('code', input.code);
    url.searchParams.set('grant_type', 'authorization_code');
    const payload = await getJson<WechatTokenResponse>(this.fetcher, url.toString());
    if (!payload.access_token || !payload.openid) throw new BadRequestException(payload.errmsg ?? '微信授权失败');
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresIn: payload.expires_in,
      providerAccountId: payload.unionid ?? payload.openid,
      raw: payload,
    };
  }

  async fetchUserProfile(tokens: OAuthTokenSet): Promise<NormalizedOAuthProfile> {
    const raw = tokens.raw as WechatTokenResponse;
    const openid = raw.openid;
    if (!openid) throw new BadRequestException('微信身份标识缺失');
    const url = new URL('https://api.weixin.qq.com/sns/userinfo');
    url.searchParams.set('access_token', tokens.accessToken);
    url.searchParams.set('openid', openid);
    url.searchParams.set('lang', 'zh_CN');
    const payload = await getJson<WechatProfileResponse>(this.fetcher, url.toString());
    const providerAccountId = payload.unionid ?? tokens.providerAccountId ?? payload.openid;
    if (!providerAccountId) throw new BadRequestException(payload.errmsg ?? '微信身份标识缺失');
    return {
      provider: this.id,
      providerAccountId,
      email: null,
      name: payload.nickname ?? null,
      avatar: payload.headimgurl ?? null,
      rawProfile: payload,
      emailVerified: null,
    };
  }
}
