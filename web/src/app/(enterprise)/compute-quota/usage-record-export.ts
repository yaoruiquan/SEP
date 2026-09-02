/**
 * 算力消费明细的 CSV 导出（拉取 + 下载）。
 *
 * 导出的是**当前筛选下的全部记录**，不是屏幕上那一页 —— 一个只导出 20 行的
 * 「导出」按钮比没有这个按钮更坏，用户不会发现少了。为此逐页拉取，
 * 并对总量设上限（MAX_ROWS），避免一次点击把几十万行拽进浏览器。
 *
 * CSV 文本的拼装在 `usage-record-csv.ts`（纯函数，有单测），这里只管 IO。
 */

import { format } from 'date-fns';
import {
  fetchUsageRecords,
  type UsageRecordFilters,
  type UsageRecordItem,
} from '@/lib/api/use-compute-credit';
import { buildUsageRecordsCsv } from './usage-record-csv';

/** 后端 pageSize 上限就是 100，再大也会被截断。 */
const FETCH_PAGE_SIZE = 100;
/** 5000 行 ≈ 1MB CSV，超过就提示用户收窄日期范围。 */
export const MAX_EXPORT_ROWS = 5000;

export interface ExportResult {
  rows: number;
  /** true = 命中导出上限，导出的不是全量 */
  truncated: boolean;
}

/** 逐页拉全量。filters 里的 page / pageSize 由本函数接管。 */
async function collectRecords(
  filters: UsageRecordFilters,
): Promise<{ records: UsageRecordItem[]; truncated: boolean }> {
  const records: UsageRecordItem[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await fetchUsageRecords({
      ...filters,
      page,
      pageSize: FETCH_PAGE_SIZE,
    });
    totalPages = res.totalPages;
    records.push(...res.records);
    page += 1;
  } while (page <= totalPages && records.length < MAX_EXPORT_ROWS);

  const truncated = records.length >= MAX_EXPORT_ROWS && page <= totalPages;
  return { records: records.slice(0, MAX_EXPORT_ROWS), truncated };
}

function triggerDownload(csv: string) {
  // BOM 必须有：没有它 Excel 会把中文列头读成乱码
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `算力消费明细_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportUsageRecordsCsv(
  filters: UsageRecordFilters,
): Promise<ExportResult> {
  const { records, truncated } = await collectRecords(filters);
  if (records.length === 0) return { rows: 0, truncated: false };

  triggerDownload(buildUsageRecordsCsv(records));
  return { rows: records.length, truncated };
}
