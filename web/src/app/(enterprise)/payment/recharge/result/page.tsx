'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useRechargeOrder, useReconcileRechargeOrder } from '@/features/compute/use-compute';

export default function RechargeResultPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 支付宝同步回跳带的是 out_trade_no（它不会产生 orderNo）。
  // 后端已在 returnUrl 里显式拼入 orderNo，这里同时兼容 out_trade_no 作为兜底，
  // 避免任一侧遗漏就退化成「缺少订单号」。
  const orderNo = searchParams.get('orderNo') ?? searchParams.get('out_trade_no');

  const { data: order, isLoading } = useRechargeOrder(orderNo);
  const reconcile = useReconcileRechargeOrder();

  useEffect(() => {
    if (order?.status === 'PAID') {
      // 支付成功后延迟跳转
      const timer = setTimeout(() => {
        router.push('/usage');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [order?.status, router]);

  // 兜底对账：订单仍为 PENDING 时，每 5 秒主动向支付宝核对一次真实交易状态。
  // 异步通知一旦丢失，本地轮询会永远停在 PENDING；主动查单能把这种情况救回来。
  useEffect(() => {
    if (!orderNo || order?.status !== 'PENDING') return;

    const timer = setInterval(() => {
      if (!reconcile.isPending) {
        reconcile.mutate(orderNo);
      }
    }, 5000);

    return () => clearInterval(timer);
    // reconcile 为 mutation 实例，引用稳定，无需纳入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNo, order?.status]);

  if (!orderNo) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center">
              <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">缺少订单号</h2>
              <Button onClick={() => router.push('/usage')}>返回用量分析</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !order) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center">
              <Loader2 className="h-12 w-12 text-blue-500 mx-auto mb-4 animate-spin" />
              <h2 className="text-xl font-semibold mb-2">正在查询支付结果...</h2>
              <p className="text-sm text-neutral-600">请稍候</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (order.status === 'PAID') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center">支付成功</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center space-y-4">
              <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
              <div>
                <p className="text-lg font-semibold">充值成功</p>
                <p className="text-sm text-neutral-600 mt-2">
                  充值金额：¥{order.amount.toFixed(2)}
                </p>
                <p className="text-xs text-neutral-500 mt-1">
                  订单号：{order.orderNo}
                </p>
              </div>
              <p className="text-sm text-neutral-600">3 秒后自动返回用量分析页面...</p>
              <Button onClick={() => router.push('/usage')} className="w-full">
                立即返回
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (order.status === 'CLOSED') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center">订单已关闭</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center space-y-4">
              <XCircle className="h-16 w-16 text-neutral-400 mx-auto" />
              <div>
                <p className="text-lg font-semibold">订单已取消或超时</p>
                <p className="text-xs text-neutral-500 mt-1">
                  订单号：{order.orderNo}
                </p>
              </div>
              <Button onClick={() => router.push('/usage')} className="w-full">
                返回用量分析
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // PENDING 状态：等待支付
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">等待支付</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center space-y-4">
            <Loader2 className="h-16 w-16 text-blue-500 mx-auto animate-spin" />
            <div>
              <p className="text-lg font-semibold">等待支付确认</p>
              <p className="text-sm text-neutral-600 mt-2">
                充值金额：¥{order.amount.toFixed(2)}
              </p>
              <p className="text-xs text-neutral-500 mt-1">
                订单号：{order.orderNo}
              </p>
            </div>
            <p className="text-sm text-neutral-600">
              请在支付宝完成支付，支付成功后会自动跳转。
            </p>
            <Button
              variant="outline"
              onClick={() => router.push('/usage')}
              className="w-full"
            >
              返回用量分析
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
