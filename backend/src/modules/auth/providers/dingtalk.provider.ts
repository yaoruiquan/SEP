import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NormalizedOAuthProfile, OAuthCallbackInput, OAuthProviderAdapter, OAuthStartInput, OAuthTokenSet } from '../oauth.types';
import { getJson, OAuthFetch, postJson, requireProviderValue } from './oauth-http';
import { SettingService } from '../../setting/setting.service';
import { SETTING_KEYS } from 'shared';

interface DingtalkTokenResponse {
  accessToken?: string;
  refreshToken?: string;
  expireIn?: number;
  corpId?: string;
  message?: string;
  code?: string;
}

interface DingtalkUserProfileResponse {
  nick?: string;
  avatarUrl?: string;
  mobile?: string;
  openId?: string;
  unionId?: string;
  email?: string;
  stateCode?: string;
  message?: string;
  code?: string;
}

@Injectable()
export class DingtalkOAuthProvider implements OAuthProviderAdapter {
  readonly id = 'dingtalk' as const;
  readonly displayName = '钉钉';
  readonly type = 'oauth2' as const;
  readonly fetcher: OAuthFetch;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly settings?: SettingService,
  ) {
    this.fetcher = (input, init) => fetch(input, init);
  }

  private async value(key: 'enabled' | 'clientId' | 'clientSecret' | 'redirectUri' | 'scope'): Promise<string | undefined> {
    const settingKey = {
      enabled: SETTING_KEYS.DINGTALK_OAUTH_ENABLED,
      clientId: SETTING_KEYS.DINGTALK_CLIENT_ID,
      clientSecret: SETTING_KEYS.DINGTALK_CLIENT_SECRET,
      redirectUri: SETTING_KEYS.DINGTALK_REDIRECT_URI,
      scope: SETTING_KEYS.DINGTALK_SCOPE,
    }[key];
    const envKey = {
      enabled: 'DINGTALK_OAUTH_ENABLED',
      clientId: 'DINGTALK_CLIENT_ID',
      clientSecret: 'DINGTALK_CLIENT_SECRET',
      redirectUri: 'DINGTALK_REDIRECT_URI',
      scope: 'DINGTALK_SCOPE',
    }[key];
    return this.settings
      ? await this.settings.getEffectiveValue(settingKey)
      : this.config.get<string>(envKey);
  }

  async isConfigured(): Promise<boolean> {
    const [enabled, clientId, clientSecret, redirectUri] = await Promise.all([
      this.value('enabled'), this.value('clientId'), this.value('clientSecret'), this.value('redirectUri'),
    ]);
    return enabled === 'true' && Boolean(clientId && clientSecret && redirectUri);
  }

  async buildAuthorizationUrl(input: OAuthStartInput): Promise<string> {
    const clientId = requireProviderValue(await this.value('clientId'), '钉钉登录尚未配置');
    const redirectUri = input.redirectUri || requireProviderValue(await this.value('redirectUri'), '钉钉登录回调地址尚未配置');
    const scope = (await this.value('scope'))?.trim() || 'openid';
    const url = new URL('https://login.dingtalk.com/oauth2/auth');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('scope', scope);
    url.searchParams.set('state', input.state);
    url.searchParams.set('prompt', 'consent');
    return url.toString();
  }

  async exchangeCode(input: OAuthCallbackInput): Promise<OAuthTokenSet> {
    const clientId = requireProviderValue(await this.value('clientId'), '钉钉登录尚未配置');
    const clientSecret = requireProviderValue(await this.value('clientSecret'), '钉钉登录尚未配置');
    if (!input.code) throw new BadRequestException('钉钉授权码缺失');
    const payload = await postJson<DingtalkTokenResponse>(
      this.fetcher,
      'https://api.dingtalk.com/v1.0/oauth2/userAccessToken',
      {
        clientId,
        clientSecret,
        code: input.code,
        grantType: 'authorization_code',
      },
    );
    if (!payload.accessToken) throw new BadRequestException(payload.message ?? payload.code ?? '钉钉授权失败');
    return {
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      expiresIn: payload.expireIn,
      raw: payload,
    };
  }

  async fetchUserProfile(tokens: OAuthTokenSet): Promise<NormalizedOAuthProfile> {
    const profile = await getJson<DingtalkUserProfileResponse>(
      this.fetcher,
      'https://api.dingtalk.com/v1.0/contact/users/me',
      {
        headers: {
          'x-acs-dingtalk-access-token': tokens.accessToken,
        },
      },
    );
    const providerAccountId = profile.unionId ?? profile.openId;
    if (!providerAccountId) throw new BadRequestException(profile.message ?? profile.code ?? '钉钉身份标识缺失');
    return {
      provider: this.id,
      providerAccountId,
      email: profile.email ?? null,
      name: profile.nick ?? null,
      avatar: profile.avatarUrl ?? null,
      rawProfile: profile,
      emailVerified: null,
    };
  }
}
