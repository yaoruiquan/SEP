import { ServiceUnavailableException } from "@nestjs/common";
import { SETTING_KEYS } from "shared";
import { SettingService } from "../setting/setting.service";

type SettingReader = Pick<SettingService, "getEffectiveValue">;

export interface Sub2ApiProviderConfig {
  baseURL: string;
  apiKey: string;
}

/** Resolve the same persisted settings used by the admin model test. */
export async function resolveSub2ApiProviderConfig(
  settings: SettingReader,
): Promise<Sub2ApiProviderConfig> {
  const [baseURL, apiKey] = await Promise.all([
    settings.getEffectiveValue(SETTING_KEYS.SUB2API_BASE_URL),
    settings.getEffectiveValue(SETTING_KEYS.SUB2API_API_KEY),
  ]);

  if (!baseURL || !apiKey) {
    throw new ServiceUnavailableException(
      "上游渠道未配置，请先在系统设置中填写 sub2api 地址和密钥",
    );
  }

  return {
    baseURL: baseURL.replace(/\/+$/, ""),
    apiKey,
  };
}
