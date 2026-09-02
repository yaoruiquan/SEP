'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useWalletBalance } from '@/lib/api/wallet';
import { Wallet, TrendingUp, TrendingDown, RotateCw, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

export function WalletBalanceCard() {
  const router = useRouter();
  const { data: balance, isLoading, error } = useWalletBalance();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            企业钱包
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-8 bg-gray-200 rounded w-32" />
            <div className="grid grid-cols-3 gap-4">
              <div className="h-16 bg-gray-100 rounded" />
              <div className="h-16 bg-gray-100 rounded" />
              <div className="h-16 bg-gray-100 rounded" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600">
            <Wallet className="h-5 w-5" />
            加载失败
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600">
            {error instanceof Error ? error.message : '获取钱包信息失败'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!balance) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          企业钱包
        </CardTitle>
        <Button
          onClick={() => router.push('/payment/recharge')}
          size="sm"
          variant="primary"
        >
          充值
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 余额 */}
        <div>
          <p className="text-sm text-gray-600 mb-1">当前余额</p>
          <p className="text-3xl font-bold text-gray-900">
            ¥{Number(balance.balance).toFixed(2)}
          </p>
          {Number(balance.frozenAmount) > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              冻结金额: ¥{Number(balance.frozenAmount).toFixed(2)}
            </p>
          )}

          {/*
            「算力余额」页显示的是下面这个算力数，不是上面的总余额。
            两个页面的数字不同不是 bug —— 在这里把拆分写明，用户才不会以为对不上账。
          */}
          {Number(balance.computeReservedCNY) > 0 && (
            <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-6 text-emerald-900">
              其中{' '}
              <strong className="tabular-nums">
                ¥{Number(balance.computeReservedCNY).toFixed(2)}
              </strong>{' '}
              已充值为<strong>算力</strong>，只能用于与硅基员工对话，订阅与员工采购不可挪用；
              可用于其他支出{' '}
              <strong className="tabular-nums">
                ¥{Number(balance.spendableCNY).toFixed(2)}
              </strong>
              。
              <Link
                href="/compute-quota"
                className="ml-1 inline-flex items-center gap-1 font-medium underline"
              >
                去算力余额页管理
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )}
        </div>

        {/* 统计 */}
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-gray-600">
              <TrendingUp className="h-3 w-3 text-green-600" />
              累计充值
            </div>
            <p className="text-sm font-semibold text-gray-900">
              ¥{Number(balance.totalDeposit).toFixed(2)}
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-gray-600">
              <TrendingDown className="h-3 w-3 text-red-600" />
              累计消费
            </div>
            <p className="text-sm font-semibold text-gray-900">
              ¥{Number(balance.totalConsume).toFixed(2)}
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-gray-600">
              <RotateCw className="h-3 w-3 text-blue-600" />
              累计退款
            </div>
            <p className="text-sm font-semibold text-gray-900">
              ¥{Number(balance.totalRefund).toFixed(2)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
