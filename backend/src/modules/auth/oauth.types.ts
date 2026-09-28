export type OAuthProviderId = 'wechat' | 'qq' | (string & {});
export type OAuthProviderType = 'oauth2' | 'oidc' | 'wechat-qr';
export type OAuthIntent = 'LOGIN' | 'LINK' | 'INVITATION';

export interface OAuthStartInput {
  state: string;
  nonce?: string;
  redirectUri: string;
}

export interface OAuthCallbackInput {
  code: string;
  redirectUri: string;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  providerAccountId?: string;
  raw: unknown;
}

export interface NormalizedOAuthProfile {
  provider: OAuthProviderId;
  providerAccountId: string;
  email: string | null;
  name: string | null;
  avatar: string | null;
  rawProfile: unknown;
  emailVerified: boolean | null;
}

export interface OAuthProviderAdapter {
  readonly id: OAuthProviderId;
  readonly displayName: string;
  readonly type: OAuthProviderType;
  isConfigured(): boolean | Promise<boolean>;
  buildAuthorizationUrl(input: OAuthStartInput): Promise<string>;
  exchangeCode(input: OAuthCallbackInput): Promise<OAuthTokenSet>;
  fetchUserProfile(tokens: OAuthTokenSet): Promise<NormalizedOAuthProfile>;
}
