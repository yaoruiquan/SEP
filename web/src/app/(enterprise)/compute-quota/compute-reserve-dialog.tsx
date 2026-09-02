'use client';

import { useState } from 'react';
import { ArrowUpRight, Loader2, Plus } from 'lucide-react';
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
import {
  formatCny,
  useReleaseFromCompute,
  useReserveForCompute,
} from '@/lib/api/use-compute-credit';

type Direction = 'RESERVE' | 'RELEASE';

const COPY: Record<
  Direction,
  { title: string; desc: string; limitLabel: string; submit: string }
> = {
  RESERVE: {
    title: '充值算力',
    desc: '从企业钱包充值。充值后这笔钱专用于与硅基员工对话，订阅与员工采购不可挪用。',
    limitLabel: '钱包可用余额',
    submit: '充值算力',
  },
  RELEASE: {
    title: '退回钱包',
    desc: '把算力余额退回企业钱包，退回后可重新用于订阅等其他支出。',
    limitLabel: '当前算力余额',
    submit: '退回钱包',
  },
};

interface Props {
  direction: Direction;
  /** 该方向的可操作上限（元） */
  max: string;
  trigger?: React.ReactNode;
}

/**
 * 算力充值 / 退回。
 *
 * 后端做的是「在钱包里给一部分钱贴上只能用于对话的标签」，界面上说「充值算力」——
 * 用户心智里算力是买来的东西，不是一个会计操作。两者不矛盾：钱确实从
 * 「可任意支配」变成了「只能对话」，只是没有搬到第二个账户里去。
 */
export function ComputeReserveDialog({ direction, max, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  const reserve = useReserveForCompute();
  const release = useReleaseFromCompute();
  const mutation = direction === 'RESERVE' ? reserve : release;
  const copy = COPY[direction];

  const maxNum = Number(max ?? 0);
  const amount = Number(value);
  const invalid = !Number.isFinite(amount) || amount <= 0 || amount > maxNum;

  const submit = () => {
    if (invalid) return;
    mutation.mutate(Math.round(amount * 100) / 100, {
      onSuccess: (result) => {
        toast.success(
          direction === 'RESERVE' ? '算力已充值' : '已退回钱包',
          `算力余额 ${formatCny(result.computeReservedCNY)} · 钱包可用 ${formatCny(
            result.spendableCNY,
          )}`,
        );
        setOpen(false);
        setValue('');
      },
      onError: (error) => {
        toast.error(
          direction === 'RESERVE' ? '充值失败' : '退回失败',
          error instanceof Error ? error.message : undefined,
        );
      },
    });
  };

  return (
    <>
      <span onClick={() => setOpen(true)}>
        {trigger ?? (
          <Button size="sm" variant={direction === 'RESERVE' ? 'glass-primary' : 'glass'}>
            {direction === 'RESERVE' ? (
              <Plus className="h-3.5 w-3.5" />
            ) : (
              <ArrowUpRight className="h-3.5 w-3.5" />
            )}
            {copy.submit}
          </Button>
        )}
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.desc}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-fg-muted">
              <span>{copy.limitLabel}</span>
              <button
                type="button"
                onClick={() => setValue(maxNum.toFixed(2))}
                className="font-medium tabular-nums text-primary hover:underline"
              >
                {formatCny(max)} · 全部
              </button>
            </div>
            <Input
              type="number"
              inputMode="decimal"
              min={0.01}
              max={maxNum}
              step={0.01}
              placeholder="0.00"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label="金额（元）"
            />
            {value !== '' && invalid && (
              <p className="text-xs text-red-500">
                {amount > maxNum
                  ? `超出上限，最多 ${formatCny(max)}`
                  : '请输入大于 0 的金额'}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            {/*
              确认按钮用 primary 而不是 glass-primary：本仓库其他弹窗
              （如 knowledge-grants-panel）都是这么写的，玻璃变体在 Radix Portal
              里依赖 glass-scope 令牌，白字 + 玻璃底在浅色弹窗上几乎看不见。
            */}
            <Button
              variant="primary"
              disabled={invalid || mutation.isPending}
              onClick={submit}
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {copy.submit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
