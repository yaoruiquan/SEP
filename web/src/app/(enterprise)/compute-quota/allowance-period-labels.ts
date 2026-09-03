import type { AllowancePeriod } from '@/lib/api/use-compute-credit';

/**
 * 周期的中文名。
 *
 * 后端在 `MemberAllowanceItem.periodLabel` 里已经给了**当前周期**的名字，
 * 展示一律用那个字段。这里这份映射只服务于**选择器的选项**——
 * 要给「他还没选上的周期」也写出名字，只能前端自己列。
 * 所以别拿它去渲染已保存的额度，那会变成两份口径。
 */
export const PERIOD_LABELS: Record<AllowancePeriod, string> = {
  DAY: '每日',
  WEEK: '每周',
  MONTH: '每月',
  QUARTER: '每季度',
  YEAR: '每年',
};

/** 「¥500/月」里的那个「月」。 */
export const PERIOD_UNITS: Record<AllowancePeriod, string> = {
  DAY: '日',
  WEEK: '周',
  MONTH: '月',
  QUARTER: '季',
  YEAR: '年',
};

/** 「本月」「今天」—— 指代当前周期，比「本周期」像人话，与后端话术同一套词。 */
export const CURRENT_PERIOD_LABELS: Record<AllowancePeriod, string> = {
  DAY: '今天',
  WEEK: '本周',
  MONTH: '本月',
  QUARTER: '本季度',
  YEAR: '今年',
};

export const PERIOD_OPTIONS: readonly AllowancePeriod[] = [
  'DAY',
  'WEEK',
  'MONTH',
  'QUARTER',
  'YEAR',
] as const;
