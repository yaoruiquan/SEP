import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptSecret, decryptSecret } from '../../common/crypto/secret-cipher';
import { SETTING_FIELDS, SETTING_KEYS, SECRET_SETTING_KEYS, type SettingFieldMeta, type SettingKey } from 'shared';

export type SettingSource = 'database' | 'environment' | 'default' | 'unconfigured';

/** 单个配置项对外展示。敏感值永不回传。 */
export interface SettingView {
  key: string;
  label: string;
  category: string;
  description?: string;
  type?: string;
  unit?: string;
  placeholder?: string;
  defaultValue?: string;
  source: SettingSource;
  editable: boolean;
  restartRequired: boolean;
  testable: boolean;
  secret: boolean;
  value?: string;
  configured: boolean;
}

export type OAuthConfigProvider = 'wechat' | 'qq' | 'dingtalk';

export interface OAuthConfigCheck {
  provider: OAuthConfigProvider;
  enabled: boolean;
  configured: boolean;
  valid: boolean;
  checks: {
    enabled: boolean;
    appId: boolean;
    secret: boolean;
    redirectUri: boolean;
  };
  message: string;
}

@Injectable()
export class SettingService {
  private readonly logger = new Logger(SettingService.name);
  private readonly masterKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.masterKey = this.config.getOrThrow<string>('JWT_SECRET');
  }

  private fieldFor(key: string): SettingFieldMeta | undefined {
    return SETTING_FIELDS.find((field) => field.key === key);
  }

  private sourceFor(field: SettingFieldMeta, dbValue: string | undefined, envValue: string | undefined): SettingSource {
    if (dbValue !== undefined) return 'database';
    if (envValue !== undefined && envValue !== '') return 'environment';
    if (field.defaultValue !== undefined) return 'default';
    return 'unconfigured';
  }

  private rawDefault(field: SettingFieldMeta): string | undefined {
    return field.defaultValue;
  }

  /** 读取实际生效值：SystemSetting > .env > 元数据默认值。 */
  async getEffectiveValue(key: SettingKey): Promise<string | undefined> {
    const field = this.fieldFor(key);
    if (!field) return undefined;
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (row?.value !== undefined && row.value !== '') {
      if (SECRET_SETTING_KEYS.includes(key)) {
        try {
          return decryptSecret(row.value, this.masterKey);
        } catch (error) {
          this.logger.error(`Failed to decrypt setting ${key}, falling back to env`, error instanceof Error ? error.message : String(error));
        }
      } else {
        return row.value;
      }
    }
    return this.config.get<string>(field.envFallback) ?? this.rawDefault(field);
  }

  /** 管理端列表视图：返回来源、类型和生效状态，敏感项只给 configured。 */
  async listForAdmin(): Promise<SettingView[]> {
    const rows = await this.prisma.systemSetting.findMany();
    const byKey = new Map<string, string>(rows.map((row) => [row.key, row.value]));
    return SETTING_FIELDS.map((field): SettingView => {
      const dbValue = byKey.get(field.key);
      const envValue = this.config.get<string>(field.envFallback);
      const source = this.sourceFor(field, dbValue, envValue);
      const configured = source !== 'unconfigured';
      const base = {
        key: field.key,
        label: field.label,
        category: field.category ?? this.inferCategory(field.key),
        description: field.description,
        type: field.type,
        unit: field.unit,
        placeholder: field.placeholder,
        defaultValue: field.defaultValue,
        source,
        editable: field.editable !== false,
        restartRequired: field.restartRequired === true,
        testable: field.testable === true,
        secret: field.secret,
        configured,
      } satisfies Omit<SettingView, 'value'>;
      if (field.secret) return base;
      return { ...base, value: dbValue ?? envValue ?? field.defaultValue ?? '' };
    });
  }

  async checkOAuthConfig(provider: OAuthConfigProvider): Promise<OAuthConfigCheck> {
    const keys = {
      wechat: {
        enabled: SETTING_KEYS.WECHAT_OAUTH_ENABLED,
        appId: SETTING_KEYS.WECHAT_APP_ID,
        secret: SETTING_KEYS.WECHAT_APP_SECRET,
        redirectUri: SETTING_KEYS.WECHAT_REDIRECT_URI,
      },
      qq: {
        enabled: SETTING_KEYS.QQ_OAUTH_ENABLED,
        appId: SETTING_KEYS.QQ_APP_ID,
        secret: SETTING_KEYS.QQ_APP_KEY,
        redirectUri: SETTING_KEYS.QQ_REDIRECT_URI,
      },
      dingtalk: {
        enabled: SETTING_KEYS.DINGTALK_OAUTH_ENABLED,
        appId: SETTING_KEYS.DINGTALK_CLIENT_ID,
        secret: SETTING_KEYS.DINGTALK_CLIENT_SECRET,
        redirectUri: SETTING_KEYS.DINGTALK_REDIRECT_URI,
      },
    }[provider];
    const [enabledRaw, appId, secret, redirectUri] = await Promise.all([
      this.getEffectiveValue(keys.enabled),
      this.getEffectiveValue(keys.appId),
      this.getEffectiveValue(keys.secret),
      this.getEffectiveValue(keys.redirectUri),
    ]);
    const checks = {
      enabled: enabledRaw === 'true',
      appId: Boolean(appId?.trim()),
      secret: Boolean(secret?.trim()),
      redirectUri: this.isHttpsUrl(redirectUri),
    };
    const configured = checks.appId && checks.secret && checks.redirectUri;
    const valid = checks.enabled && configured;
    const message = !checks.enabled
      ? '尚未启用该登录方式'
      : valid
        ? '配置完整，可以进入真实 OAuth 联调'
        : '配置不完整，请补齐 Client ID/AppID、密钥和 HTTPS 回调地址';
    return { provider, enabled: checks.enabled, configured, valid, checks, message };
  }

  private isHttpsUrl(value: string | undefined): boolean {
    if (!value) return false;
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }

  private inferCategory(key: string): string {
    if (/^(MAIL_|WECHAT_|QQ_|DINGTALK_|AUTH_|OAUTH_)/.test(key)) return 'auth';
    if (/^(SUB2API_|MODEL_)/.test(key)) return 'ai';
    if (/PRICE|CNY|BALANCE|USD/.test(key)) return 'billing';
    if (/ENTERPRISE|WELCOME|MAX_CONCURRENT/.test(key)) return 'users';
    if (/RETENTION|FILTER|IP_WHITELIST/.test(key)) return 'security';
    if (/NOTIFICATION|ABNORMAL/.test(key)) return 'notifications';
    if (/REDIS|CACHE|TIMEOUT/.test(key)) return 'runtime';
    if (/PLATFORM|SUPPORT|ICP/.test(key)) return 'platform';
    return 'general';
  }

  private validateValue(field: SettingFieldMeta, rawValue: string): string {
    const value = rawValue.trim();
    if (value === '') return value;
    if (field.type === 'boolean' && value !== 'true' && value !== 'false') {
      throw new BadRequestException(`${field.label} 必须是 true 或 false`);
    }
    if (field.type === 'integer' || field.type === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number) || (field.type === 'integer' && !Number.isInteger(number))) {
        throw new BadRequestException(`${field.label} 必须是有效的${field.type === 'integer' ? '整数' : '数字'}`);
      }
      if (field.min !== undefined && number < field.min) throw new BadRequestException(`${field.label} 不能小于 ${field.min}`);
      if (field.max !== undefined && number > field.max) throw new BadRequestException(`${field.label} 不能大于 ${field.max}`);
    }
    if (field.type === 'email' && !/^\S+@\S+\.\S+$/.test(value)) throw new BadRequestException(`${field.label} 不是有效邮箱`);
    if (field.type === 'url') {
      let url: URL;
      try { url = new URL(value); } catch { throw new BadRequestException(`${field.label} 不是有效地址`); }
      if ((field.key === 'WECHAT_REDIRECT_URI' || field.key === 'QQ_REDIRECT_URI' || field.key === 'DINGTALK_REDIRECT_URI') && url.protocol !== 'https:') {
        throw new BadRequestException(`${field.label} 必须使用 HTTPS`);
      }
    }
    return value;
  }

  /** 更新一批配置。空字符串删除数据库覆盖并回退环境变量/默认值。 */
  async updateMany(updates: Record<string, string>): Promise<void> {
    if ('DEFAULT_AVATAR_STYLE' in updates) throw new BadRequestException('请通过头像风格管理切换默认风格');
    for (const [key, rawValue] of Object.entries(updates)) {
      const field = this.fieldFor(key);
      if (!field) throw new BadRequestException(`不支持的系统配置：${key}`);
      if (field.editable === false) throw new BadRequestException(`配置不可在运营端修改：${field.label}`);
      if (typeof rawValue !== 'string') throw new BadRequestException(`${field.label} 必须是字符串值`);
      const value = this.validateValue(field, rawValue);
      if (value === '') {
        await this.prisma.systemSetting.deleteMany({ where: { key } });
        continue;
      }
      const stored = field.secret ? encryptSecret(value, this.masterKey) : value;
      await this.prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: stored, isSecret: field.secret, label: field.label, category: field.category ?? this.inferCategory(key) },
        update: { value: stored, isSecret: field.secret, label: field.label, category: field.category ?? this.inferCategory(key) },
      });
    }
  }
}
