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
import { usePersonalDeposit } from '@/lib/api/use-personal-wallet';

/** 后端 PersonalDepositDtoSchema 的上限，前端先拦一道，省一次必失败的请求。 */
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
 * 个人余额充值。
 *
 * 这笔钱只在**公司不为这一次对话付钱**时才会被动用（额度用尽或企业资金见底），
 * 排在扣费链最后一位。文案必须把这点说清楚：否则用户会以为充了就得自己花，
 * 或者以为充了公司额度就变多了。
 */
export function PersonalDepositDialog({ trigger, open, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [value, setValue] = useState('');
  const deposit = usePersonalDeposit();

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
    deposit.mutate(Math.round(amount * 100) / 100, {
      onSuccess: (result) => {
        toast.success('充值成功', `个人余额 ${formatCny(result.balanceCNY)}`);
        setOpen(false);
        setValue('');
      },
      onError: (error) => {
        toast.error(
          '充值失败',
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
              演示环境直接入账，未接支付渠道。
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
              disabled={invalid || deposit.isPending}
              onClick={submit}
            >
              {deposit.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wallet className="h-4 w-4" />
              )}
              确认充值
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
