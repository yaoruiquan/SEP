import { Decimal } from "@prisma/client/runtime/library";
import {
  allocateTopUps,
  computeAvailability,
  computeCarriedIn,
  sumTopUpRemaining,
} from "./allowance-carryover";

const d = (n: number | string) => new Decimal(n);

/**
 * 结转与可用额度的算术。这里锁住的是**规则**本身：
 *   1. 结转封顶恰好 1 个周期（最多攒到 2 倍）—— 不封顶会摧毁 DAY 周期的全部意义
 *   2. 超支不倒扣下一周期
 *   3. 先常规、后追加（顺序可观测，因为追加跨周期存活）
 */
describe("allowance-carryover", () => {
  describe("computeCarriedIn", () => {
    it("上期没花完，剩多少结转多少", () => {
      expect(
        computeCarriedIn({
          limitCNY: d(500),
          previousLimitCNY: d(500),
          previousCarriedInCNY: d(0),
          previousUsedCNY: d(180),
        }).toFixed(2),
      ).toBe("320.00");
    });

    it("封顶在 1 个周期的额度 —— 连续两期没花也只结转 1 期", () => {
      // 上期上限 500、结转进来 500、一分没花 → 剩 1000，但只能结转 500
      expect(
        computeCarriedIn({
          limitCNY: d(500),
          previousLimitCNY: d(500),
          previousCarriedInCNY: d(500),
          previousUsedCNY: d(0),
        }).toFixed(2),
      ).toBe("500.00");
    });

    it("上期超支（管理员中途调低上限）不倒扣下一周期", () => {
      expect(
        computeCarriedIn({
          limitCNY: d(100),
          previousLimitCNY: d(100),
          previousCarriedInCNY: d(0),
          previousUsedCNY: d(260),
        }).toFixed(2),
      ).toBe("0.00");
    });

    it("结转上限用**本周期**的上限，不是上周期的", () => {
      // 上期上限 1000 没花，本期被调低到 200 → 只能结转 200
      expect(
        computeCarriedIn({
          limitCNY: d(200),
          previousLimitCNY: d(1000),
          previousCarriedInCNY: d(0),
          previousUsedCNY: d(0),
        }).toFixed(2),
      ).toBe("200.00");
    });

    it("不限额时结转无意义，返回 0", () => {
      expect(
        computeCarriedIn({
          limitCNY: null,
          previousLimitCNY: d(500),
          previousCarriedInCNY: d(0),
          previousUsedCNY: d(0),
        }).isZero(),
      ).toBe(true);
    });

    it("取不到上期上限快照时退回本期上限，不当成 0", () => {
      expect(
        computeCarriedIn({
          limitCNY: d(300),
          previousLimitCNY: null,
          previousCarriedInCNY: d(0),
          previousUsedCNY: d(120),
        }).toFixed(2),
      ).toBe("180.00");
    });
  });

  describe("computeAvailability", () => {
    it("不限额时三个字段都表达「没有约束」", () => {
      const a = computeAvailability({
        limitCNY: null,
        carriedInCNY: d(0),
        usedCNY: d(9999),
        topUpRemainingCNY: d(0),
      });
      expect(a.regularRemainingCNY).toBeNull();
      expect(a.totalRemainingCNY).toBeNull();
      expect(a.enterpriseFundsAllowed).toBe(true);
    });

    it("常规额度含结转", () => {
      const a = computeAvailability({
        limitCNY: d(500),
        carriedInCNY: d(200),
        usedCNY: d(650),
        topUpRemainingCNY: d(0),
      });
      expect(a.regularRemainingCNY!.toFixed(2)).toBe("50.00");
      expect(a.enterpriseFundsAllowed).toBe(true);
    });

    it("常规用尽但有追加额度时仍可动用企业资金", () => {
      const a = computeAvailability({
        limitCNY: d(500),
        carriedInCNY: d(0),
        usedCNY: d(500),
        topUpRemainingCNY: d(120),
      });
      expect(a.regularRemainingCNY!.isZero()).toBe(true);
      expect(a.totalRemainingCNY!.toFixed(2)).toBe("120.00");
      expect(a.enterpriseFundsAllowed).toBe(true);
    });

    it("刚好花到上限就关闸 —— 上限是「最多花这么多」", () => {
      const a = computeAvailability({
        limitCNY: d(50),
        carriedInCNY: d(0),
        usedCNY: d(50),
        topUpRemainingCNY: d(0),
      });
      expect(a.enterpriseFundsAllowed).toBe(false);
    });

    it("超支时剩余记 0 而不是负数", () => {
      const a = computeAvailability({
        limitCNY: d(50),
        carriedInCNY: d(0),
        usedCNY: d(80),
        topUpRemainingCNY: d(0),
      });
      expect(a.regularRemainingCNY!.isZero()).toBe(true);
      expect(a.totalRemainingCNY!.isZero()).toBe(true);
    });
  });

  describe("allocateTopUps", () => {
    const rows = [
      { id: "t1", amountCNY: d(100), consumedCNY: d(100), version: 3 },
      { id: "t2", amountCNY: d(50), consumedCNY: d(20), version: 1 },
      { id: "t3", amountCNY: d(80), consumedCNY: d(0), version: 0 },
    ];

    it("跳过已用完的批次，按先后顺序摊", () => {
      const { allocations, allocatedCNY } = allocateTopUps(rows, d(45));
      expect(allocations).toEqual([
        { id: "t2", version: 1, consumeCNY: d(30) },
        { id: "t3", version: 0, consumeCNY: d(15) },
      ]);
      expect(allocatedCNY.toFixed(2)).toBe("45.00");
    });

    it("带上乐观锁版本号 —— 并发消耗同一批次必须冲突而不是各扣一次", () => {
      const { allocations } = allocateTopUps(rows, d(10));
      expect(allocations[0]).toMatchObject({ id: "t2", version: 1 });
    });

    it("追加额度也不够时只分配到能分配的部分，差额由调用方记欠费", () => {
      const { allocations, allocatedCNY } = allocateTopUps(rows, d(500));
      expect(allocatedCNY.toFixed(2)).toBe("110.00");
      expect(allocations).toHaveLength(2);
    });

    it("金额为 0 或负时不产生任何写入", () => {
      expect(allocateTopUps(rows, d(0)).allocations).toEqual([]);
      expect(allocateTopUps(rows, d(-5)).allocations).toEqual([]);
    });

    it("sumTopUpRemaining 只数没用完的部分", () => {
      expect(sumTopUpRemaining(rows).toFixed(2)).toBe("110.00");
    });
  });
});
