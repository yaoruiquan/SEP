/**
 * 系统设置。
 *
 * 数据源是 `shared` 的 SETTING_FIELDS —— 那里已经是管理端设置表单的
 * 唯一事实来源。旧 seed 把 26 个 key 手抄了一遍（还抄了两份：seed.ts 和
 * init-extended-settings.ts），改一处忘另一处就漂移。这里只做投影。
 *
 * 敏感项（SUB2API_API_KEY 等）不写死值：种子数据进不了生产密钥，
 * 留空由管理员在设置页填，或走 .env 回退（见 setting.service.ts）。
 *
 * 例外：seed 会检查 .env 中与 SETTING_FIELD.envFallback 对应的环境变量，
 * 若存在则写入 system_settings，避免清库后配置丢失。
 */
import { PrismaClient } from '@prisma/client';
import { SETTING_FIELDS, SECRET_SETTING_KEYS } from '../../src/shared';

export async function seedSettings(prisma: PrismaClient): Promise<number> {
  console.log(`[seedSettings] SETTING_FIELDS.length = ${SETTING_FIELDS.length}`);
  const alipayFields = SETTING_FIELDS.filter(f => f.key.startsWith('alipay'));
  console.log(`[seedSettings] Alipay fields: ${alipayFields.map(f => f.key).join(', ')}`);
  
  for (const field of SETTING_FIELDS) {
    const isSecret = SECRET_SETTING_KEYS.includes(field.key);

    // 从环境变量读取（若 envFallback 存在且有值）
    let valueFromEnv: string | undefined;
    if (field.envFallback && process.env[field.envFallback]) {
      valueFromEnv = process.env[field.envFallback];
    }

    await prisma.systemSetting.upsert({
      where: { key: field.key },
      update: { label: field.label, isSecret },
      create: {
        key: field.key,
        // 优先级：env > placeholder（敏感项无 placeholder，留空）
        value: valueFromEnv ?? (isSecret ? '' : (field.placeholder ?? '')),
        isSecret,
        label: field.label,
      },
    });
  }

  return SETTING_FIELDS.length;
}
