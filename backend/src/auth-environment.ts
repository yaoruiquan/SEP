/**
 * 认证中心生产环境配置校验。
 *
 * 这里故意只校验「能否安全启动」的边界，不读取或打印任何密钥内容。
 * 开发/测试环境继续允许 JWT_SECRET 兼容回退，生产环境必须使用独立的
 * ACCESS_JWT_SECRET 与 REFRESH_TOKEN_PEPPER。
 */
export function validateAuthEnvironment(env: Record<string, string | undefined>): Record<string, string | undefined> {
  if (env.NODE_ENV !== 'production') return env;

  const accessSecret = env.ACCESS_JWT_SECRET;
  if (!accessSecret || accessSecret.length < 32 || accessSecret === 'sep-jwt-secret-change-in-production' || accessSecret === 'dev-secret-key') {
    throw new Error('生产环境必须配置长度至少 32 的随机 ACCESS_JWT_SECRET');
  }

  const refreshPepper = env.REFRESH_TOKEN_PEPPER;
  if (!refreshPepper || refreshPepper.length < 32) {
    throw new Error('生产环境必须配置长度至少 32 的随机 REFRESH_TOKEN_PEPPER');
  }
  if (refreshPepper === accessSecret) {
    throw new Error('ACCESS_JWT_SECRET 与 REFRESH_TOKEN_PEPPER 必须使用不同的随机值');
  }

  if (!env.CORS_ORIGIN) throw new Error('生产环境必须配置 CORS_ORIGIN');

  assertHttpsUrl(env.WEB_BASE_URL, 'WEB_BASE_URL');
  assertHttpsUrl(env.ASSET_BASE_URL, 'ASSET_BASE_URL');

  if (env.REFRESH_COOKIE_NAME && !env.REFRESH_COOKIE_NAME.startsWith('__Host-')) {
    throw new Error('生产环境 REFRESH_COOKIE_NAME 必须使用 __Host- 前缀');
  }

  if (env.MAIL_ENABLED !== 'true') {
    throw new Error('生产环境必须启用真实 SMTP：MAIL_ENABLED=true');
  }
  for (const key of ['MAIL_HOST', 'MAIL_USER', 'MAIL_PASSWORD', 'MAIL_FROM'] as const) {
    if (!env[key]) throw new Error(`生产环境必须配置 ${key}`);
  }

  validateOAuthProvider(env, 'WECHAT', ['WECHAT_APP_ID', 'WECHAT_APP_SECRET', 'WECHAT_REDIRECT_URI']);
  validateOAuthProvider(env, 'QQ', ['QQ_APP_ID', 'QQ_APP_KEY', 'QQ_REDIRECT_URI']);

  return env;
}

function validateOAuthProvider(
  env: Record<string, string | undefined>,
  provider: 'WECHAT' | 'QQ',
  requiredKeys: readonly string[],
): void {
  if (env[`${provider}_OAUTH_ENABLED`] !== 'true') return;
  for (const key of requiredKeys) {
    if (!env[key]) throw new Error(`已启用 ${provider} 登录，必须配置 ${key}`);
  }
  assertHttpsUrl(env[`${provider}_REDIRECT_URI`], `${provider}_REDIRECT_URI`);
}

function assertHttpsUrl(value: string | undefined, key: string): void {
  if (!value) throw new Error(`生产环境必须配置 ${key}`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} 必须是合法 HTTPS 地址`);
  }
  if (url.protocol !== 'https:') throw new Error(`${key} 必须使用 HTTPS`);
}
