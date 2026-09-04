import {
  ALLOWANCE_PERIODS,
  currentPeriodLabel,
  formatBusinessDateTime,
  nextResetAt,
  parseAllowancePeriod,
  periodLabel,
  previousPeriodWindow,
  resolvePeriodWindow,
  type AllowancePeriod,
} from "./allowance-period";

/** 北京时间字面量 → UTC 瞬间。测试里所有「期望值」都用它写，读起来是业务时区。 */
function bj(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, hh - 8, mm, ss));
}

describe("allowance-period", () => {
  describe("周期截断", () => {
    it("DAY：北京时间当日 00:00 起，次日 00:00 止", () => {
      const w = resolvePeriodWindow("DAY", bj(2026, 9, 3, 15, 42));
      expect(w.start).toEqual(bj(2026, 9, 3));
      expect(w.end).toEqual(bj(2026, 9, 4));
    });

    it("WEEK：周一起始 —— 周日归属上一周而非开启新周", () => {
      // 2026-09-06 是周日，2026-08-31 是周一
      const sunday = resolvePeriodWindow("WEEK", bj(2026, 9, 6, 23, 59));
      expect(sunday.start).toEqual(bj(2026, 8, 31));
      expect(sunday.end).toEqual(bj(2026, 9, 7));

      const monday = resolvePeriodWindow("WEEK", bj(2026, 9, 7, 0, 0, 1));
      expect(monday.start).toEqual(bj(2026, 9, 7));
    });

    it("MONTH：与 getOverview 的「本月消费」同一口径", () => {
      const w = resolvePeriodWindow("MONTH", bj(2026, 9, 17, 9, 30));
      expect(w.start).toEqual(bj(2026, 9, 1));
      expect(w.end).toEqual(bj(2026, 10, 1));
    });

    it("QUARTER：Q3 = 7/1 → 10/1", () => {
      const w = resolvePeriodWindow("QUARTER", bj(2026, 9, 3));
      expect(w.start).toEqual(bj(2026, 7, 1));
      expect(w.end).toEqual(bj(2026, 10, 1));
    });

    it("YEAR：1/1 → 次年 1/1", () => {
      const w = resolvePeriodWindow("YEAR", bj(2026, 9, 3));
      expect(w.start).toEqual(bj(2026, 1, 1));
      expect(w.end).toEqual(bj(2027, 1, 1));
    });
  });

  describe("边界：跨月/跨季/跨年", () => {
    it("1/31 当天的月窗口是 1/1 → 2/1，不会溢出到 3/3", () => {
      // 这是 addMonths(new Date(y,0,31), 1) 的经典陷阱：2 月没有 31 号会被推到 3 月。
      // 本实现总是从截断后的 1 号推进，所以陷阱不存在 —— 这条测试锁死该性质。
      const w = resolvePeriodWindow("MONTH", bj(2026, 1, 31, 23, 59, 59));
      expect(w.start).toEqual(bj(2026, 1, 1));
      expect(w.end).toEqual(bj(2026, 2, 1));
    });

    it("闰年 2 月：2024/2/29 属于 2/1 → 3/1", () => {
      const w = resolvePeriodWindow("MONTH", bj(2024, 2, 29, 12, 0));
      expect(w.start).toEqual(bj(2024, 2, 1));
      expect(w.end).toEqual(bj(2024, 3, 1));
    });

    it("12 月的月窗口跨年到次年 1/1", () => {
      const w = resolvePeriodWindow("MONTH", bj(2026, 12, 31, 23, 0));
      expect(w.end).toEqual(bj(2027, 1, 1));
    });

    it("Q4 的季窗口跨年到次年 1/1", () => {
      const w = resolvePeriodWindow("QUARTER", bj(2026, 11, 15));
      expect(w.start).toEqual(bj(2026, 10, 1));
      expect(w.end).toEqual(bj(2027, 1, 1));
    });

    it("跨年周：2026/12/28(周一) 的周窗口延伸到 2027/1/4", () => {
      const w = resolvePeriodWindow("WEEK", bj(2026, 12, 31));
      expect(w.start).toEqual(bj(2026, 12, 28));
      expect(w.end).toEqual(bj(2027, 1, 4));
    });
  });

  describe("时区独立性（本文件存在的理由）", () => {
    // 旧实现用 new Date(y, m, 1)，结果随 TZ 变化。这里把进程 TZ 换成三个
    // 分布很远的时区，窗口必须一模一样。
    const cases = [
      "UTC",
      "America/New_York",
      "Asia/Shanghai",
      "Pacific/Kiritimati",
    ];
    const at = bj(2026, 9, 1, 3, 0); // 北京 9/1 凌晨 3 点 = UTC 8/31 19:00

    it.each(cases)("TZ=%s 时月窗口仍是北京 9/1 → 10/1", (tz) => {
      const original = process.env.TZ;
      process.env.TZ = tz;
      try {
        const w = resolvePeriodWindow("MONTH", at);
        expect(w.start.toISOString()).toBe(bj(2026, 9, 1).toISOString());
        expect(w.end.toISOString()).toBe(bj(2026, 10, 1).toISOString());
      } finally {
        process.env.TZ = original;
      }
    });

    it("UTC 日界与北京日界不同：UTC 8/31 19:00 属于北京 9/1 这一天", () => {
      const w = resolvePeriodWindow("DAY", new Date("2026-08-31T19:00:00Z"));
      expect(w.start).toEqual(bj(2026, 9, 1));
      expect(w.end).toEqual(bj(2026, 9, 2));
    });

    it("北京 00:00 前一毫秒仍属于前一天（DAY 的 33% 错账就出在这 8 小时）", () => {
      const justBefore = new Date(bj(2026, 9, 3).getTime() - 1);
      expect(resolvePeriodWindow("DAY", justBefore).start).toEqual(
        bj(2026, 9, 2),
      );
    });
  });

  describe("previousPeriodWindow", () => {
    it.each(ALLOWANCE_PERIODS)(
      "%s：上一窗口的 end 严格等于本窗口的 start",
      (period) => {
        const current = resolvePeriodWindow(period, bj(2026, 9, 3, 10, 0));
        const prev = previousPeriodWindow(period, current);
        expect(prev.end).toEqual(current.start);
        expect(prev.start.getTime()).toBeLessThan(prev.end.getTime());
      },
    );

    it("3 月的上一个月是 2 月（不是「30 天前」）", () => {
      const march = resolvePeriodWindow("MONTH", bj(2026, 3, 15));
      expect(previousPeriodWindow("MONTH", march).start).toEqual(
        bj(2026, 2, 1),
      );
    });

    it("Q1 的上一个季度是上一年 Q4", () => {
      const q1 = resolvePeriodWindow("QUARTER", bj(2026, 2, 10));
      expect(previousPeriodWindow("QUARTER", q1).start).toEqual(
        bj(2025, 10, 1),
      );
    });
  });

  describe("窗口无缝且无重叠", () => {
    it.each(ALLOWANCE_PERIODS)("%s：连续 8 个窗口首尾相接", (period) => {
      let w = resolvePeriodWindow(period, bj(2026, 1, 5));
      for (let i = 0; i < 8; i++) {
        const next = resolvePeriodWindow(period, w.end);
        expect(next.start).toEqual(w.end);
        // end 是开区间，末刻仍属本窗口
        const lastMs = new Date(w.end.getTime() - 1);
        expect(resolvePeriodWindow(period, lastMs).start).toEqual(w.start);
        w = next;
      }
    });
  });

  describe("文案", () => {
    it("nextResetAt = 窗口 end", () => {
      expect(nextResetAt("MONTH", bj(2026, 9, 3))).toEqual(bj(2026, 10, 1));
    });

    it("formatBusinessDateTime 按北京时区渲染，不受服务器 TZ 影响", () => {
      const original = process.env.TZ;
      process.env.TZ = "UTC";
      try {
        // UTC 下 naive 渲染会得到「9月30日」—— 这是要防的那个 bug
        expect(formatBusinessDateTime(bj(2026, 10, 1))).toBe("2026年10月1日");
        expect(formatBusinessDateTime(bj(2026, 10, 1, 9, 5))).toBe(
          "2026年10月1日 09:05",
        );
      } finally {
        process.env.TZ = original;
      }
    });

    it("周期标签成对齐全", () => {
      for (const p of ALLOWANCE_PERIODS) {
        expect(periodLabel(p)).toBeTruthy();
        expect(currentPeriodLabel(p)).toBeTruthy();
      }
    });
  });

  describe("parseAllowancePeriod", () => {
    it("合法值原样返回", () => {
      for (const p of ALLOWANCE_PERIODS) {
        expect(parseAllowancePeriod(p)).toBe(p);
      }
    });

    it.each([["TOTAL"], ["month"], [""], [null], [undefined], [42]])(
      "非法值 %p 回落 MONTH",
      (raw) => {
        expect(parseAllowancePeriod(raw as unknown)).toBe<AllowancePeriod>(
          "MONTH",
        );
      },
    );
  });
});
