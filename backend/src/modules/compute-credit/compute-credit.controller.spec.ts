import { ForbiddenException } from "@nestjs/common";
import { EnterpriseRole } from "@prisma/client";
import { EnterpriseContextService } from "../enterprise/enterprise-context.service";
import { ComputeCreditController } from "./compute-credit.controller";

/**
 * 算力接口的权限边界。
 *
 * 这一层不是 UI 细节：前端隐藏板块只是不画，地址栏和 curl 照样能打接口。
 * 这组测试锁三条 ——
 *   1. 企业余额 / 全部赠送额度 / 全公司逐笔账单，只有企业管理员能读
 *   2. 「用量分析」两种人都能进，但成员的作用域被后端钉死在自己身上，
 *      不接受任何 query 参数放宽（否则改个 id 就能看同事的账）
 *   3. 成员自查（my-allowance）不能被顺手关掉 —— 那是他唯一的自助入口
 *
 * DEPT_MANAGER 按普通成员对待，与 EnterpriseContextService 的既定口径一致。
 */
describe("ComputeCreditController 权限边界", () => {
  const req = { user: { id: "u-1" } };

  function build(role: EnterpriseRole) {
    const creditService = {
      getOverview: jest.fn().mockResolvedValue({ walletBalanceCNY: "0.00" }),
      listSubscriptionCredits: jest.fn().mockResolvedValue([]),
      listUsageRecords: jest.fn().mockResolvedValue({ records: [] }),
    };
    const usageAnalytics = { getBreakdown: jest.fn().mockResolvedValue({}) };
    const allowanceQuery = {
      getOne: jest.fn().mockResolvedValue({}),
      listAllowances: jest.fn().mockResolvedValue([]),
    };

    // 用真的 EnterpriseContextService：assertEnterpriseAdmin 的判定口径
    // 必须是线上那一份，stub 一个「我以为的实现」等于什么都没测
    const enterpriseContext = new EnterpriseContextService({} as any);
    jest.spyOn(enterpriseContext, "resolve").mockResolvedValue({
      enterpriseId: "ent-1",
      memberId: "m-1",
      role,
      departmentId: null,
    });

    const controller = new ComputeCreditController(
      creditService as any,
      {} as any,
      allowanceQuery as any,
      usageAnalytics as any,
      enterpriseContext,
    );

    return { controller, creditService, usageAnalytics, allowanceQuery };
  }

  describe("企业财务信息", () => {
    it.each<[string, EnterpriseRole]>([
      ["MEMBER", "MEMBER"],
      ["DEPT_MANAGER", "DEPT_MANAGER"],
    ])("%s 读不到企业余额 / 全部赠送额度 / 全公司逐笔账单", async (_l, role) => {
      const { controller, creditService } = build(role);

      await expect(controller.getOverview(req)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(controller.listCredits(req)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(controller.listUsage(req)).rejects.toThrow(
        ForbiddenException,
      );

      // 拦在查库之前 —— 抛错但已经把全公司的账捞出来了不算拦住
      expect(creditService.getOverview).not.toHaveBeenCalled();
      expect(creditService.listSubscriptionCredits).not.toHaveBeenCalled();
      expect(creditService.listUsageRecords).not.toHaveBeenCalled();
    });

    it("企业管理员照常能读这三个接口", async () => {
      const { controller, creditService } = build("ENTERPRISE_ADMIN");

      await controller.getOverview(req);
      await controller.listCredits(req);
      await controller.listUsage(req, "2", "20", "e-1", "u-9");

      expect(creditService.getOverview).toHaveBeenCalledWith("ent-1");
      expect(creditService.listSubscriptionCredits).toHaveBeenCalledWith(
        "ent-1",
      );
      // 管理员的筛选照旧生效：他本来就能看别人的账
      expect(creditService.listUsageRecords).toHaveBeenCalledWith(
        "ent-1",
        expect.objectContaining({ page: 2, employeeId: "e-1", memberId: "u-9" }),
      );
    });
  });

  describe("用量分析的作用域", () => {
    it("成员只统计自己的花费", async () => {
      const { controller, usageAnalytics } = build("MEMBER");

      await controller.getUsageBreakdown(req, "7");

      expect(usageAnalytics.getBreakdown).toHaveBeenCalledWith(
        "ent-1",
        7,
        "u-1",
      );
    });

    it("DEPT_MANAGER 也只看自己 —— 数据范围那一层还没有", async () => {
      const { controller, usageAnalytics } = build("DEPT_MANAGER");

      await controller.getUsageBreakdown(req);

      expect(usageAnalytics.getBreakdown).toHaveBeenCalledWith(
        "ent-1",
        undefined,
        "u-1",
      );
    });

    it("企业管理员不带作用域，看的是全企业", async () => {
      const { controller, usageAnalytics } = build("ENTERPRISE_ADMIN");

      await controller.getUsageBreakdown(req, "30");

      expect(usageAnalytics.getBreakdown).toHaveBeenCalledWith(
        "ent-1",
        30,
        undefined,
      );
    });
  });

  it("成员自查额度不受影响 —— 关掉它成员就没有自助入口了", async () => {
    const { controller, allowanceQuery } = build("MEMBER");

    await controller.getMyAllowance(req);

    expect(allowanceQuery.getOne).toHaveBeenCalledWith("ent-1", "u-1");
  });
});
