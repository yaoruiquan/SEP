'use client';

import { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Wallet, Zap, AlertTriangle, ArrowDownLeft, ArrowUpLeft, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import {
  useComputeAccount,
  useComputeStats,
  useComputeTransactions,
  useRecharge,
} from '@/features/compute/use-compute';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export default function UsagePage() {
  const { data: account, isLoading: accountLoading } = useComputeAccount();
  const { data: stats, isLoading: statsLoading } = useComputeStats();
  const { data: transactionsData, isLoading: transactionsLoading } = useComputeTransactions({ limit: 50 });
  const recharge = useRecharge();

  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [rechargeAmount, setRechargeAmount] = useState('');

  const handleRecharge = async () => {
    const amount = parseFloat(rechargeAmount);
    if (!amount || amount <= 0) {
      toast.error('请输入有效的充值金额');
      return;
    }

    try {
      await recharge.mutateAsync({ amount, description: '账户充值' });
      toast.success(`充值成功，已增加 ¥${amount.toFixed(2)}`);
      setRechargeOpen(false);
      setRechargeAmount('');
    } catch (error) {
      toast.error('充值失败，请重试');
    }
  };

  if (accountLoading || statsLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-12">
          <div className="text-neutral-600">加载中...</div>
        </div>
      </div>
    );
  }

  if (!account || !stats) {
    return (
      <div className="p-6">
        <div className="text-center text-neutral-600">数据加载失败</div>
      </div>
    );
  }

  const balance = stats.balance;
  const level = balance >= 100 ? 'safe' : balance >= 20 ? 'warning' : 'danger';
  const style =
    level === 'danger'
      ? { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700' }
      : level === 'warning'
      ? { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700' }
      : { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700' };

  const transactions = transactionsData?.transactions || [];

  return (
    <div className="p-6 space-y-6">
      {/* 页头 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">算力账户</h1>
          <p className="mt-1 text-sm text-neutral-600">企业算力余额与消费明细</p>
        </div>
        <Button onClick={() => setRechargeOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          充值
        </Button>
      </div>

      {/* 余额预警 */}
      {level !== 'safe' && (
        <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${style.bg} ${style.border}`}>
          <AlertTriangle className={`h-5 w-5 shrink-0 ${style.text}`} />
          <div>
            <p className={`text-sm font-medium ${style.text}`}>
              {level === 'danger' ? '余额严重不足，请尽快充值' : '余额偏低，建议及时充值'}
            </p>
            <p className="text-xs text-neutral-600 mt-0.5">
              当前余额 ¥{balance.toFixed(2)}，不足时员工将无法调用模型。
            </p>
          </div>
        </div>
      )}

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-600">账户余额</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <Wallet className="w-5 h-5 text-primary" />
              <span className="text-2xl font-bold">¥{balance.toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-600">今日消费</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <ArrowDownLeft className="w-5 h-5 text-orange-500" />
              <span className="text-2xl font-bold">¥{stats.todayConsume.toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-600">本月消费</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <Zap className="w-5 h-5 text-purple-500" />
              <span className="text-2xl font-bold">¥{stats.monthConsume.toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 消费趋势图 */}
      {stats.trendData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>消费趋势（最近30天）</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={stats.trendData}>
                <defs>
                  <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => format(new Date(value), 'MM/dd')}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number) => [`¥${value.toFixed(2)}`, '消费金额']}
                  labelFormatter={(label) => format(new Date(label), 'yyyy-MM-dd', { locale: zhCN })}
                />
                <Area
                  type="monotone"
                  dataKey="amount"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorAmount)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* 交易记录 */}
      <Card>
        <CardHeader>
          <CardTitle>交易记录</CardTitle>
        </CardHeader>
        <CardContent>
          {transactionsLoading ? (
            <div className="text-center py-8 text-neutral-600">加载中...</div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-8 text-neutral-600">暂无交易记录</div>
          ) : (
            <div className="space-y-3">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between p-3 bg-neutral-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        tx.type === 'RECHARGE'
                          ? 'bg-green-100'
                          : tx.type === 'CONSUME'
                          ? 'bg-orange-100'
                          : 'bg-blue-100'
                      }`}
                    >
                      {tx.type === 'RECHARGE' ? (
                        <ArrowUpLeft className="w-5 h-5 text-green-600" />
                      ) : tx.type === 'CONSUME' ? (
                        <ArrowDownLeft className="w-5 h-5 text-orange-600" />
                      ) : (
                        <Zap className="w-5 h-5 text-blue-600" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-neutral-900">
                        {tx.description || '未命名交易'}
                      </p>
                      <p className="text-xs text-neutral-600">
                        {format(new Date(tx.createdAt), 'yyyy-MM-dd HH:mm:ss', { locale: zhCN })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p
                      className={`font-semibold ${
                        tx.type === 'RECHARGE' ? 'text-green-600' : 'text-orange-600'
                      }`}
                    >
                      {tx.type === 'RECHARGE' ? '+' : ''}¥{Math.abs(tx.amount).toFixed(2)}
                    </p>
                    <Badge variant={tx.type === 'RECHARGE' ? 'success' : 'default'} className="text-xs">
                      {tx.type === 'RECHARGE' ? '充值' : tx.type === 'CONSUME' ? '消费' : '退款'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 充值弹窗 */}
      <Dialog open={rechargeOpen} onOpenChange={setRechargeOpen}>
        <div className="p-6">
          <h2 className="text-xl font-semibold mb-4">充值算力</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">充值金额（元）</label>
              <Input
                type="number"
                value={rechargeAmount}
                onChange={(e) => setRechargeAmount(e.target.value)}
                placeholder="请输入充值金额"
                min="1"
                step="0.01"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRechargeAmount('100')}
              >
                ¥100
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRechargeAmount('500')}
              >
                ¥500
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRechargeAmount('1000')}
              >
                ¥1000
              </Button>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="outline" onClick={() => setRechargeOpen(false)}>
              取消
            </Button>
            <Button onClick={handleRecharge} disabled={recharge.isPending}>
              {recharge.isPending ? '充值中...' : '确认充值'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
