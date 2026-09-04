import { Logger } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/library";
import { SETTING_KEYS } from "shared";
import { resolvePeriodWindow } from "./allowance-period";
import {
  AllowanceNotifierService,
  type AllowanceNotifyInput,
} from "./allowance-notifier.service";
import type { MemberAllowanceView } from "./member-allowance.types";

const d = (v: string | number) => new Decimal(v);

/** 2026-10-01 00:00 +08:00 —— 业务时区渲染成「2026年10月1日」，不带时间。 */
const RESET_AT = new Date(Date.UTC(2026, 8, 30, 16, 0, 0)).toISOString();

/**
 * 额度类通知三条。这个 spec 锁四件事：
 *
 *   1. **热路径不打库**：没越线的对话（绝大多数）一次查询都不该发生。
 *      判定退化成「先查库再看要不要发」的话，每条消息都要多付四五次查询。
 *   2. **一个周期只吵一次**：越线之后的每一句话都发通知，等于把通知中心变成垃圾场。
 *   3. **「已用尽」必须带出路**：重置时间 + 找管理员 + 个人充值。
 *      只说「不能用了」的通知，收件人下一步只能来问客服。
 *   4. **发信前按库里的数字复核**：管理员刚调高上限，就不该再收到「已用尽」。
 */
describe("AllowanceNotifierService", () => {
  let prisma: any;
  let notifications: any;
  let settings: any;
  let query: any;
  let svc: AllowanceNotifierService;
  let lowBalanceThreshold: string | undefined;

  beforeEach(() => {
    lowBalanceThreshold = undefined;
    prisma = {
      notification: { findMany: jest.fn().mockResolvedValue([]) },
      enterpriseMember: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ userId: "admin-1" }, { userId: "admin-2" }]),
      },
      enterpriseWallet: {
        findUnique: jest.fn().mockResolvedValue({ balance: d(8.5) }),
      },
    };
    notifications = {
      create: jest.fn().mockResolvedValue({ id: "n-1" }),
      createBatch: jest.fn().mockResolvedValue({ count: 2 }),
    };
    settings = {
      getEffectiveValue: jest.fn(async (key: string) =>
        key === SETTING_KEYS.LOW_BALANCE_THRESHOLD
          ? lowBalanceThreshold
          : undefined,
      ),
    };
    query = { getOne: jest.fn() };
    svc = new AllowanceNotifierService(prisma, notifications, settings, query);
  });

  /** 默认输入：¥500 上限、已用 ¥100、这一笔 ¥1，没动企业钱包。 */
  const inputOf = (
    overrides: Partial<AllowanceNotifyInput> = {},
  ): AllowanceNotifyInput => ({
    enterpriseId: "ent-1",
    userId: "user-1",
    windowId: "w-1",
    limitCNY: d(500),
    carriedInCNY: d(0),
    availableBeforeCNY: d(400),
    regularRemainingBeforeCNY: d(400),
    enterpriseUsedDeltaCNY: d(1),
    walletPaidCNY: d(0),
    ...overrides,
  });

  /** 默认视图：¥500 上限、已用 ¥410（82%）、剩 ¥90。 */
  const viewOf = (
    overrides: Partial<MemberAllowanceView> = {},
  ): MemberAllowanceView =>
    ({
      userId: "user-1",
      name: "张三",
      email: "zhangsan@example.com",
      departmentName: null,
      limitCNY: "500.00",
      period: "MONTH",
      periodLabel: "每月",
      carryOver: true,
      enabled: true,
      carriedInCNY: "0.00",
      usedCNY: "410.0000",
      remainingCNY: "90.0000",
      topUpRemainingCNY: "0.00",
      totalRemainingCNY: "90.0000",
      usedPct: 82,
      periodStart: new Date(Date.UTC(2026, 7, 31, 16, 0, 0)).toISOString(),
      resetAt: RESET_AT,
      ...overrides,
    }) as MemberAllowanceView;

  // ── 热路径 ───────────────────────────────────────────────────────────────

  it("❗不限额的成员一条通知都不发，也不打库", async () => {
    await svc.afterCharge(
      inputOf({ windowId: null, limitCNY: null, availableBeforeCNY: null }),
    );

    expect(notifications.create).not.toHaveBeenCalled();
    expect(notifications.createBatch).not.toHaveBeenCalled();
    expect(query.getOne).not.toHaveBeenCalled();
    expect(prisma.notification.findMany).not.toHaveBeenCalled();
  });

  it("系统扣费（没有 userId）不发额度通知", async () => {
    await svc.afterCharge(inputOf({ userId: null }));
    expect(notifications.create).not.toHaveBeenCalled();
    expect(query.getOne).not.toHaveBeenCalled();
  });

  it("❗没到 80% 时一次查询都不发生（这段代码每轮对话都跑）", async () => {
    // 已用 100 + 1 = 101 / 500 = 20%
    await svc.afterCharge(inputOf());

    expect(query.getOne).not.toHaveBeenCalled();
    expect(prisma.notification.findMany).not.toHaveBeenCalled();
    expect(prisma.enterpriseMember.findMany).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  // ── 即将用完 ─────────────────────────────────────────────────────────────

  it("❗刚过 80% → 成员一条 + 管理员各一条", async () => {
    query.getOne.mockResolvedValue(viewOf());
    // 已用 (500-101) + 1 = 400 → 80.0%
    await svc.afterCharge(
      inputOf({
        regularRemainingBeforeCNY: d(101),
        availableBeforeCNY: d(101),
      }),
    );

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        type: "ALLOWANCE_WARNING",
        relatedType: "allowance",
        relatedId: "w-1",
      }),
    );
    const member = notifications.create.mock.calls[0][0];
    expect(member.message).toContain("本月");
    expect(member.message).toContain("82%");
    expect(member.message).toContain("已用 ¥410.00 / 上限 ¥500.00");
    expect(member.message).toContain("2026年10月1日");

    expect(notifications.createBatch).toHaveBeenCalledWith(
      ["admin-1", "admin-2"],
      expect.objectContaining({ type: "ALLOWANCE_WARNING", relatedId: "w-1" }),
    );
    // 管理员那条必须点名是谁，否则他要挨个去面板里找
    expect(notifications.createBatch.mock.calls[0][1].message).toContain(
      "张三",
    );
  });

  it("79% 不发，80% 才发", async () => {
    query.getOne.mockResolvedValue(viewOf());
    await svc.afterCharge(
      inputOf({
        regularRemainingBeforeCNY: d(101),
        enterpriseUsedDeltaCNY: d(0.5),
      }),
    );
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it("❗同一周期越线第二次不再重复发，且不为此多查一次数字", async () => {
    prisma.notification.findMany.mockResolvedValue([
      { userId: "user-1", type: "ALLOWANCE_WARNING" },
      { userId: "admin-1", type: "ALLOWANCE_WARNING" },
      { userId: "admin-2", type: "ALLOWANCE_WARNING" },
    ]);

    await svc.afterCharge(inputOf({ regularRemainingBeforeCNY: d(50) }));

    expect(notifications.create).not.toHaveBeenCalled();
    expect(notifications.createBatch).not.toHaveBeenCalled();
    expect(query.getOne).not.toHaveBeenCalled();
  });

  it("只有部分收件人发过时，补给还没发过的那几个", async () => {
    prisma.notification.findMany.mockResolvedValue([
      { userId: "user-1", type: "ALLOWANCE_WARNING" },
    ]);
    query.getOne.mockResolvedValue(viewOf());

    await svc.afterCharge(inputOf({ regularRemainingBeforeCNY: d(50) }));

    expect(notifications.create).not.toHaveBeenCalled();
    expect(notifications.createBatch).toHaveBeenCalledWith(
      ["admin-1", "admin-2"],
      expect.anything(),
    );
  });

  it("❗已经报过「已用尽」之后不再补发「即将用完」", async () => {
    prisma.notification.findMany.mockResolvedValue([
      { userId: "user-1", type: "ALLOWANCE_EXHAUSTED" },
      { userId: "admin-1", type: "ALLOWANCE_EXHAUSTED" },
      { userId: "admin-2", type: "ALLOWANCE_EXHAUSTED" },
    ]);

    await svc.afterCharge(inputOf({ regularRemainingBeforeCNY: d(50) }));

    expect(notifications.create).not.toHaveBeenCalled();
    expect(notifications.createBatch).not.toHaveBeenCalled();
  });

  it("查重按 userId 前缀过滤 —— 只拿 relatedId 查会退化成全表扫", async () => {
    query.getOne.mockResolvedValue(viewOf());
    await svc.afterCharge(inputOf({ regularRemainingBeforeCNY: d(50) }));

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: { in: ["user-1", "admin-1", "admin-2"] },
          relatedId: "w-1",
        }),
      }),
    );
  });

  // ── 已用尽 ───────────────────────────────────────────────────────────────

  it("❗额度用尽 → 通知必须带重置时间和两个出路", async () => {
    query.getOne.mockResolvedValue(
      viewOf({
        usedCNY: "500.0000",
        remainingCNY: "0.0000",
        totalRemainingCNY: "0.0000",
        usedPct: 100,
      }),
    );

    await svc.afterCharge(
      inputOf({ availableBeforeCNY: d(1), regularRemainingBeforeCNY: d(1) }),
    );

    const member = notifications.create.mock.calls[0][0];
    expect(member.type).toBe("ALLOWANCE_EXHAUSTED");
    expect(member.message).toContain("已用尽");
    // 三样缺一不可：什么时候自动恢复、找谁能立刻恢复、自己怎么继续
    expect(member.message).toContain("2026年10月1日");
    expect(member.message).toContain("联系企业管理员");
    expect(member.message).toContain("个人余额充值");

    const admin = notifications.createBatch.mock.calls[0][1];
    expect(admin.type).toBe("ALLOWANCE_EXHAUSTED");
    expect(admin.message).toContain("张三");
    expect(admin.message).toContain("自费");
  });

  it("❗追加额度不稀释告警线：常规额度见底但追加额度还有 → 报「即将用完」而不是「已用尽」", async () => {
    query.getOne.mockResolvedValue(
      viewOf({
        usedCNY: "500.0000",
        remainingCNY: "0.0000",
        topUpRemainingCNY: "100.00",
        totalRemainingCNY: "100.0000",
        usedPct: 100,
      }),
    );

    await svc.afterCharge(
      inputOf({ availableBeforeCNY: d(100), regularRemainingBeforeCNY: d(0) }),
    );

    const member = notifications.create.mock.calls[0][0];
    expect(member.type).toBe("ALLOWANCE_WARNING");
    expect(member.message).toContain("另有未用完的追加额度 ¥100.00");
  });

  it("结转的额度算进分母，文案里也写明", async () => {
    query.getOne.mockResolvedValue(
      viewOf({
        carriedInCNY: "100.00",
        usedCNY: "500.0000",
        remainingCNY: "100.0000",
        totalRemainingCNY: "100.0000",
        usedPct: 83,
      }),
    );

    await svc.afterCharge(
      inputOf({
        carriedInCNY: d(100),
        availableBeforeCNY: d(101),
        regularRemainingBeforeCNY: d(101),
      }),
    );

    expect(notifications.create.mock.calls[0][0].message).toContain(
      "已用 ¥500.00 / 上限 ¥500.00 + 结转 ¥100.00",
    );
  });

  it("❗管理员刚调高了上限 → 按库里的数字复核后不再发「已用尽」", async () => {
    query.getOne.mockResolvedValue(
      viewOf({ totalRemainingCNY: "300.0000", usedPct: 62 }),
    );

    await svc.afterCharge(
      inputOf({ availableBeforeCNY: d(1), regularRemainingBeforeCNY: d(1) }),
    );

    expect(query.getOne).toHaveBeenCalled(); // 复核确实发生了
    expect(notifications.create).not.toHaveBeenCalled();
    expect(notifications.createBatch).not.toHaveBeenCalled();
  });

  it("复核时发现额度被清成不限额 → 什么都不发", async () => {
    query.getOne.mockResolvedValue(
      viewOf({ limitCNY: null, totalRemainingCNY: null, usedPct: null }),
    );

    await svc.afterCharge(inputOf({ availableBeforeCNY: d(1) }));

    expect(notifications.create).not.toHaveBeenCalled();
  });

  it("成员自己就是管理员时只收到成员那一条", async () => {
    prisma.enterpriseMember.findMany.mockResolvedValue([
      { userId: "user-1" },
      { userId: "admin-2" },
    ]);
    query.getOne.mockResolvedValue(viewOf());

    await svc.afterCharge(inputOf({ regularRemainingBeforeCNY: d(50) }));

    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.createBatch).toHaveBeenCalledWith(
      ["admin-2"],
      expect.anything(),
    );
  });

  it("❗通知写失败不能把一笔已经落账的消费变成 500", async () => {
    query.getOne.mockResolvedValue(viewOf());
    notifications.create.mockRejectedValue(new Error("db down"));
    // 这条用例故意触发错误日志，静音掉以免测试输出里出现假的失败堆栈
    const logged = jest.spyOn(Logger.prototype, "error").mockImplementation();

    await expect(
      svc.afterCharge(inputOf({ regularRemainingBeforeCNY: d(50) })),
    ).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalled(); // 吞掉不等于藏起来
    logged.mockRestore();
  });

  // ── 企业钱包余额偏低 ─────────────────────────────────────────────────────

  /** 钱包用例一律用不限额成员，避免额度那条通知混进断言。 */
  const walletInput = (overrides: Partial<AllowanceNotifyInput> = {}) =>
    inputOf({
      windowId: null,
      limitCNY: null,
      availableBeforeCNY: null,
      walletPaidCNY: d(0.5),
      ...overrides,
    });

  it("❗余额低于阈值 → 推给全体企业管理员", async () => {
    await svc.afterCharge(walletInput());

    expect(notifications.createBatch).toHaveBeenCalledWith(
      ["admin-1", "admin-2"],
      expect.objectContaining({
        type: "WALLET_LOW_BALANCE",
        relatedType: "wallet",
        relatedId: "ent-1",
      }),
    );
    const message = notifications.createBatch.mock.calls[0][1].message;
    expect(message).toContain("¥8.50");
    expect(message).toContain("¥10.00"); // 阈值未配置时的兜底
  });

  it("❗这一笔没动企业钱包 → 连余额都不查", async () => {
    await svc.afterCharge(walletInput({ walletPaidCNY: d(0) }));

    expect(prisma.enterpriseWallet.findUnique).not.toHaveBeenCalled();
    expect(settings.getEffectiveValue).not.toHaveBeenCalled();
    expect(notifications.createBatch).not.toHaveBeenCalled();
  });

  it("余额还在阈值之上 → 不打扰任何人", async () => {
    prisma.enterpriseWallet.findUnique.mockResolvedValue({ balance: d(12) });
    await svc.afterCharge(walletInput());
    expect(notifications.createBatch).not.toHaveBeenCalled();
  });

  it("阈值显式配 0 = 关掉这条通知，连余额都不查", async () => {
    lowBalanceThreshold = "0";
    await svc.afterCharge(walletInput());

    expect(prisma.enterpriseWallet.findUnique).not.toHaveBeenCalled();
    expect(notifications.createBatch).not.toHaveBeenCalled();
  });

  it("运营端调高阈值后按新阈值判定", async () => {
    lowBalanceThreshold = "50";
    prisma.enterpriseWallet.findUnique.mockResolvedValue({ balance: d(30) });

    await svc.afterCharge(walletInput());

    expect(notifications.createBatch.mock.calls[0][1].message).toContain(
      "¥50.00",
    );
  });

  it("❗一天最多一条：今天已收到的管理员被跳过", async () => {
    prisma.notification.findMany.mockResolvedValue([{ userId: "admin-1" }]);

    await svc.afterCharge(walletInput());

    expect(notifications.createBatch).toHaveBeenCalledWith(
      ["admin-2"],
      expect.anything(),
    );
    // 查重窗口是「业务时区的今天」，不是「最近 24 小时」
    const where = prisma.notification.findMany.mock.calls[0][0].where;
    expect(where.createdAt.gte).toEqual(
      resolvePeriodWindow("DAY", new Date()).start,
    );
  });

  it("今天全都收到过 → 一条不发", async () => {
    prisma.notification.findMany.mockResolvedValue([
      { userId: "admin-1" },
      { userId: "admin-2" },
    ]);

    await svc.afterCharge(walletInput());

    expect(notifications.createBatch).not.toHaveBeenCalled();
  });

  it("企业没有管理员时安静退出（不查通知表）", async () => {
    prisma.enterpriseMember.findMany.mockResolvedValue([]);

    await svc.afterCharge(walletInput());

    expect(prisma.notification.findMany).not.toHaveBeenCalled();
    expect(notifications.createBatch).not.toHaveBeenCalled();
  });

  it("钱包行还没建出来时不发通知（余额未知，不猜）", async () => {
    prisma.enterpriseWallet.findUnique.mockResolvedValue(null);

    await svc.afterCharge(walletInput());

    expect(notifications.createBatch).not.toHaveBeenCalled();
  });
});
