/**
 * 算力分配的周期边界 —— 纯函数，不碰数据库、不读服务器时区。
 *
 * ## 为什么必须显式指定时区
 *
 * 旧实现用 `new Date(y, m, 1)` 取月初，那是**服务器本地时区**的月初。
 * 容器跑 UTC（默认）时，它算出的「9 月」实际是北京时间 9/1 08:00 → 10/1 08:00。
 * 自然月周期下这个错误只影响每月约 1% 的账单（月初那 8 小时）；
 * 一旦支持 DAY 周期，就变成**每天 33% 的账单落到错误的窗口**（一天 24 小时错 8 小时）。
 *
 * ## 为什么用固定偏移而不是 IANA 时区库
 *
 * 业务时区是 Asia/Shanghai：1991 年起全国单一时区、无夏令时，UTC+8 恒定。
 * 固定偏移在这个前提下与 IANA 数据库结果完全一致，且不引入依赖、可纯函数测试。
 * 若将来要支持跨时区租户，把 `BUSINESS_UTC_OFFSET_MINUTES` 换成按租户解析的
 * IANA 时区即可 —— 本文件所有函数都只经由 `toBusinessParts` / `fromBusinessParts`
 * 触碰时区，是唯一的改动点。
 */

/** 分配额度的周期类型。`TOTAL`（永不重置）刻意不做：它就是「不限额 + 一次性追加额度」。 */
export type AllowancePeriod = "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR";

export const ALLOWANCE_PERIODS: readonly AllowancePeriod[] = [
  "DAY",
  "WEEK",
  "MONTH",
  "QUARTER",
  "YEAR",
] as const;

/** 业务时区 Asia/Shanghai = UTC+8，无夏令时。 */
const BUSINESS_UTC_OFFSET_MINUTES = 8 * 60;
const OFFSET_MS = BUSINESS_UTC_OFFSET_MINUTES * 60 * 1000;

/** 周起始日：周一。ISO-8601 与国内习惯一致（「本周」不从周日算）。 */
const WEEK_STARTS_ON_MONDAY = true;

export interface PeriodWindow {
  /** 含（>=） */
  start: Date;
  /** 不含（<）—— 同时就是下一周期的起点与「额度重置时刻」 */
  end: Date;
}

/** 某个瞬间在业务时区里的日历字段。 */
interface BusinessParts {
  year: number;
  /** 0–11 */
  month: number;
  day: number;
  /** 0=周日 … 6=周六 */
  weekday: number;
}

function toBusinessParts(instant: Date): BusinessParts {
  const shifted = new Date(instant.getTime() + OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/**
 * 业务时区的某天 00:00 对应的 UTC 瞬间。
 * `Date.UTC` 会自行归一化越界字段（month=12 → 次年 1 月，day=0 → 上月末日），
 * 所以调用方可以放心传 `month + 3` 或 `day + 7`。
 */
function fromBusinessParts(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - OFFSET_MS);
}

function startOfPeriodParts(
  period: AllowancePeriod,
  parts: BusinessParts,
): { year: number; month: number; day: number } {
  const { year, month, day, weekday } = parts;
  switch (period) {
    case "DAY":
      return { year, month, day };
    case "WEEK": {
      // 周一为起始：周日(0) 要回退 6 天，周一(1) 回退 0 天
      const back = WEEK_STARTS_ON_MONDAY ? (weekday + 6) % 7 : weekday;
      return { year, month, day: day - back };
    }
    case "MONTH":
      return { year, month, day: 1 };
    case "QUARTER":
      return { year, month: Math.floor(month / 3) * 3, day: 1 };
    case "YEAR":
      return { year, month: 0, day: 1 };
  }
}

function advanceOnePeriod(
  period: AllowancePeriod,
  start: { year: number; month: number; day: number },
): { year: number; month: number; day: number } {
  switch (period) {
    case "DAY":
      return { ...start, day: start.day + 1 };
    case "WEEK":
      return { ...start, day: start.day + 7 };
    case "MONTH":
      return { ...start, month: start.month + 1 };
    case "QUARTER":
      return { ...start, month: start.month + 3 };
    case "YEAR":
      return { ...start, year: start.year + 1 };
  }
}

/**
 * `at` 落在哪个周期窗口里。默认 `at = 现在`。
 *
 * 月末不会出现 1/31 + 1 月 = 3/3 那类溢出：窗口起点总是被截断到 1 号，
 * 「加一个月」永远是从 1 号加，不存在 31 号这个输入。`allowance-period.spec.ts`
 * 有一条测试专门锁死这个性质。
 */
export function resolvePeriodWindow(
  period: AllowancePeriod,
  at: Date = new Date(),
): PeriodWindow {
  const startParts = startOfPeriodParts(period, toBusinessParts(at));
  const endParts = advanceOnePeriod(period, startParts);
  return {
    start: fromBusinessParts(startParts.year, startParts.month, startParts.day),
    end: fromBusinessParts(endParts.year, endParts.month, endParts.day),
  };
}

/**
 * 上一个周期的窗口。
 *
 * 用「窗口起点前 1 毫秒」反查，而不是把日历字段减一个周期 ——
 * 前者天然复用截断逻辑，不需要为「上个月有几天」「上个季度是哪三个月」再写一遍。
 */
export function previousPeriodWindow(
  period: AllowancePeriod,
  window: PeriodWindow,
): PeriodWindow {
  return resolvePeriodWindow(period, new Date(window.start.getTime() - 1));
}

/** 额度重置时刻（= 本周期结束 = 下周期开始）。 */
export function nextResetAt(
  period: AllowancePeriod,
  at: Date = new Date(),
): Date {
  return resolvePeriodWindow(period, at).end;
}

const PERIOD_LABELS: Record<AllowancePeriod, string> = {
  DAY: "每日",
  WEEK: "每周",
  MONTH: "每月",
  QUARTER: "每季度",
  YEAR: "每年",
};

/** 「每月」「每日」…… 用于额度说明与拦下话术。 */
export function periodLabel(period: AllowancePeriod): string {
  return PERIOD_LABELS[period];
}

/** 「本月」「今天」…… 拦下话术里指代当前周期，比「本周期」像人话。 */
const CURRENT_PERIOD_LABELS: Record<AllowancePeriod, string> = {
  DAY: "今天",
  WEEK: "本周",
  MONTH: "本月",
  QUARTER: "本季度",
  YEAR: "今年",
};

export function currentPeriodLabel(period: AllowancePeriod): string {
  return CURRENT_PERIOD_LABELS[period];
}

/**
 * 业务时区下的「2026年10月1日 08:00」式文案。
 *
 * 不能直接用 `date.getMonth()` —— 那会按服务器时区渲染，
 * UTC 容器里 10/1 00:00+08:00 会显示成「9月30日」，正是本文件要消灭的错误。
 */
export function formatBusinessDateTime(instant: Date): string {
  const p = toBusinessParts(instant);
  const shifted = new Date(instant.getTime() + OFFSET_MS);
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  const time = hh === "00" && mm === "00" ? "" : ` ${hh}:${mm}`;
  return `${p.year}年${p.month + 1}月${p.day}日${time}`;
}

/** 解析持久化的 period 字符串；非法值回落 MONTH（存量行只有 'MONTH'）。 */
export function parseAllowancePeriod(raw: unknown): AllowancePeriod {
  return typeof raw === "string" &&
    (ALLOWANCE_PERIODS as readonly string[]).includes(raw)
    ? (raw as AllowancePeriod)
    : "MONTH";
}
