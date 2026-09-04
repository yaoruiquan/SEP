'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Receipt,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatCnyPrecise, useUsageRecords } from '@/lib/api/use-compute-credit';

/** 成员端一页 10 条。这块是页面的第二屏内容，不该抢走个人余额卡片的位置。 */
const PAGE_SIZE = 10;

/**
 * 我的算力消费明细 —— 成员端的逐笔账单。
 *
 * 与管理员那张表（`usage-record-table.tsx`）读**同一个**接口
 * （`/compute-credit/usage-records`），区别全在后端：控制层从 JWT 推出作用域，
 * 成员的 `userId` 写在 `where` 的最后一位，覆盖任何 `?memberId=`。
 * 所以这里不需要、也**不能**提供「使用成员」筛选 —— 它一行也放不宽。
 *
 * 为什么不直接复用管理员那张表：它的筛选栏要调 `useSubscriptionCredits`
 * 和 `useMembers`，两个接口对成员都是 403 —— 挂上去就是进页面先失败两次。
 *
 * 列也刻意不同。管理员要分「赠送 / 钱包 / 成员自付」三个来源做归因；
 * 成员只关心一件事：**这笔钱是公司付的还是我自己付的**。所以赠送与钱包
 * 合成「公司付」一列 —— 对他来说那两笔都是公司的钱。
 */
export function MyUsageRecords() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useUsageRecords({
    page,
    pageSize: PAGE_SIZE,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // 取数失败要说出来。静默隐藏会让用户以为「我没有消费记录」——
  // 而这一页正是他来核对花销的地方，空白比报错更误导。
  if (isError || !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-fg-muted">
          消费明细暂时读取失败，刷新页面可重试。
        </CardContent>
      </Card>
    );
  }

  if (data.records.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          <Receipt className="mx-auto mb-3 h-10 w-10 opacity-40" />
          <p className="font-medium">还没有消费记录</p>
          <p className="mt-1 text-sm">
            与硅基员工对话后，每次模型调用都会在这里留下一行账单
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/70 text-xs text-fg-muted">
                <th className="px-4 py-3 text-left font-medium">时间</th>
                <th className="px-4 py-3 text-left font-medium">硅基员工</th>
                <th className="px-4 py-3 text-left font-medium">模型</th>
                <th className="px-4 py-3 text-right font-medium">
                  输入 / 输出 tokens
                </th>
                <th className="px-4 py-3 text-right font-medium">公司付</th>
                <th className="px-4 py-3 text-right font-medium">我自费</th>
                <th className="px-4 py-3 text-right font-medium">本次成本</th>
              </tr>
            </thead>
            <tbody>
              {data.records.map((r) => {
                // 赠送 + 钱包 = 公司付。成员分不清也不需要分清这两笔的来源
                const byCompany =
                  Number(r.creditPaidCNY) + Number(r.walletPaidCNY);
                const bySelf = Number(r.personalPaidCNY);
                return (
                  <tr
                    key={r.id}
                    className="border-b border-border/40 last:border-b-0 hover:bg-muted/40"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-fg-muted">
                      {format(new Date(r.createdAt), 'MM/dd HH:mm', {
                        locale: zhCN,
                      })}
                    </td>
                    <td className="px-4 py-3">{r.employeeName}</td>
                    <td className="px-4 py-3 font-mono text-xs">{r.modelId}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-fg-muted">
                      {r.inputTokens.toLocaleString('zh-CN')} /{' '}
                      {r.outputTokens.toLocaleString('zh-CN')}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-600">
                      {byCompany > 0 ? `-${formatCnyPrecise(byCompany)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-amber-600">
                      {bySelf > 0 ? (
                        <span title="公司额度或企业资金已用尽，这一笔由你的个人余额支付">
                          -{formatCnyPrecise(bySelf)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {formatCnyPrecise(r.costCNY)}
                      {Number(r.unpaidCNY) > 0 && (
                        <span
                          title="额度与个人余额都已用尽，这部分未能扣款"
                          className="ml-1 text-xs font-normal text-red-500"
                        >
                          欠 {formatCnyPrecise(r.unpaidCNY)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
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
      </CardContent>
    </Card>
  );
}
