'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CenteredSpinner } from '@/components/ui/feedback';
import { useComputeUsage } from '@/features/user/use-compute-usage';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export default function UsagePage() {
  const { data, isLoading, error } = useComputeUsage();

  if (isLoading) return <CenteredSpinner />;
  if (error) return <div className="p-6 text-center text-danger">加载失败: {error instanceof Error ? error.message : '未知错误'}</div>;
  if (!data) return <div className="p-6 text-center text-fg-muted">无法加载用量数据</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">用量统计</h1>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-fg-muted">账户余额</div>
            <div className="mt-1 text-2xl font-semibold">
              ¥{data.balance.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-fg-muted">累计消费</div>
            <div className="mt-1 text-2xl font-semibold text-danger">
              ¥{data.totalCost.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-fg-muted">输入 Token</div>
            <div className="mt-1 text-2xl font-semibold">
              {data.totalInputTokens.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-fg-muted">输出 Token</div>
            <div className="mt-1 text-2xl font-semibold">
              {data.totalOutputTokens.toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 交易记录 */}
      <Card>
        <CardHeader>
          <CardTitle>交易记录</CardTitle>
        </CardHeader>
        <CardContent>
          {data.transactions.length === 0 ? (
            <p className="py-8 text-center text-sm text-fg-muted">💰 暂无交易记录</p>
          ) : (
            <div className="space-y-3">
              {data.transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0"
                >
                  <div className="flex-1">
                    <div className="font-medium text-sm">{tx.description || '未命名交易'}</div>
                    <div className="mt-1 text-xs text-fg-muted">
                      {formatDistanceToNow(new Date(tx.createdAt), {
                        addSuffix: true,
                        locale: zhCN,
                      })}
                    </div>
                    {tx.metadata && (
                      <div className="mt-1 text-xs text-fg-subtle">
                        {tx.metadata.inputTokens && `输入 ${tx.metadata.inputTokens.toLocaleString()} tokens`}
                        {tx.metadata.inputTokens && tx.metadata.outputTokens && ' / '}
                        {tx.metadata.outputTokens && `输出 ${tx.metadata.outputTokens.toLocaleString()} tokens`}
                      </div>
                    )}
                  </div>
                  <div
                    className={`text-sm font-semibold ${
                      tx.amount < 0 ? 'text-danger' : 'text-success'
                    }`}
                  >
                    {tx.amount < 0 ? '' : '+'}
                    ¥{tx.amount.toFixed(4)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
