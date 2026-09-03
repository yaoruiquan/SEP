import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/library";
import { PrismaService } from "../../prisma/prisma.service";
import { MemberAllowanceQueryService } from "./member-allowance-query.service";
import { resolvePeriodWindow, previousPeriodWindow } from "./allowance-period";

const d = (n: number | string) => new Decimal(n);

/**
 * 读侧的三件事：
 *   1. 列表的查询数与成员数无关（否则 200 人企业每次开页面打 600 次库）
 *   2. 百分比对着「上限 + 结转」算，且列表**只读不写**
 *   3. 金额精度：上限 2 位、已用/剩余 4 位（单次对话常花不到 1 分）
 */
describe("MemberAllowanceQueryService", () => {
  let service: MemberAllowanceQueryService;
  let prisma: any;

  const month = resolvePeriodWindow("MONTH", new Date());
  const prevMonth = previousPeriodWindow("MONTH", month);
  const old = new Date("2020-01-01T00:00:00Z");

  const member = (userId: string, name: string | null = null) => ({
    userId,
    user: { name, email: `${userId}@demo.cn` },
    department: { name: "研发部" },
  });

  const allowanceRow = (
    userId: string,
    limit: number | null,
    extra: Record<string, unknown> = {},
  ) => ({
    id: `a-${userId}`,
    enterpriseId: "ent-1",
    userId,
    limitCNY: limit === null ? null : d(limit),
    period: "MONTH",
    carryOver: true,
    enabled: true,
    createdAt: old,
    ...extra,
  });

  beforeEach(async () => {
    prisma = {
      enterpriseMember: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(member("user-1", "张三")),
      },
      memberComputeAllowance: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      memberAllowanceWindow: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      memberAllowanceTopUp: { findMany: jest.fn().mockResolvedValue([]) },
      memberAllowanceChange: { findMany: jest.fn().mockResolvedValue([]) },
      computeUsageRecord: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { creditPaidCNY: d(0), walletPaidCNY: d(0), unpaidCNY: d(0) },
        }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberAllowanceQueryService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(MemberAllowanceQueryService);
  });

  describe("listAllowances", () => {
    it("查询数与成员数无关 —— 20 人和 1 人打一样多的库", async () => {
      const users = Array.from({ length: 20 }, (_, i) => `user-${i}`);
      prisma.enterpriseMember.findMany.mockResolvedValue(
        users.map((u) => member(u)),
      );
      prisma.memberComputeAllowance.findMany.mockResolvedValue(
        users.map((u) => allowanceRow(u, 100)),
      );

      const views = await service.listAllowances("ent-1");

      expect(views).toHaveLength(20);
      // 全员同一周期 → 本期用量 + 上期用量，共 2 次 groupBy
      expect(prisma.computeUsageRecord.groupBy).toHaveBeenCalledTimes(2);
      // 窗口行一次批量取回（本期 + 上期两个 periodStart）
      expect(prisma.memberAllowanceWindow.findMany).toHaveBeenCalledTimes(1);
      // 逐人 aggregate 就是 N+1，读侧一次都不该走单人路径
      expect(prisma.computeUsageRecord.aggregate).not.toHaveBeenCalled();
    });

    it("周期不同的成员各自分桶，仍然与人数无关", async () => {
      prisma.enterpriseMember.findMany.mockResolvedValue([
        member("user-1"),
        member("user-2"),
        member("user-3"),
      ]);
      prisma.memberComputeAllowance.findMany.mockResolvedValue([
        allowanceRow("user-1", 100, { period: "DAY" }),
        allowanceRow("user-2", 100, { period: "DAY" }),
        allowanceRow("user-3", 100, { period: "WEEK" }),
      ]);

      await service.listAllowances("ent-1");

      // 2 种周期 × (本期 + 上期)
      expect(prisma.computeUsageRecord.groupBy).toHaveBeenCalledTimes(4);
      expect(prisma.memberAllowanceWindow.findMany).toHaveBeenCalledTimes(2);
    });

    it("列表只读不写 —— 开一次页面不给全员建窗口行", async () => {
      prisma.enterpriseMember.findMany.mockResolvedValue([member("user-1")]);
      prisma.memberComputeAllowance.findMany.mockResolvedValue([
        allowanceRow("user-1", 100),
      ]);

      await service.listAllowances("ent-1");
      expect(prisma.memberAllowanceWindow.create).not.toHaveBeenCalled();
    });

    it("「已用」口径与闸门一致：企业资金三项，不含 costCNY", async () => {
      prisma.enterpriseMember.findMany.mockResolvedValue([member("user-1")]);
      prisma.memberComputeAllowance.findMany.mockResolvedValue([
        allowanceRow("user-1", 100),
      ]);

      await service.listAllowances("ent-1");

      const { _sum, by } = prisma.computeUsageRecord.groupBy.mock.calls[0][0];
      expect(by).toEqual(["userId"]);
      expect(_sum).toEqual({
        creditPaidCNY: true,
        walletPaidCNY: true,
        unpaidCNY: true,
      });
      expect(_sum).not.toHaveProperty("costCNY");
    });

    it("没有额度记录的成员照常出现在列表里，只是不限额", async () => {
      prisma.enterpriseMember.findMany.mockResolvedValue([
        member("user-1", "张三"),
      ]);
      prisma.computeUsageRecord.groupBy.mockResolvedValue([
        {
          userId: "user-1",
          _sum: { creditPaidCNY: d(3.5), walletPaidCNY: d(1), unpaidCNY: d(0) },
        },
      ]);

      const [view] = await service.listAllowances("ent-1");
      expect(view.name).toBe("张三");
      expect(view.limitCNY).toBeNull();
      expect(view.remainingCNY).toBeNull();
      expect(view.usedPct).toBeNull();
      // 不限额也要看得到花了多少
      expect(view.usedCNY).toBe("4.5000");
    });

    it("没设昵称时用邮箱兜底，不显示空白", async () => {
      prisma.enterpriseMember.findMany.mockResolvedValue([member("user-1")]);

      const [view] = await service.listAllowances("ent-1");
      expect(view.name).toBe("user-1@demo.cn");
      expect(view.departmentName).toBe("研发部");
    });

    it("缺本期窗口行时在内存里结转，不落库", async () => {
      prisma.enterpriseMember.findMany.mockResolvedValue([member("user-1")]);
      prisma.memberComputeAllowance.findMany.mockResolvedValue([
        allowanceRow("user-1", 500),
      ]);
      prisma.memberAllowanceWindow.findMany.mockResolvedValue([
        {
          id: "w-prev",
          allowanceId: "a-user-1",
          periodStart: prevMonth.start,
          carriedInCNY: d(0),
          limitAtOpenCNY: d(500),
        },
      ]);
      prisma.computeUsageRecord.groupBy
        .mockResolvedValueOnce([]) // 本期用量
        .mockResolvedValueOnce([
          {
            userId: "user-1",
            _sum: {
              creditPaidCNY: d(200),
              walletPaidCNY: d(0),
              unpaidCNY: d(0),
            },
          },
        ]); // 上期用了 200

      const [view] = await service.listAllowances("ent-1");
      expect(view.carriedInCNY).toBe("300.00");
      expect(view.remainingCNY).toBe("800.0000");
      expect(prisma.memberAllowanceWindow.create).not.toHaveBeenCalled();
    });

    it("额度是上周期之后才建的 → 不结转，避免「今天分配 500 当场能花 1000」", async () => {
      prisma.enterpriseMember.findMany.mockResolvedValue([member("user-1")]);
      prisma.memberComputeAllowance.findMany.mockResolvedValue([
        allowanceRow("user-1", 500, { createdAt: new Date() }),
      ]);

      const [view] = await service.listAllowances("ent-1");
      expect(view.carriedInCNY).toBe("0.00");
    });
  });

  describe("buildView —— 数字怎么呈现", () => {
    const state = (over: Record<string, unknown> = {}) =>
      ({
        windowId: "w-1",
        periodStart: month.start,
        periodEnd: month.end,
        limitCNY: d(100),
        carriedInCNY: d(0),
        usedCNY: d(0),
        ...over,
      }) as any;

    const who = {
      userId: "user-1",
      name: "张三",
      email: "user-1@demo.cn",
      departmentName: null,
    };

    it("百分比对着「上限 + 结转」算 —— 否则开结转的人会看到 140%", () => {
      const view = service.buildView(
        who,
        allowanceRow("user-1", 100) as any,
        state({ carriedInCNY: d(100), usedCNY: d(140) }),
        [],
      );
      expect(view.usedPct).toBe(70);
      expect(view.remainingCNY).toBe("60.0000");
    });

    it("花超了也封在 100%，不显示 213%", () => {
      const view = service.buildView(
        who,
        allowanceRow("user-1", 100) as any,
        state({ usedCNY: d(213) }),
        [],
      );
      expect(view.usedPct).toBe(100);
      // 剩余不为负 —— 负数剩余在页面上没有任何意义
      expect(view.remainingCNY).toBe("0.0000");
    });

    it("追加额度算进「总剩余」，但不影响常规剩余与百分比", () => {
      const view = service.buildView(
        who,
        allowanceRow("user-1", 100) as any,
        state({ usedCNY: d(100) }),
        [{ id: "t-1", amountCNY: d(50), consumedCNY: d(10), version: 0 }],
      );
      expect(view.remainingCNY).toBe("0.0000");
      expect(view.topUpRemainingCNY).toBe("40.00");
      expect(view.totalRemainingCNY).toBe("40.0000");
      expect(view.usedPct).toBe(100);
    });

    it("上限 2 位、已用 4 位 —— 单次对话常花不到 1 分", () => {
      const view = service.buildView(
        who,
        allowanceRow("user-1", 100) as any,
        state({ usedCNY: d("0.0123") }),
        [],
      );
      expect(view.limitCNY).toBe("100.00");
      expect(view.usedCNY).toBe("0.0123");
    });

    it("带上周期中文名与重置时刻，前端不必自己翻译枚举", () => {
      const view = service.buildView(
        who,
        allowanceRow("user-1", 100, { period: "QUARTER" }) as any,
        state(),
        [],
      );
      expect(view.periodLabel).toContain("季");
      expect(view.resetAt).toBe(month.end.toISOString());
    });

    it("停用的额度上限显示为空 —— 数字留着但当前不生效", () => {
      const view = service.buildView(
        who,
        allowanceRow("user-1", 100, { enabled: false }) as any,
        state({ limitCNY: null }),
        [],
      );
      expect(view.enabled).toBe(false);
      expect(view.limitCNY).toBeNull();
      expect(view.totalRemainingCNY).toBeNull();
    });
  });

  describe("getOne", () => {
    it("不是本企业成员时报 404，不确认该用户是否存在", async () => {
      prisma.enterpriseMember.findFirst.mockResolvedValue(null);

      await expect(service.getOne("ent-1", "user-x")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("没有额度记录时按不限额返回，且不建窗口行", async () => {
      const view = await service.getOne("ent-1", "user-1");

      expect(view.limitCNY).toBeNull();
      expect(view.userId).toBe("user-1");
      expect(prisma.memberAllowanceWindow.create).not.toHaveBeenCalled();
    });

    it("有额度记录时读到窗口事实，但仍然不写库", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(
        allowanceRow("user-1", 200),
      );
      prisma.memberAllowanceWindow.findUnique.mockResolvedValue({
        id: "w-1",
        carriedInCNY: d(50),
        limitAtOpenCNY: d(200),
      });
      prisma.computeUsageRecord.aggregate.mockResolvedValue({
        _sum: { creditPaidCNY: d(30), walletPaidCNY: d(0), unpaidCNY: d(0) },
      });

      const view = await service.getOne("ent-1", "user-1");
      expect(view.limitCNY).toBe("200.00");
      expect(view.carriedInCNY).toBe("50.00");
      expect(view.remainingCNY).toBe("220.0000");
      expect(prisma.memberAllowanceWindow.create).not.toHaveBeenCalled();
    });
  });

  describe("留痕查询", () => {
    it("追加额度带上已消耗与剩余，封顶 50 条", async () => {
      prisma.memberAllowanceTopUp.findMany.mockResolvedValue([
        {
          id: "t-1",
          userId: "user-1",
          amountCNY: d(100),
          consumedCNY: d(100.5),
          note: "赶项目",
          // 全企业留痕列表里只有 userId 等于不可读，所以视图带成员姓名
          user: { name: "小王", email: "wang@demo.cn" },
          grantedBy: { name: null, email: "admin@demo.cn" },
          createdAt: old,
        },
      ]);

      const [row] = await service.listTopUps("ent-1", "user-1");
      // 消耗略超发放额（并发扣费的分币误差）时剩余仍是 0，不显示负数
      expect(row.remainingCNY).toBe("0.0000");
      expect(row.userName).toBe("小王");
      expect(row.grantedByName).toBe("admin@demo.cn");
      expect(prisma.memberAllowanceTopUp.findMany.mock.calls[0][0].take).toBe(
        50,
      );
    });

    it("不传 userId 时查全企业，传了就只查这个人", async () => {
      await service.listTopUps("ent-1");
      expect(
        prisma.memberAllowanceTopUp.findMany.mock.calls[0][0].where,
      ).toEqual({
        enterpriseId: "ent-1",
      });

      await service.listTopUps("ent-1", "user-1");
      expect(
        prisma.memberAllowanceTopUp.findMany.mock.calls[1][0].where,
      ).toEqual({
        enterpriseId: "ent-1",
        userId: "user-1",
      });
    });

    it("变更记录保留 from/to 三组字段，「谁改的」用昵称兜底邮箱", async () => {
      prisma.memberAllowanceChange.findMany.mockResolvedValue([
        {
          id: "c-1",
          userId: "user-1",
          fromLimitCNY: null,
          toLimitCNY: d(500),
          fromPeriod: null,
          toPeriod: "MONTH",
          fromCarryOver: null,
          toCarryOver: true,
          usedAtChangeCNY: d("12.3456"),
          user: { name: null, email: "wang@demo.cn" },
          changedBy: { name: "李管理", email: "admin@demo.cn" },
          note: null,
          createdAt: old,
        },
      ]);

      const [row] = await service.listChanges("ent-1", "user-1");
      expect(row.fromLimitCNY).toBeNull();
      expect(row.toLimitCNY).toBe("500.00");
      expect(row.usedAtChangeCNY).toBe("12.3456");
      // 成员没设昵称时回落邮箱，别在留痕里显示空白
      expect(row.userName).toBe("wang@demo.cn");
      expect(row.changedByName).toBe("李管理");
      expect(prisma.memberAllowanceChange.findMany.mock.calls[0][0].take).toBe(
        50,
      );
    });
  });
});
