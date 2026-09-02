/**
 * 「我的硅基员工」卡片上的展示口径 —— 纯函数，不碰 React。
 *
 * 单独成文件的理由：这些判断（没用过 vs 很久没用、额度快用完的阈值、
 * 汇总条的分母）都是**会被追问的口径**，必须能单独立测。
 */
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import type { MyEmployee } from '@/lib/types';

/** 赠送额度剩余低于这个比例算「快用完」，进汇总条提醒 */
export const LOW_GIFT_THRESHOLD = 0.2;

/**
 * 上次使用时间。
 * null 表示从未调用过 —— 必须和「很久没用」区分开，
 * 否则新授权的员工看起来像被冷落的员工。
 */
export function formatLastUsed(lastUsedAt: string | null | undefined): string {
  if (!lastUsedAt) return '从未使用';
  const at = new Date(lastUsedAt);
  if (Number.isNaN(at.getTime())) return '从未使用';
  return formatDistanceToNow(at, { addSuffix: true, locale: zhCN });
}

/** 成功率：null 时留破折号，不要显示 0% */
export function formatSuccessRate(rate: number | null | undefined): string {
  return typeof rate === 'number' ? `${rate}%` : '—';
}

export interface GiftProgress {
  /**
   * **剩余**占比 0–100，用于进度条宽度。
   * 画剩余而不是已用：旁边的文案是「剩余 ¥x / ¥y」，
   * 条子必须和它同向，否则额度充足时反而显示成一条空槽。
   */
  remainingPercent: number;
  remainingCNY: number;
  grantedCNY: number;
  /** 剩余不足 20% 或已用尽 */
  low: boolean;
  exhausted: boolean;
}

/**
 * 赠送额度进度。
 * 没有赠送记录（giftStatus 为 NONE/缺失）或额度为 0 时返回 null —— 此时不该画进度条。
 */
export function giftProgress(employee: MyEmployee): GiftProgress | null {
  const { giftStatus, giftGrantedCNY, giftRemainingCNY } = employee;
  if (!giftStatus || giftStatus === 'NONE') return null;

  const grantedCNY = Number(giftGrantedCNY ?? 0);
  if (!Number.isFinite(grantedCNY) || grantedCNY <= 0) return null;

  const remainingCNY = Math.max(0, Number(giftRemainingCNY ?? 0));
  const ratio = Math.min(1, remainingCNY / grantedCNY);

  return {
    remainingPercent: Math.round(ratio * 100),
    remainingCNY,
    grantedCNY,
    low: ratio <= LOW_GIFT_THRESHOLD,
    exhausted: remainingCNY <= 0,
  };
}

export interface EmployeeListSummary {
  employeeCount: number;
  /** 本月合计消费（元，两位小数字符串） */
  monthCostCNY: string;
  /** 赠送额度快用完的员工数 */
  lowGiftCount: number;
}

/**
 * 列表页顶部汇总条。
 * 分母是「我可用的」员工数，不是企业买了多少 —— 页面本身就叫「我的硅基员工」。
 */
export function summarizeEmployees(
  employees: readonly MyEmployee[],
): EmployeeListSummary {
  let monthCost = 0;
  let lowGiftCount = 0;

  for (const employee of employees) {
    monthCost += Number(employee.usage?.monthCostCNY ?? 0) || 0;
    if (giftProgress(employee)?.low) lowGiftCount += 1;
  }

  return {
    employeeCount: employees.length,
    monthCostCNY: monthCost.toFixed(2),
    lowGiftCount,
  };
}
