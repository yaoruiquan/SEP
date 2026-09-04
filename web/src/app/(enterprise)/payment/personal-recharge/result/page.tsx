'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle, Loader2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  usePersonalRechargeOrder,
  useReconcilePersonalRecharge,
} from '@/lib/api/use-personal-wallet';

/** 付完回哪：成员的个人余额卡片，锚点直接滚到「我的个人余额」。 */
const BACK_TO = '/compute-quota#my-compute';

/**
 * 个人充值结果页 —— 支付宝同步回跳的落地页。
 *
 * 与企业充值结果页（`../recharge/result`）同一套状态机，但查的是
 * `personal-wallet/recharge/*`：个人钱包和企业钱包是两本账，订单也是两张表。
 *
 * 这个页面**不加余额**，它只是「看」和「催」：
 *   · 看 —— 每 2 秒轮一次订单状态（PENDING 才轮，落终态自动停）
 *   · 催 —— PENDING 时每 5 秒让后端主动向支付宝查单，收到钱就补履约
 *
 * 「催」不是多余的：同步回跳只说明用户从收银台走回来了，真正入账靠异步通知，
 * 而通知会丢（回调地址错配、服务重启、内网不可达）。少了这一步，用户付了钱
 * 却永远停在「等待支付确认」。
 */
export default function PersonalRechargeResultPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 支付宝回跳只带 out_trade_no；后端在 returnUrl 里显式拼了 orderNo。
  // 两个都认，任一侧遗漏也不至于退化成「缺少订单号」。
  const orderNo =
    searchParams.get('orderNo') ?? searchParams.get('out_trade_no');

  const { data: order, isLoading } = usePersonalRechargeOrder(orderNo);
  const reconcile = useReconcilePersonalRecharge();

  useEffect(() => {
    if (order?.status !== 'PAID') return;
    const timer = setTimeout(() => router.push(BACK_TO), 3000);
    return () => clearTimeout(timer);
  }, [order?.status, router]);

  useEffect(() => {
    if (!orderNo || order?.status !== 'PENDING') return;
    const timer = setInterval(() => {
      if (!reconcile.isPending) reconcile.mutate(orderNo);
    }, 5000);
    return () => clearInterval(timer);
    // reconcile 是 mutation 实例，引用稳定，不纳入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNo, order?.status]);

  if (!orderNo) {
    return (
      <Shell title="缺少订单号">
        <XCircle className="mx-auto h-16 w-16 text-red-500" />
        <p className="text-sm text-fg-muted">
          回跳地址里没有订单号，无法查询支付结果。已付款的话稍后回个人余额页查看流水。
        </p>
        <Button className="w-full" onClick={() => router.push(BACK_TO)}>
          返回个人余额
        </Button>
      </Shell>
    );
  }

  if (isLoading || !order) {
    return (
      <Shell title="正在查询支付结果">
        <Loader2 className="mx-auto h-16 w-16 animate-spin text-blue-500" />
        <p className="text-sm text-fg-muted">请稍候</p>
      </Shell>
    );
  }

  if (order.status === 'PAID') {
    return (
      <Shell title="支付成功">
        <CheckCircle className="mx-auto h-16 w-16 text-green-500" />
        <div>
          <p className="text-lg font-semibold">已充入个人余额 ¥{order.amountCNY}</p>
          <p className="mt-1 text-xs text-fg-muted">订单号：{order.orderNo}</p>
        </div>
        {/* 提醒一次归属：个人余额不是公司额度，扣费时排在最后一位 */}
        <p className="text-sm text-fg-muted">
          这笔钱只在公司不为对话付钱时才会被动用。3 秒后自动返回。
        </p>
        <Button className="w-full" onClick={() => router.push(BACK_TO)}>
          立即返回
        </Button>
      </Shell>
    );
  }

  if (order.status === 'CLOSED') {
    return (
      <Shell title="订单已关闭">
        <XCircle className="mx-auto h-16 w-16 text-fg-muted" />
        <div>
          <p className="text-lg font-semibold">订单已取消或超时</p>
          <p className="mt-1 text-xs text-fg-muted">订单号：{order.orderNo}</p>
        </div>
        <p className="text-sm text-fg-muted">
          这张订单不会再入账。若已实际付款，请联系管理员走人工对账。
        </p>
        <Button className="w-full" onClick={() => router.push(BACK_TO)}>
          返回个人余额
        </Button>
      </Shell>
    );
  }

  return (
    <Shell title="等待支付确认">
      <Loader2 className="mx-auto h-16 w-16 animate-spin text-blue-500" />
      <div>
        <p className="text-lg font-semibold">¥{order.amountCNY}</p>
        <p className="mt-1 text-xs text-fg-muted">订单号：{order.orderNo}</p>
      </div>
      <p className="text-sm text-fg-muted">
        请在支付宝完成支付。到账有几秒延迟，这个页面会自动刷新，不用手动重试。
      </p>
      <Button
        variant="outline"
        className="w-full"
        onClick={() => router.push(BACK_TO)}
      >
        返回个人余额
      </Button>
    </Shell>
  );
}

/** 四种状态共用的卡片外壳，省掉四份一样的居中布局。 */
function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 text-center">{children}</div>
        </CardContent>
      </Card>
    </div>
  );
}
