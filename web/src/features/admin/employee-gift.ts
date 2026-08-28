/**
 * 「订阅赠送算力（元）」输入框的三态解析。
 *
 * 这个字段有三种意图，用一个 number 状态表达不出来，所以表单里用字符串：
 *   ''      → null   未配置，订阅时取系统默认值 DEFAULT_EMPLOYEE_GIFT_CNY
 *   '0'     → 0      运营明确「本员工不赠送」
 *   '1000'  → 1000   员工级覆盖值
 *
 * 后端的 includedComputeCNY 列同样是三态（nullable），两端语义必须一致 ——
 * 前端把空串折成 0 会让系统默认值永远不生效。
 */
export type ParsedGift = number | null | 'invalid';

export function parseGiftInput(raw: string): ParsedGift {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return 'invalid';
  // 与后端 CnyAmountSchema 保持一致：最多两位小数
  if (Math.round(value * 100) !== Number((value * 100).toFixed(4))) return 'invalid';

  return Math.round(value * 100) / 100;
}

/** 把后端返回的三态值还原成输入框的字符串。 */
export function formatGiftInput(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}
