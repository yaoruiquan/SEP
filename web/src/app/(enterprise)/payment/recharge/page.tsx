'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateRechargeOrder } from '@/lib/api/wallet';
import { useRouter } from 'next/navigation';
import { Wallet, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

const PRESET_AMOUNTS = [100, 500, 1000, 5000, 10000, 50000];

export default function RechargePage() {
  const router = useRouter();
  const [amount, setAmount] = useState<number>(1000);
  const [customAmount, setCustomAmount] = useState<string>('');
  const createOrder = useCreateRechargeOrder();

  const handlePresetClick = (preset: number) => {
    setAmount(preset);
    setCustomAmount('');
  };

  const handleCustomChange = (value: string) => {
    setCustomAmount(value);
    const num = parseFloat(value);
    if (!isNaN(num) && num > 0) {
      setAmount(num);
    }
  };

  const handleSubmit = async () => {
    if (amount <= 0) {
      alert('请输入有效的充值金额');
      return;
    }

    try {
      const result = await createOrder.mutateAsync(amount);
      // 跳转到支付宝支付页面
      window.location.href = result.payUrl;
    } catch (error) {
      alert(error instanceof Error ? error.message : '创建订单失败');
    }
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-2xl">
      <div className="mb-6">
        <Link
          href="/wallet"
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          返回钱包
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            充值企业钱包
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 预设金额 */}
          <div className="space-y-3">
            <Label>选择充值金额</Label>
            <div className="grid grid-cols-3 gap-3">
              {PRESET_AMOUNTS.map((preset) => (
                <Button
                  key={preset}
                  variant={amount === preset && !customAmount ? 'primary' : 'outline'}
                  onClick={() => handlePresetClick(preset)}
                  className="h-16"
                >
                  <div className="text-center">
                    <div className="text-lg font-bold">¥{preset}</div>
                    {preset >= 10000 && (
                      <div className="text-xs opacity-75">
                        {preset / 10000}万
                      </div>
                    )}
                  </div>
                </Button>
              ))}
            </div>
          </div>

          {/* 自定义金额 */}
          <div className="space-y-2">
            <Label htmlFor="custom-amount">自定义金额（元）</Label>
            <Input
              id="custom-amount"
              type="number"
              placeholder="输入其他金额"
              value={customAmount}
              onChange={(e) => handleCustomChange(e.target.value)}
              min="0.01"
              step="0.01"
            />
          </div>

          {/* 充值说明 */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
            <p className="text-sm font-medium text-blue-900">充值说明</p>
            <ul className="text-xs text-blue-800 space-y-1 list-disc list-inside">
              <li>充值金额将实时到账企业钱包</li>
              <li>可用于订阅硅基员工和算力消费</li>
              <li>支持支付宝支付</li>
              <li>充值记录可在交易记录中查看</li>
            </ul>
          </div>

          {/* 确认充值 */}
          <div className="space-y-3 pt-4 border-t">
            <div className="flex items-center justify-between text-lg">
              <span className="font-medium text-gray-700">充值金额</span>
              <span className="font-bold text-gray-900">
                ¥{amount.toFixed(2)}
              </span>
            </div>
            <Button
              onClick={handleSubmit}
              disabled={amount <= 0 || createOrder.isPending}
              className="w-full h-12 text-lg"
            >
              {createOrder.isPending ? '正在创建订单...' : '确认充值'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
