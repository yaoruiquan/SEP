/**
 * 算力消费明细 → CSV 文本。
 *
 * 纯函数，不碰网络也不碰 DOM：金额精度与 CSV 注入这两件事错了很难被发现
 * （导出的文件常常直接进财务的表格），所以单独成模块并有单测覆盖。
 */

import { format } from 'date-fns';
import type { UsageRecordItem } from '@/lib/api/use-compute-credit';

export const CSV_HEADER = [
  '时间',
  '硅基员工',
  '使用成员',
  '模型',
  '输入tokens',
  '输出tokens',
  '赠送扣减(元)',
  '钱包扣减(元)',
  '成员自付(元)',
  '欠费(元)',
  '合计成本(元)',
  '保底计价',
];

/** Excel 会把这些开头的值当公式执行。 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
/** 纯数字（含负号）没有公式风险，不能加前导单引号 —— 否则财务没法求和。 */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * CSV 单元格转义。
 *
 * 除了常规的引号转义，还要中和以 = + - @ 开头的值：Excel 会把它们当公式执行，
 * 而员工名、成员名都是用户可填的字段（CSV 注入）。
 * 但 `-12.5` 这种纯数字要原样保留，否则「防注入」会把金额列变成文本。
 */
export function csvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const risky = FORMULA_PREFIX.test(raw) && !PLAIN_NUMBER.test(raw);
  return `"${(risky ? `'${raw}` : raw).replace(/"/g, '""')}"`;
}

/**
 * 金额列写成裸数字，方便在 Excel 里直接求和 —— 不带 ¥。
 * 保留 4 位小数：单次对话成本常低于 1 分，两位小数会全变成 0.00。
 */
export function csvAmount(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return (Number.isFinite(n) ? n : 0).toFixed(4);
}

export function toCsvRow(r: UsageRecordItem): string {
  return [
    csvCell(format(new Date(r.createdAt), 'yyyy-MM-dd HH:mm:ss')),
    csvCell(r.employeeName),
    // 空单元格而不是「-」：CSV 是给表格软件读的，占位符号只会碍事
    csvCell(r.memberName ?? ''),
    csvCell(r.modelId),
    csvCell(r.inputTokens),
    csvCell(r.outputTokens),
    csvCell(csvAmount(r.creditPaidCNY)),
    csvCell(csvAmount(r.walletPaidCNY)),
    // 成员自付要与企业支出分列，财务对账时「公司花了多少」不能把员工自掏的钱算进来
    csvCell(csvAmount(r.personalPaidCNY)),
    csvCell(csvAmount(r.unpaidCNY)),
    csvCell(csvAmount(r.costCNY)),
    csvCell(r.fallbackPricing ? '是' : '否'),
  ].join(',');
}

export function buildUsageRecordsCsv(records: UsageRecordItem[]): string {
  return [CSV_HEADER.join(','), ...records.map(toCsvRow)].join('\n');
}
