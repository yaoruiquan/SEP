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

/** 常用追加金额。 */
const PRESETS = [50, 100, 300];

interface Props {
  member: MemberAllowanceItem;
  trigger: React.ReactNode;
}

/**
 * 给一位碳基员工追加一次性额度。
 *
 * 与「改额度」是两个功能，因为差别是可观测的：
 *   · 调高上限 → 他**以后每个周期**都能花更多
 *   · 追加额度 → 只是这一笔钱，跨周期存活，用完就没了
 *
 * 消耗顺序上追加额度排在常规额度**之后**（方案 §5.4 Q1）：
 * 否则「先花掉追加的、再花常规的」会让常规额度看起来永远没动过，
 * 「本周期已用」这个数字就再也解释不了他的消费。
 *
 * 不限额的成员追加额度是死数据 —— 他本来就没有闸门，追加的钱永远不会被消耗，
 * 所以这里直接不让提交，而不是让后端报 400 之后再猜原因。
 */
export function TopUpComputeDialog({ member, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const mutation = useTopUpMemberAllowance();
  // 只在弹窗打开时才拉记录 —— 每行成员都挂着一个这个组件
  const { data: history } = useAllowanceTopUps(member.userId, open);

  const unlimited = member.limitCNY === null;
  const amount = Number(value);
  const invalid = !Number.isFinite(amount) || amount <= 0;

  const submit = () => {
    if (invalid || unlimited) return;
    mutation.mutate(
      {
        userId: member.userId,
        amountCNY: Math.round(amount * 100) / 100,
        note: note.trim() || undefined,
      },
      {
        onSuccess: (result) => {
          toast.success(
            `已给 ${member.name} 追加 ${formatCny(amount)}`,
            `未用完的追加额度合计 ${formatCny(result.topUpRemainingCNY)}`,
          );
          setValue('');
          setNote('');
          setOpen(false);
        },
        onError: (error) => {
          toast.error('追加失败', error instanceof Error ? error.message : undefined);
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
            <DialogTitle>给 {member.name} 追加额度</DialogTitle>
            <DialogDescription>
              一次性额度，不改他的周期上限。跨周期存活，排在常规额度之后消耗 ——
              「他这个月要多干点活」用这个，「他以后每期都能花更多」用改额度。
            </DialogDescription>
          </DialogHeader>

          {unlimited ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
              {member.name} 当前不限额，追加额度不会生效 ——
              没有闸门，这笔钱永远不会被消耗。请先给他设一个周期上限。
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-fg-muted">
                <span>
                  {member.periodLabel}上限 {formatCny(member.limitCNY)}
                </span>
                <span>
                  未用完的追加额度 {formatCny(member.topUpRemainingCNY)}
                </span>
              </div>

              <Input
                type="number"
                inputMode="decimal"
                min={0.01}
                step={0.01}
                placeholder="追加金额（元）"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-label="追加额度金额（元）"
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
                  <p className="mb-2 text-xs font-medium text-foreground">最近的追加</p>
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
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {unlimited ? '知道了' : '取消'}
            </Button>
            {!unlimited && (
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
                追加额度
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
