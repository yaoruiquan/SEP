import { ServiceUnavailableException } from "@nestjs/common";
import { DEFAULT_MODEL_ID, SETTING_KEYS } from "shared";
import { SettingService } from "../setting/setting.service";

type SettingReader = Pick<SettingService, "getEffectiveValue">;

export interface Sub2ApiProviderConfig {
  baseURL: string;
  apiKey: string;
  /** 系统设置里的默认模型，未配置时回落 DEFAULT_MODEL_ID。 */
  defaultModel: string;
}

/**
 * 中转（sub2api）连接参数的**唯一**解析口。
 *
 * 必须走系统设置而不是 ConfigService(env)：运营在管理端改的是 SystemSetting，
 * env 只是它的兜底。两者一旦不同步，「谁读 env 谁挂」——线上真出过：
 * 2026-09-05 生产环境 env 里的 SUB2API_API_KEY 已失效，而 SystemSetting 里是
 * 有效的，于是对话正常、任务规划报 relay 401 INVALID_API_KEY，同一台机器
 * 两个功能两种结果，排查时完全对不上。
 *
 * 所以任何要打中转的地方都用这个函数，不要再自己读 env。
 */
export async function resolveSub2ApiProviderConfig(
  settings: SettingReader,
): Promise<Sub2ApiProviderConfig> {
  const [baseURL, apiKey, defaultModel] = await Promise.all([
    settings.getEffectiveValue(SETTING_KEYS.SUB2API_BASE_URL),
    settings.getEffectiveValue(SETTING_KEYS.SUB2API_API_KEY),
    settings.getEffectiveValue(SETTING_KEYS.SUB2API_DEFAULT_MODEL),
  ]);

  if (!baseURL || !apiKey) {
    throw new ServiceUnavailableException(
      "上游渠道未配置，请先在系统设置中填写 sub2api 地址和密钥",
    );
  }

  return {
    baseURL: baseURL.replace(/\/+$/, ""),
    apiKey,
    defaultModel: defaultModel || DEFAULT_MODEL_ID,
  };
}
