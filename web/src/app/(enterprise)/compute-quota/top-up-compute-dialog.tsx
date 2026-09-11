'use client';

import { useState } from 'react';
import { Loader2, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  useAllowanceTopUps,
  useTopUpMemberAllowance,
  type MemberAllowanceItem,
} from '@/lib/api/use-compute-credit';

/** 常用成员企业算力充值金额。 */
const PRESETS = [50, 100, 300];

interface Props {
  member: MemberAllowanceItem;
  trigger: React.ReactNode;
}

/**
 * 给一位碳基员工充值企业算力余额。
 *
 * 与「改额度」是两个功能：改额度控制每周期企业最多承担多少，充值余额是
 * 已从企业钱包扣出的预付款，跨周期保留。
 *
 * 充值余额在赠送额度之后扣减，并受月度额度闸门限制。
 */
export function TopUpComputeDialog({ member, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const mutation = useTopUpMemberAllowance();
  // 只在弹窗打开时才拉记录 —— 每行成员都挂着一个这个组件
  const { data: history } = useAllowanceTopUps(member.userId, open);

  const amount = Number(value);
  const invalid = !Number.isFinite(amount) || amount <= 0;

  const submit = () => {
    if (invalid) return;
    mutation.mutate(
      {
        userId: member.userId,
        amountCNY: Math.round(amount * 100) / 100,
        note: note.trim() || undefined,
      },
      {
        onSuccess: (result) => {
          toast.success(
            `已给 ${member.name} 充值 ${formatCny(amount)}`,
            `企业充值余额 ${formatCny(result.topUpRemainingCNY)}`,
          );
          setValue('');
          setNote('');
          setOpen(false);
        },
        onError: (error) => {
          toast.error('充值失败', error instanceof Error ? error.message : undefined);
        },
      },
    );
  };

  const mine = (history ?? []).filter((t) => t.userId === member.userId).slice(0, 5);

  return (
    <>
      <span
        onClick={() => {
          setValue('');
          setNote('');
          setOpen(true);
        }}
      >
        {trigger}
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>给 {member.name} 充值算力</DialogTitle>
            <DialogDescription>
              这笔钱会立即从企业算力余额扣除，存入 {member.name} 的企业充值余额，跨周期保留。
              企业算力余额不足时不会自动使用普通企业钱包，请先在上方充值算力。
              月度额度仍然独立生效：例如月度上限 ¥50，充值 ¥300 时每月最多消费 ¥50。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-fg-muted">
                <span>
                  {member.periodLabel}上限 {formatCny(member.limitCNY)}
                </span>
                <span>
                  企业充值余额 {formatCny(member.topUpRemainingCNY)}
                </span>
              </div>

              <Input
                type="number"
                inputMode="decimal"
                min={0.01}
                step={0.01}
                placeholder="充值金额（元）"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-label="充值金额（元）"
              />

              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setValue(String(p))}
                    className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-muted/70"
                  >
                    ¥{p}
                  </button>
                ))}
              </div>

              {invalid && value.trim() !== '' && (
                <p className="text-xs text-red-500">请输入大于 0 的金额</p>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="topup-note" className="text-xs">
                  备注（可选）
                </Label>
                <Input
                  id="topup-note"
                  maxLength={200}
                  placeholder="例：客户投标临时加量"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              {mine.length > 0 && (
                <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                  <p className="mb-2 text-xs font-medium text-foreground">最近的充值</p>
                  <ul className="space-y-1.5">
                    {mine.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-baseline justify-between gap-3 text-xs text-fg-muted"
                      >
                        <span className="min-w-0 truncate">
                          {new Date(t.createdAt).toLocaleDateString('zh-CN')}
                          {t.note ? ` · ${t.note}` : ''}
                          {t.grantedByName ? ` · ${t.grantedByName}` : ''}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {formatCny(t.amountCNY)}
                          <span className="text-fg-muted/70">
                            {' '}
                            剩 {formatCny(t.remainingCNY)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
                variant="primary"
                disabled={invalid || mutation.isPending}
                onClick={submit}
              >
                {mutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlusCircle className="h-4 w-4" />
                )}
                充值算力
              </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
