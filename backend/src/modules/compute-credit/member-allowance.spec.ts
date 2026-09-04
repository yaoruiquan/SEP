import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/library";
import { PrismaService } from "../../prisma/prisma.service";
import { PersonalWalletService } from "../personal-wallet/personal-wallet.service";
import { MemberAllowanceService } from "./member-allowance.service";
import { MemberAllowanceQueryService } from "./member-allowance-query.service";

const d = (n: number | string) => new Decimal(n);

/**
 * 算力分配 = 闸门，不是钱包。
 *
 * 这组测试锁住的是**会误导管理员或误伤成员**的那几条：
 *   1. 没记录 / 停用 / 未设上限 一律放行 —— 存量企业不会因为这张表被拦
 *   2. 「已用」只数企业资金（credit + wallet + unpaid），**绝不能是 costCNY** ——
 *      算进成员自费的部分，就成了「你越自费、公司额度掉得越快」
 *   3. 额度用尽是**改道**不是拦停：个人余额有钱就自费继续
 *   4. 一分钱都没有时，话术必须给出出路
 *   5. 结转只读上一行窗口，且封顶 1 个周期
 *   6. 追加额度排在常规额度之后，按批次先后消耗，带乐观锁
 *   7. 每次变更留痕；分配本身不碰任何余额字段
 */
