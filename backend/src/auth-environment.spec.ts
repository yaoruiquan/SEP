import { validateAuthEnvironment } from './auth-environment';

const baseProductionEnv = (): Record<string, string | undefined> => ({
  NODE_ENV: 'production',
  ACCESS_JWT_SECRET: 'a'.repeat(40),
  REFRESH_TOKEN_PEPPER: 'b'.repeat(40),
  CORS_ORIGIN: 'https://app.example.com',
  WEB_BASE_URL: 'https://app.example.com',
  ASSET_BASE_URL: 'https://cdn.example.com',
  REFRESH_COOKIE_NAME: '__Host-sep_refresh',
  MAIL_ENABLED: 'true',
  MAIL_HOST: 'smtp.example.com',
  MAIL_USER: 'mailer',
  MAIL_PASSWORD: 'not-a-real-secret',
  MAIL_FROM: 'no-reply@example.com',
  WECHAT_OAUTH_ENABLED: 'false',
  QQ_OAUTH_ENABLED: 'false',
});

describe('validateAuthEnvironment', () => {
  it('开发环境保留旧 JWT_SECRET 兼容回退', () => {
    const env = { NODE_ENV: 'development', JWT_SECRET: 'dev-secret' };
    expect(validateAuthEnvironment(env)).toBe(env);
  });

  it('生产环境拒绝使用 JWT_SECRET 代替独立 Access Secret', () => {
    const env = { ...baseProductionEnv(), ACCESS_JWT_SECRET: undefined, JWT_SECRET: 'a'.repeat(40) };
    expect(() => validateAuthEnvironment(env)).toThrow('ACCESS_JWT_SECRET');
  });

  it('生产环境要求 Access Secret 与 Refresh Pepper 分离', () => {
    const env = { ...baseProductionEnv(), REFRESH_TOKEN_PEPPER: baseProductionEnv().ACCESS_JWT_SECRET };
    expect(() => validateAuthEnvironment(env)).toThrow('必须使用不同');
  });

  it('生产环境必须使用 HTTPS 和真实 SMTP', () => {
    expect(() => validateAuthEnvironment({ ...baseProductionEnv(), WEB_BASE_URL: 'http://app.example.com' })).toThrow('WEB_BASE_URL');
    expect(() => validateAuthEnvironment({ ...baseProductionEnv(), MAIL_ENABLED: 'false' })).toThrow('MAIL_ENABLED');
  });

  it('仅在启用 Provider 时校验 Provider 配置', () => {
    expect(validateAuthEnvironment(baseProductionEnv())).toBeDefined();
    expect(() => validateAuthEnvironment({ ...baseProductionEnv(), WECHAT_OAUTH_ENABLED: 'true' })).toThrow('WECHAT_APP_ID');
    expect(() => validateAuthEnvironment({
      ...baseProductionEnv(),
      QQ_OAUTH_ENABLED: 'true',
      QQ_APP_ID: 'qq-app',
      QQ_APP_KEY: 'qq-key',
      QQ_REDIRECT_URI: 'http://app.example.com/api/auth/oauth/qq/callback',
    })).toThrow('QQ_REDIRECT_URI');
  });
});
