import { BadRequestException } from "@nestjs/common";
import { CostAnalyticsController } from "./cost-analytics.controller";

describe("CostAnalyticsController 查询边界", () => {
  let service: any;
  let context: any;
  let controller: CostAnalyticsController;

  beforeEach(() => {
    service = {
      getByEmployee: jest.fn().mockResolvedValue([]),
    };
    context = {
      resolve: jest.fn().mockResolvedValue({ enterpriseId: "ent-1" }),
    };
    controller = new CostAnalyticsController(service, context);
  });

  it("拒绝非整数或非正的员工排行 limit", async () => {
    await expect(
      controller.getByEmployee(
        "ent-1",
        { user: { id: "u-1" } },
        undefined,
        undefined,
        "not-a-number",
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      controller.getByEmployee(
        "ent-1",
        { user: { id: "u-1" } },
        undefined,
        undefined,
        "0",
      ),
    ).rejects.toThrow("limit 必须是大于 0 的整数");
    expect(service.getByEmployee).not.toHaveBeenCalled();
  });

  it("把排行 limit 限制到 100，避免把任意值拼进 SQL LIMIT", async () => {
    await controller.getByEmployee(
      "ent-1",
      { user: { id: "u-1" } },
      undefined,
      undefined,
      "9999",
    );

    expect(service.getByEmployee).toHaveBeenCalledWith(
      "ent-1",
      undefined,
      undefined,
      100,
    );
  });
});
