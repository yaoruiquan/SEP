import { ServiceUnavailableException } from "@nestjs/common";
import { SETTING_KEYS } from "shared";
import { resolveSub2ApiProviderConfig } from "./sub2api-provider-config";

describe("resolveSub2ApiProviderConfig", () => {
  it("uses the persisted effective settings used by the admin model test", async () => {
    const getEffectiveValue = jest.fn(async (key: string) => {
      if (key === SETTING_KEYS.SUB2API_BASE_URL) {
        return "https://longdaoai.cn/v1/";
      }
      if (key === SETTING_KEYS.SUB2API_API_KEY) {
        return "sk-admin-configured";
      }
      return undefined;
    });

    await expect(
      resolveSub2ApiProviderConfig({ getEffectiveValue }),
    ).resolves.toEqual({
      baseURL: "https://longdaoai.cn/v1",
      apiKey: "sk-admin-configured",
    });
    expect(getEffectiveValue).toHaveBeenCalledWith(
      SETTING_KEYS.SUB2API_BASE_URL,
    );
    expect(getEffectiveValue).toHaveBeenCalledWith(
      SETTING_KEYS.SUB2API_API_KEY,
    );
  });

  it("rejects missing credentials instead of sending requests to the web UI", async () => {
    const getEffectiveValue = jest.fn().mockResolvedValue(undefined);

    await expect(
      resolveSub2ApiProviderConfig({ getEffectiveValue }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
