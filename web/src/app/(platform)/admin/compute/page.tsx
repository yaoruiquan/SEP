'use client';

import { useState } from 'react';
import { Download, Search, Plus, DollarSign, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/feedback';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useComputeTransactions, useAllEnterprises, useCreditAdjustment } from '@/features/admin/use-admin';
import type { ComputeTransaction } from '@/features/admin/admin-api';
import { cn } from '@/lib/utils';

export default function AdminComputePage() {
  const [tab, setTab] = useState<'RECHARGE' | 'CONSUME'>('RECHARGE');
  const [enterpriseId, setEnterpriseId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [rechargeDialogOpen, setRechargeDialogOpen] = useState(false);
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState('');
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [rechargeNote, setRechargeNote] = useState('');
  const [enterpriseSearchTerm, setEnterpriseSearchTerm] = useState('');

  const { data, isLoading } = useComputeTransactions({
    type: tab,
    enterpriseId: enterpriseId || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    page,
    pageSize: 20,
  });

  const { data: allTransactions } = useComputeTransactions({
    pageSize: 9999,
  });

  const { data: enterprises } = useAllEnterprises();
  const creditAdjustmentMutation = useCreditAdjustment();

  const handleReset = () => {
    setEnterpriseId('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const handleQuickRecharge = async () => {
    if (!selectedEnterpriseId || !rechargeAmount || parseFloat(rechargeAmount) <= 0) {
      alert('请选择企业并输入有效的充值金额');
      return;
    }

    try {
      await creditAdjustmentMutation.mutateAsync({
        id: selectedEnterpriseId,
        data: {
          amount: parseFloat(rechargeAmount),
          type: 'RECHARGE',
          note: rechargeNote || '运营端快速充值',
        },
      });

      alert('充值成功');
      setRechargeDialogOpen(false);
      setSelectedEnterpriseId('');
      setRechargeAmount('');
      setRechargeNote('');
      setEnterpriseSearchTerm('');
    } catch (error: any) {
      alert(error?.message || '充值失败');
    }
  };

  const filteredEnterprises = enterprises?.filter((ent) =>
    ent.name.toLowerCase().includes(enterpriseSearchTerm.toLowerCase())
  );

  const stats = allTransactions?.data
    ? allTransactions.data.reduce(
        (acc, txn) => {
          if (txn.type === 'RECHARGE') {
            acc.totalRecharge += txn.amount;
          } else if (txn.type === 'CONSUME') {
            acc.totalConsume += Math.abs(txn.amount);
          }
          return acc;
        },
        { totalRecharge: 0, totalConsume: 0 }
      )
    : { totalRecharge: 0, totalConsume: 0 };

  // 钱包余额之和（元）。旧代码求和的是 ent.computeAccount?.balance ——
  // 那个字段已废弃，导致这里显示 ¥15,507.95 而平台实际持有 ¥93,558.98。
  const totalBalance = enterprises?.reduce((sum, ent) => sum + (ent.balance ?? 0), 0) ?? 0;

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
        <h1 className="text-xl font-semibold">账户管理</h1>
        <div className="flex gap-2">
          <Button onClick={() => setRechargeDialogOpen(true)} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            快速充值
          </Button>
          <Button onClick={exportCSV} size="sm" variant="secondary">
            <Download className="mr-2 h-4 w-4" />
            导出 CSV
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card variant="solid">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-fg-muted">累计充值</p>
                <p className="text-2xl font-semibold mt-1">¥{stats.totalRecharge.toFixed(2)}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-success/10 flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card variant="solid">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-fg-muted">累计消费</p>
                <p className="text-2xl font-semibold mt-1">¥{stats.totalConsume.toFixed(2)}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-danger/10 flex items-center justify-center">
                <TrendingDown className="h-6 w-6 text-danger" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card variant="solid">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-fg-muted">当前总余额</p>
                <p className="text-2xl font-semibold mt-1">¥{totalBalance.toFixed(2)}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <DollarSign className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Recharge Dialog */}
      <Dialog open={rechargeDialogOpen} onOpenChange={setRechargeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>快速充值</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="enterprise">选择企业</Label>
              <Input
                id="enterprise-search"
                placeholder="搜索企业名称..."
                value={enterpriseSearchTerm}
                onChange={(e) => setEnterpriseSearchTerm(e.target.value)}
                className="mb-2"
              />
              <div className="border rounded-md max-h-48 overflow-y-auto">
                {!enterprises ? (
                  <div className="p-4 text-center text-sm text-fg-muted">加载中...</div>
                ) : filteredEnterprises && filteredEnterprises.length > 0 ? (
                  filteredEnterprises.map((ent) => (
                    <button
                      key={ent.id}
                      onClick={() => setSelectedEnterpriseId(ent.id)}
                      className={cn(
                        'w-full px-4 py-2 text-left text-sm hover:bg-muted/40 transition-colors border-b last:border-0',
                        selectedEnterpriseId === ent.id && 'bg-primary/10 font-medium'
                      )}
                    >
                      <div className="flex justify-between items-center">
                        <span>{ent.name}</span>
                        <span className="text-xs text-fg-muted">
                          余额: ¥{(ent.balance ?? 0).toFixed(2)}
                        </span>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="p-4 text-center text-sm text-fg-muted">无匹配企业</div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount">充值金额（元）</Label>
              <Input
                id="amount"
                type="number"
                placeholder="请输入充值金额"
                value={rechargeAmount}
                onChange={(e) => setRechargeAmount(e.target.value)}
                min="0"
                step="0.01"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">备注（可选）</Label>
              <Input
                id="note"
                placeholder="请输入备注信息"
                value={rechargeNote}
                onChange={(e) => setRechargeNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRechargeDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleQuickRecharge}
              disabled={creditAdjustmentMutation.isPending || !selectedEnterpriseId || !rechargeAmount}
            >
              {creditAdjustmentMutation.isPending ? '充值中...' : '确认充值'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
