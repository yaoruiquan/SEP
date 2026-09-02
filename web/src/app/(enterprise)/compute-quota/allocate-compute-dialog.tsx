'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
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
  formatCnyPrecise,
  useSetMemberAllowance,
  type MemberAllowanceItem,
} from '@/lib/api/use-compute-credit';

/** 常用额度，省得每次手敲。 */
const PRESETS = [50, 200, 500, 1000];

interface Props {
  member: MemberAllowanceItem;
  trigger: React.ReactNode;
}

/**
 * 给一位碳基员工分配算力额度。
 *
 * 弹窗里写明「不会从企业算力余额里划走钱」—— 这是最容易误解的一点：
 * 给 10 个人各分 ¥500，不等于企业要有 ¥5000。
 */
export function AllocateComputeDialog({ member, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(member.limitCNY ?? '');
  const mutation = useSetMemberAllowance();

  const amount = Number(value);
  const cleared = value.trim() === '';
  const invalid = !cleared && (!Number.isFinite(amount) || amount <= 0);

  const submit = () => {
    if (invalid) return;
    mutation.mutate(
      { userId: member.userId, limitCNY: cleared ? null : Math.round(amount * 100) / 100 },
      {
        onSuccess: (result) => {
          toast.success(
            cleared ? `${member.name} 已改为不限额` : `${member.name} 本月额度 ${formatCny(result.limitCNY)}`,
            cleared ? undefined : `已用 ${formatCnyPrecise(result.usedCNY)}`,
          );
          setOpen(false);
        },
        onError: (error) => {
          toast.error('分配失败', error instanceof Error ? error.message : undefined);
        },
      },
    );
  };

  return (
    <>
      <span
        onClick={() => {
          setValue(member.limitCNY ?? '');
          setOpen(true);
        }}
      >
        {trigger}
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>给 {member.name} 分配算力</DialogTitle>
            <DialogDescription>
              设定他每月最多能花掉多少算力。这只是上限 ——
              不会从企业算力余额里预先划走钱，也不限定他用在哪位硅基员工上。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-fg-muted">
              <span>本月已用 {formatCnyPrecise(member.usedCNY)}</span>
              <span>
                当前额度：
                {member.limitCNY ? formatCny(member.limitCNY) : '不限额'}
              </span>
            </div>

            <Input
              type="number"
              inputMode="decimal"
              min={0.01}
              step={0.01}
              placeholder="留空 = 不限额"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label="每月算力额度（元）"
            />

            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setValue(String(p))}
                  className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-muted/70"
                >
                  ¥{p}/月
                </button>
              ))}
              <button
                type="button"
                onClick={() => setValue('')}
                className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-muted/70"
              >
                不限额
              </button>
            </div>

            {invalid && <p className="text-xs text-red-500">请输入大于 0 的金额</p>}

            {!cleared && Number(member.usedCNY) > amount && amount > 0 && (
              <p className="text-xs text-amber-600">
                他本月已花 {formatCnyPrecise(member.usedCNY)}，超过这个额度 ——
                保存后他本月无法继续对话，下月 1 日重置。
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
              {cleared ? '改为不限额' : '保存额度'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
