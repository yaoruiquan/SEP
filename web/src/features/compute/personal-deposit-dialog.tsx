'use client';

import { useState } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { formatCny } from '@/lib/api/use-compute-credit';
import { useCreatePersonalRecharge } from '@/lib/api/use-personal-wallet';

/** 后端 PersonalRechargeCreateDtoSchema 的上限，前端先拦一道，省一次必失败的请求。 */
const MAX_DEPOSIT = 100_000;

const PRESETS = [20, 50, 100, 500];

interface Props {
  trigger?: React.ReactNode;
  /**
   * 受控模式。对话里「额度用尽」弹窗要先关自己、再开这个 ——
   * 两层 Radix Dialog 叠着开会互相抢焦点，顺序打开才正常。
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * 个人余额充值 —— 走支付宝。
 *
 * 这笔钱只在**公司不为这一次对话付钱**时才会被动用（额度用尽或企业资金见底），
 * 排在扣费链最后一位。文案必须把这点说清楚：否则用户会以为充了就得自己花，
 * 或者以为充了公司额度就变多了。
 *
 * 这里**只下单**，余额不在这一步变化：点确认拿到支付地址就整页跳去支付宝，
 * 付完由支付宝回调（或结果页的对账）入账。曾经这个按钮直接调
 * `POST /personal-wallet/deposit` 把金额加进余额 —— 那等于给每个成员
 * 发一台免费印钞机，接口已经删了。
 */
export function PersonalDepositDialog({ trigger, open, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [value, setValue] = useState('');
  const createOrder = useCreatePersonalRecharge();

  const controlled = open !== undefined;
  const isOpen = controlled ? open : internalOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const amount = Number(value);
  const invalid =
    !Number.isFinite(amount) || amount <= 0 || amount > MAX_DEPOSIT;

  const submit = () => {
    if (invalid) return;
    createOrder.mutate(Math.round(amount * 100) / 100, {
      onSuccess: (order) => {
        // 整页跳去支付宝收银台。不 setOpen(false) —— 页面马上就被替换掉，
        // 先关弹窗只会让用户看到一帧空白
        window.location.href = order.payUrl;
      },
      onError: (error) => {
        toast.error(
          '下单失败',
          error instanceof Error ? error.message : undefined,
        );
      },
    });
  };

  return (
    <>
      {trigger && <span onClick={() => setOpen(true)}>{trigger}</span>}

      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>个人余额充值</DialogTitle>
            <DialogDescription>
              个人余额只在公司不为这次对话付钱时才被动用 —— 你本周期的算力额度用尽，
              或企业资金见底。公司还有额度时，扣的仍然是公司的钱。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  size="sm"
                  variant={Number(value) === preset ? 'primary' : 'outline'}
                  onClick={() => setValue(String(preset))}
                >
                  ¥{preset}
                </Button>
              ))}
            </div>
            <Input
              type="number"
              inputMode="decimal"
              min={0.01}
              max={MAX_DEPOSIT}
              step={0.01}
              placeholder="0.00"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label="充值金额（元）"
            />
            {value !== '' && invalid && (
              <p className="text-xs text-red-500">
                {amount > MAX_DEPOSIT
                  ? `单次最多 ${formatCny(MAX_DEPOSIT)}`
                  : '请输入大于 0 的金额'}
              </p>
            )}
            <p className="text-xs text-fg-muted">
              点确认后跳转支付宝，付款完成自动返回本页并到账。
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            {/* primary 而非 glass-primary：玻璃变体在 Radix Portal 里没有
                glass-scope 令牌，白字压在玻璃底上几乎看不见 */}
            <Button
              variant="primary"
              disabled={invalid || createOrder.isPending}
              onClick={submit}
            >
              {createOrder.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wallet className="h-4 w-4" />
              )}
              {createOrder.isPending ? '正在创建订单…' : '去支付宝支付'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
