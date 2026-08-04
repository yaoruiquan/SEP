'use client';

import { useState } from 'react';
import { Download, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/feedback';
import { useComputeTransactions } from '@/features/admin/use-admin';
import type { ComputeTransaction } from '@/features/admin/admin-api';
import { cn } from '@/lib/utils';

export default function AdminComputePage() {
  const [tab, setTab] = useState<'RECHARGE' | 'CONSUME'>('RECHARGE');
  const [enterpriseId, setEnterpriseId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useComputeTransactions({
    type: tab,
    enterpriseId: enterpriseId || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    page,
    pageSize: 20,
  });

  const handleReset = () => {
    setEnterpriseId('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const exportCSV = () => {
    if (!data?.data || data.data.length === 0) {
      alert('无数据可导出');
      return;
    }

    const headers =
      tab === 'RECHARGE'
        ? ['时间', '企业', '金额', '备注', '操作员']
        : ['时间', '企业', '金额', '会话ID', '备注'];

    const rows = data.data.map((row) => {
      const operatorId = row.metadata?.operatorId || '-';
      const sessionInfo = row.sessionId || '-';

      return tab === 'RECHARGE'
        ? [
            new Date(row.createdAt).toLocaleString('zh-CN'),
            row.enterprise.name,
            row.amount.toFixed(2),
            row.description || '-',
            operatorId,
          ]
        : [
            new Date(row.createdAt).toLocaleString('zh-CN'),
            row.enterprise.name,
            Math.abs(row.amount).toFixed(2),
            sessionInfo,
            row.description || '-',
          ];
    });

    const csvContent = [headers, ...rows].map((row) => row.join(',')).join('\n');

    const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `算力${tab === 'RECHARGE' ? '充值' : '消费'}_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">算力管理</h1>
        <Button onClick={exportCSV} size="sm" variant="secondary">
          <Download className="mr-2 h-4 w-4" />
          导出 CSV
        </Button>
      </div>

      {/* Custom Tab Navigation */}
      <div className="flex gap-2 border-b">
        <button
          onClick={() => setTab('RECHARGE')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            tab === 'RECHARGE'
              ? 'border-primary text-primary'
              : 'border-transparent text-fg-muted hover:text-foreground',
          )}
        >
          充值记录
        </button>
        <button
          onClick={() => setTab('CONSUME')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            tab === 'CONSUME'
              ? 'border-primary text-primary'
              : 'border-transparent text-fg-muted hover:text-foreground',
          )}
        >
          消费记录
        </button>
      </div>

      {/* Tab Content */}
      <div className="mt-4">
        <Card variant="solid">
          <CardHeader>
            <CardTitle>{tab === 'RECHARGE' ? '充值记录' : '消费记录'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filters */}
            <div className="flex gap-4 items-end flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <label className="text-sm font-medium mb-2 block">企业ID</label>
                <Input
                  placeholder="输入企业ID"
                  value={enterpriseId}
                  onChange={(e) => setEnterpriseId(e.target.value)}
                />
              </div>
              <div className="flex-1 min-w-[150px]">
                <label className="text-sm font-medium mb-2 block">开始日期</label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="flex-1 min-w-[150px]">
                <label className="text-sm font-medium mb-2 block">结束日期</label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <Button onClick={() => setPage(1)} size="sm">
                <Search className="mr-2 h-4 w-4" />
                查询
              </Button>
              <Button onClick={handleReset} size="sm" variant="secondary">
                重置
              </Button>
            </div>

            {/* Table */}
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !data?.data || data.data.length === 0 ? (
              <p className="text-center py-8 text-sm text-fg-subtle">
                {tab === 'RECHARGE' ? '暂无充值记录' : '暂无消费记录'}
              </p>
            ) : (
              <>
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-fg-muted">
                        <th className="px-4 py-3 text-left font-medium">时间</th>
                        <th className="px-4 py-3 text-left font-medium">企业</th>
                        <th className="px-4 py-3 text-left font-medium">金额</th>
                        {tab === 'RECHARGE' ? (
                          <>
                            <th className="px-4 py-3 text-left font-medium">备注</th>
                            <th className="px-4 py-3 text-left font-medium">操作员</th>
                          </>
                        ) : (
                          <>
                            <th className="px-4 py-3 text-left font-medium">会话ID</th>
                            <th className="px-4 py-3 text-left font-medium">备注</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.map((txn) => (
                        <TransactionRow key={txn.id} transaction={txn} type={tab} />
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-fg-muted">
                    共 {data.total} 条记录，第 {data.page} / {data.totalPages} 页
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={page === 1}
                      onClick={() => setPage(page - 1)}
                    >
                      上一页
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={page === data.totalPages}
                      onClick={() => setPage(page + 1)}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TransactionRow({
  transaction,
  type,
}: {
  transaction: ComputeTransaction;
  type: 'RECHARGE' | 'CONSUME';
}) {
  const operatorId = transaction.metadata?.operatorId || '-';
  const sessionId = transaction.sessionId || '-';

  return (
    <tr className="border-b last:border-0 odd:bg-muted/20 hover:bg-muted/40 transition-colors">
      <td className="px-4 py-3 text-fg-muted">
        {new Date(transaction.createdAt).toLocaleString('zh-CN')}
      </td>
      <td className="px-4 py-3">{transaction.enterprise.name}</td>
      <td className="px-4 py-3">
        <span
          className={
            transaction.amount > 0 ? 'text-gsuccess font-medium' : 'text-gdanger font-medium'
          }
        >
          {transaction.amount > 0 ? '+' : ''}
          {transaction.amount.toFixed(2)}
        </span>
      </td>
      {type === 'RECHARGE' ? (
        <>
          <td className="px-4 py-3 text-fg-muted">{transaction.description || '-'}</td>
          <td className="px-4 py-3 text-fg-muted font-mono text-xs">{operatorId}</td>
        </>
      ) : (
        <>
          <td className="px-4 py-3 text-fg-muted font-mono text-xs">{sessionId}</td>
          <td className="px-4 py-3 text-fg-muted">{transaction.description || '-'}</td>
        </>
      )}
    </tr>
  );
}
