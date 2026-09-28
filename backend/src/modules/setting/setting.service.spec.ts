import { BadRequestException } from '@nestjs/common';
import { SettingService } from './setting.service';
import { SETTING_KEYS } from 'shared';

function fixture() {
  const prisma: any = {
    systemSetting: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const config: any = {
    getOrThrow: jest.fn(() => 'test-master-key'),
    get: jest.fn((key: string) => ({
      SUB2API_BASE_URL: 'https://env.example/v1',
      MAIL_ENABLED: 'false',
      AUTH_MAX_FAILED_ATTEMPTS: '5',
    } as Record<string, string>)[key]),
  };
  return { service: new SettingService(prisma, config), prisma, config };
}

describe('SettingService', () => {
  it('falls back to environment and default values', async () => {
    const { service, prisma } = fixture();
    prisma.systemSetting.findUnique.mockResolvedValue(null);
    await expect(service.getEffectiveValue(SETTING_KEYS.SUB2API_BASE_URL)).resolves.toBe('https://env.example/v1');
    await expect(service.getEffectiveValue(SETTING_KEYS.MAIL_PORT)).resolves.toBe('587');
  });

  it('stores secrets encrypted and never exposes plaintext in admin list', async () => {
    const { service, prisma } = fixture();
    prisma.systemSetting.findUnique.mockResolvedValue(null);
    prisma.systemSetting.findMany.mockResolvedValue([{ key: SETTING_KEYS.MAIL_PASSWORD, value: 'ciphertext' }]);
    await service.updateMany({ [SETTING_KEYS.MAIL_PASSWORD]: 'smtp-secret' });
    expect(prisma.systemSetting.upsert.mock.calls[0][0].create.value).not.toBe('smtp-secret');
    const rows = await service.listForAdmin();
    expect(rows.find((row) => row.key === SETTING_KEYS.MAIL_PASSWORD)).toEqual(expect.objectContaining({ secret: true, configured: true }));
    expect(JSON.stringify(rows)).not.toContain('smtp-secret');
  });

  it('validates booleans, ranges, HTTPS OAuth callbacks and unknown keys', async () => {
    const { service } = fixture();
    await expect(service.updateMany({ [SETTING_KEYS.MAIL_ENABLED]: 'yes' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateMany({ [SETTING_KEYS.AUTH_MAX_FAILED_ATTEMPTS]: '2' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateMany({ [SETTING_KEYS.WECHAT_REDIRECT_URI]: 'http://localhost/callback' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateMany({ UNKNOWN_SETTING: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('checks OAuth configuration without exposing secrets', async () => {
    const { service, prisma, config } = fixture();
    config.get.mockImplementation((key: string) => ({
      WECHAT_OAUTH_ENABLED: 'true',
      WECHAT_APP_ID: 'wx-app',
      WECHAT_APP_SECRET: 'wechat-secret',
      WECHAT_REDIRECT_URI: 'https://api.example.com/auth/oauth/wechat/callback',
    } as Record<string, string>)[key]);
    prisma.systemSetting.findUnique.mockResolvedValue(null);
    await expect(service.checkOAuthConfig('wechat')).resolves.toEqual({
      provider: 'wechat',
      enabled: true,
      configured: true,
      valid: true,
      checks: { enabled: true, appId: true, secret: true, redirectUri: true },
      message: '配置完整，可以进入真实 OAuth 联调',
    });
  });

  it('deletes an override when an empty value is submitted', async () => {
    const { service, prisma } = fixture();
    await service.updateMany({ [SETTING_KEYS.MAIL_HOST]: '' });
    expect(prisma.systemSetting.deleteMany).toHaveBeenCalledWith({ where: { key: SETTING_KEYS.MAIL_HOST } });
  });
});
