'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useWalletBalance } from '@/lib/api/wallet';
import { Wallet, TrendingUp, TrendingDown, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

export function WalletBalanceCard() {
  const router = useRouter();
  const { data: balance, isLoading, error } = useWalletBalance();

  if (isLoading) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            钱包总余额
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-gray-200 rounded w-40" />
            <div className="grid grid-cols-3 gap-4">
              <div className="h-16 bg-gray-100 rounded-lg" />
              <div className="h-16 bg-gray-100 rounded-lg" />
              <div className="h-16 bg-gray-100 rounded-lg" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-danger/30 bg-danger/5 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-danger">
            <Wallet className="h-5 w-5" />
            加载失败
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-fg-muted">
            {error instanceof Error ? error.message : '获取钱包信息失败'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!balance) return null;

  return (
    <Card className="shadow-md">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="flex items-center gap-2.5 text-xl">
          <Wallet className="h-6 w-6 text-primary" />
          钱包总余额
        </CardTitle>
        <Button
          onClick={() => router.push('/payment/recharge')}
          size="sm"
          variant="primary"
          className="shadow-sm"
        >
          充值到企业钱包
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 主余额显示 */}
        <div className="rounded-lg bg-gradient-to-br from-primary/5 via-primary/3 to-transparent border border-primary/10 p-6">
          <p className="text-sm font-medium text-fg-muted mb-2">可用余额</p>
          <p className="text-4xl font-bold text-foreground tabular-nums">
            ¥{Number(balance.balance).toFixed(2)}
          </p>
          {Number(balance.frozenAmount) > 0 && (
            <p className="text-xs text-fg-muted mt-2 flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning"></span>
              冻结金额: ¥{Number(balance.frozenAmount).toFixed(2)}
            </p>
          )}
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-3 gap-4">
          <StatItem
            icon={TrendingUp}
            iconColor="text-success"
            iconBg="bg-success/10"
            label="累计充值"
            value={`¥${Number(balance.totalDeposit).toFixed(2)}`}
          />
          <StatItem
            icon={TrendingDown}
            iconColor="text-danger"
            iconBg="bg-danger/10"
            label="累计消费"
            value={`¥${Number(balance.totalConsume).toFixed(2)}`}
          />
          <StatItem
            icon={RotateCw}
            iconColor="text-primary"
            iconBg="bg-primary/10"
            label="累计退款"
            value={`¥${Number(balance.totalRefund).toFixed(2)}`}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function StatItem({
  icon: Icon,
  iconColor,
  iconBg,
  label,
  value,
}: {
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 transition-all hover:bg-muted/50 hover:shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-md', iconBg)}>
          <Icon className={cn('h-4 w-4', iconColor)} />
        </span>
      </div>
      <p className="text-xs text-fg-muted mb-1">{label}</p>
      <p className="text-sm font-semibold text-foreground tabular-nums">{value}</p>
    </div>
  );
}
