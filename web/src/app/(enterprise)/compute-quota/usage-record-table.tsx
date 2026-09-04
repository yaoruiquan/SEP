'use client';

import { useCallback, useState } from 'react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { formatCnyPrecise, useUsageRecords } from '@/lib/api/use-compute-credit';
import { exportUsageRecordsCsv } from './usage-record-export';
import { UsageRecordFilters, type UsageFilterState } from './usage-record-filters';

const PAGE_SIZE = 20;

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="py-12 text-center text-muted-foreground">
      <Receipt className="mx-auto mb-4 h-12 w-12 opacity-40" />
      {filtered ? (
        <>
          <p className="font-medium">该筛选下没有算力消费记录</p>
          <p className="mt-1 text-sm">换个员工、成员或日期区间再看</p>
        </>
      ) : (
        <>
          <p className="font-medium">暂无算力消费记录</p>
          <p className="mt-1 text-sm">
            与硅基员工对话后，每次模型调用都会在这里留下账单
          </p>
        </>
      )}
    </div>
  );
}

/**
 * 算力消费明细 —— 全站唯一的逐笔算力账单。
 *
 * 每行的主口径是人民币成本，并拆出「赠送 / 钱包 / 成员自付」三个来源 ——
 * 用户最常问的是「这笔钱从哪扣的」。四者相加恒等于合计成本
 * （`credit + wallet + personal + unpaid == cost`，后端有单测锁死）。
 * Token 放在中间作为用量明细：
 * 它是明细口径，不是余额单位，所以留在这张表里而不出现在上方的余额横条。
 *
 * 「用量分析」页原本还有一张同源的日志表，已收敛到这里，只留一个跳转链接。
 */
export function UsageRecordTable() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<UsageFilterState>({});
  const [exporting, setExporting] = useState(false);

  const { data, isLoading } = useUsageRecords({ ...filters, page, pageSize: PAGE_SIZE });

  const hasFilter =
    !!filters.employeeId || !!filters.memberId || !!filters.startDate || !!filters.endDate;

  const handleFilterChange = useCallback((next: UsageFilterState) => {
    setFilters(next);
    setPage(1);
  }, []);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await exportUsageRecordsCsv(filters);
      if (result.rows === 0) {
        toast.error('当前筛选无数据可导出');
      } else if (result.truncated) {
        toast.warning(
          `已导出前 ${result.rows.toLocaleString('zh-CN')} 条`,
          '超出单次导出上限，请收窄日期范围后再导剩余部分',
        );
      } else {
        toast.success(`已导出 ${result.rows.toLocaleString('zh-CN')} 条`);
      }
    } catch (error) {
      toast.error('导出失败', error instanceof Error ? error.message : undefined);
    } finally {
      setExporting(false);
    }
  }, [filters]);

  return (
    <Card>
      <CardContent className="p-0">
        <UsageRecordFilters
          value={filters}
          onChange={handleFilterChange}
          onExport={handleExport}
          exporting={exporting}
          total={data?.total ?? 0}
        />

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !data || data.records.length === 0 ? (
          <EmptyState filtered={hasFilter} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 text-xs text-fg-muted">
                    <th className="px-4 py-3 text-left font-medium">时间</th>
                    <th className="px-4 py-3 text-left font-medium">硅基员工</th>
                    <th className="px-4 py-3 text-left font-medium">使用成员</th>
                    <th className="px-4 py-3 text-left font-medium">模型</th>
                    <th className="px-4 py-3 text-right font-medium">输入 / 输出 tokens</th>
                    <th className="px-4 py-3 text-right font-medium">赠送扣减</th>
                    <th className="px-4 py-3 text-right font-medium">钱包扣减</th>
                    {/*
                      成员自付单独一列，不并进「钱包扣减」：这一列 > 0 的含义很具体 ——
                      他本周期的算力额度用尽了，或者企业资金见底了。混进企业支出里，
                      「公司这个月花了多少」这个数字就不准了。
                    */}
                    <th className="px-4 py-3 text-right font-medium">成员自付</th>
                    <th className="px-4 py-3 text-right font-medium">合计成本</th>
                  </tr>
                </thead>
                <tbody>
                  {data.records.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border/40 last:border-b-0 hover:bg-muted/40"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-fg-muted">
                        {format(new Date(r.createdAt), 'MM/dd HH:mm', { locale: zhCN })}
                      </td>
                      <td className="px-4 py-3">{r.employeeName}</td>
                      <td className="px-4 py-3 text-fg-muted">{r.memberName ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1">
                          <span className="font-mono text-xs">{r.modelId}</span>
                          {r.fallbackPricing && (
                            <span
                              title="该模型未配置价格，按保底价计费"
                              className="inline-flex items-center text-amber-600"
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-fg-muted">
                        {r.inputTokens.toLocaleString('zh-CN')} /{' '}
                        {r.outputTokens.toLocaleString('zh-CN')}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-600">
                        {Number(r.creditPaidCNY) > 0
                          ? `-${formatCnyPrecise(r.creditPaidCNY)}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-violet-600">
                        {Number(r.walletPaidCNY) > 0
                          ? `-${formatCnyPrecise(r.walletPaidCNY)}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-amber-600">
                        {Number(r.personalPaidCNY) > 0 ? (
                          <span title="企业资金或本周期额度已用尽，这部分由该成员的个人余额支付">
                            -{formatCnyPrecise(r.personalPaidCNY)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                        {formatCnyPrecise(r.costCNY)}
                        {Number(r.unpaidCNY) > 0 && (
                          <span
                            title="余额不足，这部分未能扣款"
                            className="ml-1 text-xs font-normal text-red-500"
                          >
                            欠 {formatCnyPrecise(r.unpaidCNY)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-border/70 px-4 py-3 text-xs text-fg-muted">
              <span>
                共 {data.total} 条 · 第 {data.page} / {data.totalPages} 页
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="glass"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  上一页
                </Button>
                <Button
                  size="sm"
                  variant="glass"
                  disabled={page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
