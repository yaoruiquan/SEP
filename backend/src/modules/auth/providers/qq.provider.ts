import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NormalizedOAuthProfile, OAuthCallbackInput, OAuthProviderAdapter, OAuthStartInput, OAuthTokenSet } from '../oauth.types';
import { getJson, getText, OAuthFetch, requireProviderValue } from './oauth-http';
import { SettingService } from '../../setting/setting.service';
import { SETTING_KEYS } from 'shared';

interface QqProfileResponse { ret?: number; msg?: string; nickname?: string; figureurl_qq_2?: string; figureurl_2?: string; }

@Injectable()
export class QqOAuthProvider implements OAuthProviderAdapter {
  readonly id = 'qq' as const;
  readonly displayName = 'QQ';
  readonly type = 'oauth2' as const;
  readonly fetcher: OAuthFetch;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly settings?: SettingService,
  ) {
    this.fetcher = (input, init) => fetch(input, init);
  }

  private async value(key: 'enabled' | 'appId' | 'appKey' | 'redirectUri'): Promise<string | undefined> {
    const settingKey = {
      enabled: SETTING_KEYS.QQ_OAUTH_ENABLED,
      appId: SETTING_KEYS.QQ_APP_ID,
      appKey: SETTING_KEYS.QQ_APP_KEY,
      redirectUri: SETTING_KEYS.QQ_REDIRECT_URI,
    }[key];
    const envKey = {
      enabled: 'QQ_OAUTH_ENABLED',
      appId: 'QQ_APP_ID',
      appKey: 'QQ_APP_KEY',
      redirectUri: 'QQ_REDIRECT_URI',
    }[key];
    return this.settings
      ? await this.settings.getEffectiveValue(settingKey)
      : this.config.get<string>(envKey);
  }

  async isConfigured(): Promise<boolean> {
    const [enabled, appId, appKey, redirectUri] = await Promise.all([
      this.value('enabled'), this.value('appId'), this.value('appKey'), this.value('redirectUri'),
    ]);
    return enabled === 'true' && Boolean(appId && appKey && redirectUri);
  }

  async buildAuthorizationUrl(input: OAuthStartInput): Promise<string> {
    const appId = requireProviderValue(await this.value('appId'), 'QQ 登录尚未配置');
    const url = new URL('https://graph.qq.com/oauth2.0/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', appId);
    url.searchParams.set('redirect_uri', input.redirectUri || requireProviderValue(await this.value('redirectUri'), 'QQ 登录回调地址尚未配置'));
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  async exchangeCode(input: OAuthCallbackInput): Promise<OAuthTokenSet> {
    const appId = requireProviderValue(await this.value('appId'), 'QQ 登录尚未配置');
    const appKey = requireProviderValue(await this.value('appKey'), 'QQ 登录尚未配置');
    if (!input.code) throw new BadRequestException('QQ 授权码缺失');
    const url = new URL('https://graph.qq.com/oauth2.0/token');
    url.searchParams.set('grant_type', 'authorization_code');
    url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', appKey);
    url.searchParams.set('code', input.code);
    url.searchParams.set('redirect_uri', input.redirectUri || requireProviderValue(await this.value('redirectUri'), 'QQ 登录回调地址尚未配置'));
    const text = await getText(this.fetcher, url.toString());
    const params = new URLSearchParams(text.trim());
    const accessToken = params.get('access_token');
    if (!accessToken) throw new BadRequestException('QQ 授权失败');
    return { accessToken, expiresIn: Number(params.get('expires_in') ?? 0) || undefined, raw: { tokenResponse: text } };
  }

  async fetchUserProfile(tokens: OAuthTokenSet): Promise<NormalizedOAuthProfile> {
    const appId = requireProviderValue(await this.value('appId'), 'QQ 登录尚未配置');
    const openIdText = await getText(this.fetcher, `https://graph.qq.com/oauth2.0/me?access_token=${encodeURIComponent(tokens.accessToken)}`);
    const match = /callback\s*\(\s*(\{[\s\S]*\})\s*\)\s*;?/.exec(openIdText);
    if (!match) throw new BadRequestException('QQ 身份响应无效');
    let openId: string;
    try { openId = String((JSON.parse(match[1]) as { openid?: string }).openid ?? ''); } catch { throw new BadRequestException('QQ 身份响应无效'); }
    if (!openId) throw new BadRequestException('QQ 身份标识缺失');
    const url = new URL('https://graph.qq.com/user/get_user_info');
    url.searchParams.set('access_token', tokens.accessToken);
    url.searchParams.set('oauth_consumer_key', appId);
    url.searchParams.set('openid', openId);
    const payload = await getJson<QqProfileResponse>(this.fetcher, url.toString());
    if (payload.ret && payload.ret !== 0) throw new BadRequestException(payload.msg ?? 'QQ 用户信息获取失败');
    return {
      provider: this.id,
      providerAccountId: openId,
      email: null,
      name: payload.nickname ?? null,
      avatar: payload.figureurl_qq_2 ?? payload.figureurl_2 ?? null,
      rawProfile: payload,
      emailVerified: null,
    };
  }
}