describe("MemberAllowanceService", () => {
  let service: MemberAllowanceService;
  let prisma: any;
  let personalWallet: { getBalance: jest.Mock };
  let query: { getOne: jest.Mock };

  const emptyUsage = {
    _sum: { creditPaidCNY: d(0), walletPaidCNY: d(0), unpaidCNY: d(0) },
  };

  beforeEach(async () => {
    prisma = {
      enterpriseMember: {
        findFirst: jest.fn().mockResolvedValue({ id: "member-1" }),
      },
      memberComputeAllowance: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: "a-1" }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      memberAllowanceWindow: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            id: "w-1",
            carriedInCNY: d(0),
            limitAtOpenCNY: d(50),
          }),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: "w-new" }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      memberAllowanceTopUp: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: "top-1" }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      memberAllowanceChange: {
        create: jest.fn().mockResolvedValue({ id: "c-1" }),
      },
      computeUsageRecord: {
        aggregate: jest.fn().mockResolvedValue(emptyUsage),
      },
      enterpriseWallet: { findUnique: jest.fn(), updateMany: jest.fn() },
    };
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));

    personalWallet = { getBalance: jest.fn().mockResolvedValue(d(0)) };
    query = { getOne: jest.fn().mockResolvedValue({ userId: "user-1" }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberAllowanceService,
        { provide: PrismaService, useValue: prisma },
        { provide: PersonalWalletService, useValue: personalWallet },
        { provide: MemberAllowanceQueryService, useValue: query },
      ],
    }).compile();

    service = module.get(MemberAllowanceService);
  });

  const allowance = (
    limit: number | null,
    extra: Record<string, unknown> = {},
  ) => ({
    id: "a-1",
    enterpriseId: "ent-1",
    userId: "user-1",
    limitCNY: limit === null ? null : d(limit),
    period: "MONTH",
    carryOver: true,
    enabled: true,
    createdAt: new Date("2020-01-01T00:00:00Z"),
    ...extra,
  });

  /** 让「本周期已用」等于 amount（企业资金口径）。 */
  const used = (amount: number) =>
    prisma.computeUsageRecord.aggregate.mockResolvedValue({
      _sum: { creditPaidCNY: d(amount), walletPaidCNY: d(0), unpaidCNY: d(0) },
    });

  describe("check —— 对话前的闸门", () => {
    it("没有 userId 时放行（系统内部调用）", async () => {
      await expect(service.check("ent-1", null)).resolves.toEqual({
        enterpriseFundsAllowed: true,
        allowed: true,
      });
      expect(prisma.memberComputeAllowance.findUnique).not.toHaveBeenCalled();
    });

    it("没有额度记录时放行 —— 存量企业不受影响", async () => {
      const result = await service.check("ent-1", "user-1");
      expect(result).toEqual({ enterpriseFundsAllowed: true, allowed: true });
    });

    it("额度停用时放行，但数字保留着", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(
        allowance(50, { enabled: false }),
      );
      used(999);

      await expect(service.check("ent-1", "user-1")).resolves.toEqual({
        enterpriseFundsAllowed: true,
        allowed: true,
      });
    });

    it("未花到上限时放行，并带回额度事实供对话页展示", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(allowance(50));
      used(49.99);

      const result = await service.check("ent-1", "user-1");
      expect(result.enterpriseFundsAllowed).toBe(true);
      expect(result.allowed).toBe(true);
      expect(result.limitCNY).toBe("50.00");
      expect(result.remainingCNY).toBe("0.0100");
      expect(result.windowId).toBe("w-1");
    });

    it("「已用」只数企业资金三项，绝不是 costCNY", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(allowance(50));
      await service.check("ent-1", "user-1");

      const { _sum } = prisma.computeUsageRecord.aggregate.mock.calls[0][0];
      expect(_sum).toEqual({
        creditPaidCNY: true,
        walletPaidCNY: true,
        unpaidCNY: true,
      });
      expect(_sum).not.toHaveProperty("costCNY");
      expect(_sum).not.toHaveProperty("personalPaidCNY");
    });

    it("欠费也算已用 —— 那笔钱企业终究要付", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(allowance(50));
      prisma.computeUsageRecord.aggregate.mockResolvedValue({
        _sum: { creditPaidCNY: d(20), walletPaidCNY: d(20), unpaidCNY: d(10) },
      });

      const result = await service.check("ent-1", "user-1");
      expect(result.usedCNY).toBe("50.0000");
      expect(result.enterpriseFundsAllowed).toBe(false);
    });

    it("额度用尽 + 个人余额有钱 → 改道自费，对话照常发生", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(allowance(50));
      used(50);
      personalWallet.getBalance.mockResolvedValue(d(12.5));

      const result = await service.check("ent-1", "user-1");
      expect(result.enterpriseFundsAllowed).toBe(false);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain("个人余额支付");
      expect(result.personalBalanceCNY).toBe("12.50");
    });

    it("额度用尽 + 个人余额也空 → 才真的拦，且必须给出路", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(allowance(50));
      used(62.5);

      const result = await service.check("ent-1", "user-1");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("已用 ¥62.50");
      expect(result.reason).toContain("上限 ¥50.00");
      expect(result.reason).toContain("重置");
      expect(result.reason).toContain("企业管理员");
      expect(result.reason).toContain("充值");
    });

    it("结转金额要出现在话术里 —— 否则「上限 50 却花了 80」没法解释", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(allowance(50));
      prisma.memberAllowanceWindow.findUnique.mockResolvedValue({
        id: "w-1",
        carriedInCNY: d(30),
        limitAtOpenCNY: d(50),
      });
      used(80);

      const { reason } = await service.check("ent-1", "user-1");
      expect(reason).toContain("结转 ¥30.00");
    });

    it("常规额度用尽但有追加额度时继续走企业资金", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(allowance(50));
      used(50);
      prisma.memberAllowanceTopUp.findMany.mockResolvedValue([
        { id: "t-1", amountCNY: d(100), consumedCNY: d(40), version: 2 },
      ]);

      const result = await service.check("ent-1", "user-1");
      expect(result.enterpriseFundsAllowed).toBe(true);
      expect(result.remainingCNY).toBe("60.0000");
      expect(personalWallet.getBalance).not.toHaveBeenCalled();
    });

    it("闸门不给每个人建个人钱包 —— 只读余额", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(allowance(50));
      used(50);

      await service.check("ent-1", "user-1");
      expect(personalWallet.getBalance).toHaveBeenCalledWith("user-1");
    });
  });

  describe("结转 —— 新周期开门时", () => {
    beforeEach(() => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(
        allowance(500),
      );
      // 本周期还没有窗口行，上一周期有
      prisma.memberAllowanceWindow.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: "w-prev",
          carriedInCNY: d(0),
          limitAtOpenCNY: d(500),
        });
      prisma.computeUsageRecord.aggregate
        .mockResolvedValueOnce(emptyUsage) // 本周期已用 0
        .mockResolvedValueOnce({
          _sum: { creditPaidCNY: d(180), walletPaidCNY: d(0), unpaidCNY: d(0) },
        }); // 上周期已用 180
    });

    it("把上一周期没花完的部分落进新窗口行", async () => {
      await service.check("ent-1", "user-1");

      expect(prisma.memberAllowanceWindow.create).toHaveBeenCalledTimes(1);
      const data = prisma.memberAllowanceWindow.create.mock.calls[0][0].data;
      expect(new Decimal(data.carriedInCNY).toFixed(2)).toBe("320.00");
      expect(new Decimal(data.limitAtOpenCNY).toFixed(2)).toBe("500.00");
    });

    it("只回溯一行 —— 上上个周期一次都不查", async () => {
      await service.check("ent-1", "user-1");
      // 当前窗口 + 上一窗口，仅此两次
      expect(prisma.memberAllowanceWindow.findUnique).toHaveBeenCalledTimes(2);
    });

    it("额度是上周期开始之后才创建的 → 不结转（那时没有额度可剩）", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(
        allowance(500, { createdAt: new Date() }),
      );

      await service.check("ent-1", "user-1");
      const data = prisma.memberAllowanceWindow.create.mock.calls[0][0].data;
      expect(new Decimal(data.carriedInCNY).isZero()).toBe(true);
      // 没结转就不必查上一周期的窗口和用量
      expect(prisma.memberAllowanceWindow.findUnique).toHaveBeenCalledTimes(1);
    });

    it("关闭结转的成员不结转", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(
        allowance(500, { carryOver: false }),
      );

      await service.check("ent-1", "user-1");
      const data = prisma.memberAllowanceWindow.create.mock.calls[0][0].data;
      expect(new Decimal(data.carriedInCNY).isZero()).toBe(true);
    });

    it("并发的本周期第一次对话撞唯一约束时改读，不报错", async () => {
      const conflict = Object.assign(
        new (require("@prisma/client").Prisma.PrismaClientKnownRequestError)(
          "unique",
          { code: "P2002", clientVersion: "6" },
        ),
      );
      prisma.memberAllowanceWindow.create.mockRejectedValue(conflict);
      prisma.memberAllowanceWindow.findUniqueOrThrow.mockResolvedValue({
        id: "w-raced",
        carriedInCNY: d(320),
      });

      const result = await service.check("ent-1", "user-1");
      expect(result.windowId).toBe("w-raced");
    });

    it("不限额的成员不建窗口行 —— 没额度就没结转", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(
        allowance(null),
      );

      const result = await service.check("ent-1", "user-1");
      expect(result).toEqual({ enterpriseFundsAllowed: true, allowed: true });
      expect(prisma.memberAllowanceWindow.create).not.toHaveBeenCalled();
    });
  });

  describe("planCharge —— 扣费事务内给出企业资金上限", () => {
    it("不限额的成员不设上限，也不去查追加额度", async () => {
      const plan = await service.planCharge(prisma, {
        enterpriseId: "ent-1",
        userId: "user-1",
      });

      expect(plan.enterpriseCapCNY).toBeNull();
      expect(plan.windowId).toBeNull();
      expect(prisma.memberAllowanceTopUp.findMany).not.toHaveBeenCalled();
    });

    it("没有 userId（系统内部调用）时同样不设上限，连额度表都不查", async () => {
      const plan = await service.planCharge(prisma, {
        enterpriseId: "ent-1",
        userId: null,
      });

      expect(plan.enterpriseCapCNY).toBeNull();
      expect(prisma.memberComputeAllowance.findUnique).not.toHaveBeenCalled();
    });

    it("停用的额度不设上限 —— 与闸门放行的判断保持一致", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(
        allowance(50, { enabled: false }),
      );
      used(999);

      const plan = await service.planCharge(prisma, {
        enterpriseId: "ent-1",
        userId: "user-1",
      });
      expect(plan.enterpriseCapCNY).toBeNull();
    });

    it("返回金额上限而不是布尔值 —— 剩 ¥2 时这一笔企业最多出 ¥2", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(allowance(50));
      used(48);

      const plan = await service.planCharge(prisma, {
        enterpriseId: "ent-1",
        userId: "user-1",
      });

      expect(plan.enterpriseCapCNY!.toFixed(2)).toBe("2.00");
      expect(plan.regularRemainingCNY.toFixed(2)).toBe("2.00");
      // 账单要能按周期归集，所以窗口 id 必须跟着计划走
      expect(plan.windowId).toBe("w-1");
    });

    it("上限含未用完的追加额度，但与常规额度分开给出", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(allowance(50));
      used(48);
      prisma.memberAllowanceTopUp.findMany.mockResolvedValue([
        { id: "t-1", amountCNY: d(20), consumedCNY: d(5), version: 1 },
      ]);

      const plan = await service.planCharge(prisma, {
        enterpriseId: "ent-1",
        userId: "user-1",
      });

      // 常规剩 2 + 追加剩 15：合计 17 是这一笔的上限，
      // 拆开是为了知道超出 2 的部分才该记到追加额度上
      expect(plan.enterpriseCapCNY!.toFixed(2)).toBe("17.00");
      expect(plan.regularRemainingCNY.toFixed(2)).toBe("2.00");
      expect(plan.topUps).toHaveLength(1);
    });

    it("额度用尽时上限是 0（而不是不限额）—— 否则闸门在扣费时形同虚设", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(allowance(50));
      used(80);

      const plan = await service.planCharge(prisma, {
        enterpriseId: "ent-1",
        userId: "user-1",
      });
      expect(plan.enterpriseCapCNY).not.toBeNull();
      expect(plan.enterpriseCapCNY!.isZero()).toBe(true);
    });

    it("用量在传入的事务客户端上重新聚合 —— 不复用对话前 check 的结果", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(allowance(50));
      const tx = {
        ...prisma,
        computeUsageRecord: {
          aggregate: jest.fn().mockResolvedValue({
            _sum: {
              creditPaidCNY: d(30),
              walletPaidCNY: d(0),
              unpaidCNY: d(0),
            },
          }),
        },
      };

      const plan = await service.planCharge(tx as any, {
        enterpriseId: "ent-1",
        userId: "user-1",
      });

      expect(tx.computeUsageRecord.aggregate).toHaveBeenCalled();
      expect(prisma.computeUsageRecord.aggregate).not.toHaveBeenCalled();
      expect(plan.enterpriseCapCNY!.toFixed(2)).toBe("20.00");
    });
  });

  describe("commitCharge —— 扣费后回写追加额度消耗", () => {
    const planFor = (opts: {
      limit: number;
      used: number;
      topUps?: Array<{
        id: string;
        amountCNY: any;
        consumedCNY: any;
        version: number;
      }>;
    }) => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(
        allowance(opts.limit),
      );
      used(opts.used);
      if (opts.topUps) {
        prisma.memberAllowanceTopUp.findMany.mockResolvedValue(opts.topUps);
      }
      return service.planCharge(prisma, {
        enterpriseId: "ent-1",
        userId: "user-1",
      });
    };

    it("常规额度够用时不动追加额度", async () => {
      const plan = await planFor({ limit: 50, used: 10 });

      const result = await service.commitCharge(prisma, plan, d(5));

      expect(result.fromTopUpCNY.isZero()).toBe(true);
      expect(prisma.memberAllowanceTopUp.updateMany).not.toHaveBeenCalled();
    });

    it("超出常规额度的部分按批次先后记到追加额度上，且带乐观锁", async () => {
      const plan = await planFor({
        limit: 50,
        used: 48,
        topUps: [
          { id: "t-1", amountCNY: d(3), consumedCNY: d(0), version: 0 },
          { id: "t-2", amountCNY: d(20), consumedCNY: d(0), version: 7 },
        ],
      });

      const result = await service.commitCharge(prisma, plan, d(8));

      // 常规还剩 2，其余 6 由追加额度承担：t-1 出 3（用完），t-2 出 3
      expect(result.fromTopUpCNY.toFixed(2)).toBe("6.00");
      expect(prisma.memberAllowanceTopUp.updateMany).toHaveBeenCalledTimes(2);
      const [first, second] = prisma.memberAllowanceTopUp.updateMany.mock.calls;
      expect(first[0].where).toEqual({ id: "t-1", version: 0 });
      expect(first[0].data.consumedCNY.increment.toFixed(2)).toBe("3.00");
      expect(second[0].where).toEqual({ id: "t-2", version: 7 });
      expect(second[0].data.consumedCNY.increment.toFixed(2)).toBe("3.00");
      // version 必须同步 +1，否则乐观锁下一次仍会命中旧版本
      expect(second[0].data.version).toEqual({ increment: 1 });
    });

    it("追加额度也不够时只记到它用完为止 —— 差额由调用方作为欠费入账", async () => {
      const plan = await planFor({
        limit: 50,
        used: 50,
        topUps: [{ id: "t-1", amountCNY: d(4), consumedCNY: d(0), version: 0 }],
      });

      const result = await service.commitCharge(prisma, plan, d(10));

      expect(result.fromTopUpCNY.toFixed(2)).toBe("4.00");
      expect(prisma.memberAllowanceTopUp.updateMany).toHaveBeenCalledTimes(1);
    });

    it("乐观锁没命中就抛冲突 —— 宁可整笔重试也不能少记消耗", async () => {
      const plan = await planFor({
        limit: 50,
        used: 50,
        topUps: [
          { id: "t-1", amountCNY: d(20), consumedCNY: d(0), version: 0 },
        ],
      });
      prisma.memberAllowanceTopUp.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.commitCharge(prisma, plan, d(5))).rejects.toThrow(
        ConflictException,
      );
    });

    it("不限额的计划什么都不回写", async () => {
      const plan = await service.planCharge(prisma, {
        enterpriseId: "ent-1",
        userId: "user-1",
      });

      const result = await service.commitCharge(prisma, plan, d(999));

      expect(result.fromTopUpCNY.isZero()).toBe(true);
      expect(prisma.memberAllowanceTopUp.updateMany).not.toHaveBeenCalled();
    });

    it("企业这一笔一分钱没出时不回写（额度用尽、全额自费的情况）", async () => {
      const plan = await planFor({
        limit: 50,
        used: 50,
        topUps: [
          { id: "t-1", amountCNY: d(20), consumedCNY: d(0), version: 0 },
        ],
      });

      const result = await service.commitCharge(prisma, plan, d(0));

      expect(result.fromTopUpCNY.isZero()).toBe(true);
      expect(prisma.memberAllowanceTopUp.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("setAllowance", () => {
    it("不是本企业成员时报 404 —— 防止跨租户改别人额度", async () => {
      prisma.enterpriseMember.findFirst.mockResolvedValue(null);

      await expect(
        service.setAllowance("ent-1", "user-x", { limitCNY: 100 }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.memberComputeAllowance.upsert).not.toHaveBeenCalled();
    });

    it("传 null 用删除记录表达不限额，不留没有约束的空行", async () => {
      await service.setAllowance("ent-1", "user-1", { limitCNY: null });

      expect(prisma.memberComputeAllowance.deleteMany).toHaveBeenCalledWith({
        where: { enterpriseId: "ent-1", userId: "user-1" },
      });
      expect(prisma.memberComputeAllowance.upsert).not.toHaveBeenCalled();
    });

    it("分配额度不碰任何余额字段 —— 它是闸门不是划款", async () => {
      await service.setAllowance("ent-1", "user-1", { limitCNY: 500 });

      expect(prisma.enterpriseWallet.updateMany).not.toHaveBeenCalled();
      expect(prisma.enterpriseWallet.findUnique).not.toHaveBeenCalled();
    });

    it("周期与结转开关不传时沿用现有设置，不被默认值覆盖", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(
        allowance(200, { period: "WEEK", carryOver: false }),
      );

      await service.setAllowance("ent-1", "user-1", { limitCNY: 300 });

      const { update } = prisma.memberComputeAllowance.upsert.mock.calls[0][0];
      expect(update.period).toBe("WEEK");
      expect(update.carryOver).toBe(false);
    });

    it("每次变更留一条痕，带上变更时的已用金额", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(
        allowance(200),
      );
      used(88);

      await service.setAllowance(
        "ent-1",
        "user-1",
        { limitCNY: 500, note: "临时加" },
        "admin-1",
      );

      const { data } = prisma.memberAllowanceChange.create.mock.calls[0][0];
      expect(data.fromLimitCNY.toFixed(2)).toBe("200.00");
      expect(data.toLimitCNY.toFixed(2)).toBe("500.00");
      expect(data.usedAtChangeCNY.toFixed(2)).toBe("88.00");
      expect(data.changedById).toBe("admin-1");
      expect(data.note).toBe("临时加");
    });

    it("什么都没变又没写备注时不刷留痕表", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(
        allowance(200),
      );

      await service.setAllowance("ent-1", "user-1", { limitCNY: 200 });
      expect(prisma.memberAllowanceChange.create).not.toHaveBeenCalled();
    });

    it("中途调高上限要同步当前窗口的上限快照 —— 否则下期结转会算成超支", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(
        allowance(200),
      );

      await service.setAllowance("ent-1", "user-1", { limitCNY: 800 });

      const call = prisma.memberAllowanceWindow.updateMany.mock.calls[0][0];
      expect(call.where.allowanceId).toBe("a-1");
      expect(call.data.limitAtOpenCNY.toFixed(2)).toBe("800.00");
    });
  });

  describe("topUp", () => {
    it("成员不限额时拒绝 —— 追加的钱永远不会被消耗，是死数据", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(null);

      await expect(
        service.topUp("ent-1", "user-1", { amountCNY: 100 }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.memberAllowanceTopUp.create).not.toHaveBeenCalled();
    });

    it("不是本企业成员时报 404", async () => {
      prisma.enterpriseMember.findFirst.mockResolvedValue(null);

      await expect(
        service.topUp("ent-1", "user-x", { amountCNY: 100 }),
      ).rejects.toThrow(NotFoundException);
    });

    it("记下金额、备注与批准人", async () => {
      prisma.memberComputeAllowance.findUnique.mockResolvedValue(
        allowance(200),
      );

      await service.topUp(
        "ent-1",
        "user-1",
        { amountCNY: 150, note: "赶项目" },
        "admin-1",
      );

      const { data } = prisma.memberAllowanceTopUp.create.mock.calls[0][0];
      expect(data.amountCNY.toFixed(2)).toBe("150.00");
      expect(data.note).toBe("赶项目");
      expect(data.grantedById).toBe("admin-1");
    });
  });
});
