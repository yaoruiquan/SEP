'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useWalletTransactions, type TransactionFilters } from '@/lib/api/wallet';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { ArrowUpCircle, ArrowDownCircle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function WalletTransactionList() {
  const [filters, setFilters] = useState<TransactionFilters>({
    page: 1,
    limit: 20,
  });

  const { data, isLoading, error } = useWalletTransactions(filters);

  const handleTypeFilter = (type: string) => {
    setFilters((prev) => ({
      ...prev,
      type: type === 'all' ? undefined : (type as 'DEPOSIT' | 'CONSUME' | 'REFUND'),
      page: 1,
    }));
  };

  const handlePageChange = (newPage: number) => {
    setFilters((prev) => ({ ...prev, page: newPage }));
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>交易记录</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse flex gap-3">
                <div className="h-10 w-10 bg-gray-200 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-1/3" />
                  <div className="h-3 bg-gray-100 rounded w-1/4" />
                </div>
                <div className="h-5 bg-gray-200 rounded w-20" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-red-600">加载失败</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600">
            {error instanceof Error ? error.message : '获取交易记录失败'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>交易记录</CardTitle>
          <Select
            value={filters.type || 'all'}
            onValueChange={handleTypeFilter}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="DEPOSIT">充值</SelectItem>
              <SelectItem value="CONSUME">消费</SelectItem>
              <SelectItem value="REFUND">退款</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {data.items.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>暂无交易记录</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {data.items.map((tx) => (
                <TransactionItem key={tx.id} transaction={tx} />
              ))}
            </div>

            {/* 分页 */}
            {data.totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 pt-4 border-t">
                <p className="text-sm text-gray-600">
                  第 {data.page} / {data.totalPages} 页，共 {data.total} 条
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={data.page === 1}
                    onClick={() => handlePageChange(data.page - 1)}
                  >
                    上一页
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={data.page === data.totalPages}
                    onClick={() => handlePageChange(data.page + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TransactionItem({ transaction }: { transaction: any }) {
  const isPositive = transaction.type === 'DEPOSIT' || transaction.type === 'REFUND';
  const Icon = transaction.type === 'DEPOSIT' ? ArrowUpCircle : transaction.type === 'REFUND' ? RotateCw : ArrowDownCircle;
  const colorClass = isPositive ? 'text-green-600' : 'text-red-600';

  const typeLabel: Record<string, string> = {
    DEPOSIT: '充值',
    CONSUME: '消费',
    REFUND: '退款',
  };
  const label = typeLabel[transaction.type] || transaction.type;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border hover:bg-gray-50">
      <Icon className={`h-8 w-8 ${colorClass}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {transaction.description || label}
        </p>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>
            {format(new Date(transaction.createdAt), 'yyyy-MM-dd HH:mm', {
              locale: zhCN,
            })}
          </span>
          {transaction.relatedType && (
            <>
              <span>·</span>
              <span>
                {transaction.relatedType === 'subscription' ? '订阅' : '算力'}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="text-right">
        <p className={`text-sm font-semibold ${colorClass}`}>
          {isPositive ? '+' : ''}¥{Math.abs(Number(transaction.amount)).toFixed(2)}
        </p>
        <p className="text-xs text-gray-500">
          余额 ¥{Number(transaction.balanceAfter).toFixed(2)}
        </p>
      </div>
    </div>
  );
}
