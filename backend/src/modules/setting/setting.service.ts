import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptSecret, decryptSecret } from '../../common/crypto/secret-cipher';
import {
  SETTING_FIELDS,
  SECRET_SETTING_KEYS,
  type SettingKey,
} from 'shared';

/** 单个配置项对外展示（敏感值打码）。 */
export interface SettingView {
  key: string;
  label: string;
  secret: boolean;
  /** 明文值（仅非敏感项）；敏感项此处为 undefined。 */
  value?: string;
  /** 敏感项是否已配置（用于 UI 显示「已设置」）。 */
  configured: boolean;
}

@Injectable()
export class SettingService {
  private readonly logger = new Logger(SettingService.name);
  private readonly masterKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.masterKey =
      this.config.get<string>('JWT_SECRET') || 'sep-jwt-secret-change-in-production';
  }

  /**
   * 读取一个配置的实际生效值（明文）。
   * 优先级：SystemSetting 表 > .env 回退。
   * 敏感值自动解密。仅供服务端内部调用，绝不直接返回给前端。
   */
  async getEffectiveValue(key: SettingKey): Promise<string | undefined> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (row?.value) {
      if (SECRET_SETTING_KEYS.includes(key)) {
        try {
          return decryptSecret(row.value, this.masterKey);
        } catch (err) {
          this.logger.error(`Failed to decrypt setting ${key}, falling back to env`, err);
        }
      } else {
        return row.value;
      }
    }
    // 回退 .env
    const field = SETTING_FIELDS.find((f) => f.key === key);
    return field ? this.config.get<string>(field.envFallback) : undefined;
  }

  /** 管理端列表视图：非敏感项给明文，敏感项只给 configured 标记。 */
  async listForAdmin(): Promise<SettingView[]> {
    const rows = await this.prisma.systemSetting.findMany();
    const byKey = new Map<string, string>(rows.map((r) => [r.key, r.value]));

    return SETTING_FIELDS.map((f): SettingView => {
      const dbValue = byKey.get(f.key);
      const envValue = this.config.get<string>(f.envFallback);
      const hasDbValue = !!dbValue;
      const configured = hasDbValue || !!envValue;

      if (f.secret) {
        return { key: f.key, label: f.label, secret: true, configured };
      }
      return {
        key: f.key,
        label: f.label,
        secret: false,
        value: hasDbValue ? dbValue! : (envValue ?? ''),
        configured,
      };
    });
  }

  /** 更新一批配置。敏感值加密存储；空字符串表示「清除，回退 env」。 */
  async updateMany(updates: Record<string, string>): Promise<void> {
    for (const [key, rawValue] of Object.entries(updates)) {
      const field = SETTING_FIELDS.find((f) => f.key === key);
      if (!field) continue; // 忽略未知 key

      // 空值 = 删除该项，回退 env
      if (rawValue === '') {
        await this.prisma.systemSetting.deleteMany({ where: { key } });
        continue;
      }

      const stored = field.secret ? encryptSecret(rawValue, this.masterKey) : rawValue;
      await this.prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: stored, isSecret: field.secret, label: field.label },
        update: { value: stored, isSecret: field.secret },
      });
    }
  }
}
