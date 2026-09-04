'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  type AllowancePeriod,
  type MemberAllowanceItem,
} from '@/lib/api/use-compute-credit';
import {
  CURRENT_PERIOD_LABELS,
  PERIOD_LABELS,
  PERIOD_OPTIONS,
  PERIOD_UNITS,
} from './allowance-period-labels';

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
 *
 * 三个可改的东西：**上限**、**周期**、**是否结转**。周期改动立即生效、
 * 不按比例折算（方案 §5.4 Q4）：把「每月 ¥500」改成「每周 ¥500」，
 * 这一刻起本周的上限就是 ¥500，不管这个月已经过了几天 ——
 * 折算出的「¥317」没人能预期，只会变成「我给他加了额度他却还是用不了」。
 */
export function AllocateComputeDialog({ member, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(member.limitCNY ?? '');
  const [period, setPeriod] = useState<AllowancePeriod>(member.period);
  const [carryOver, setCarryOver] = useState(member.carryOver);
  const [note, setNote] = useState('');
  const mutation = useSetMemberAllowance();

  const amount = Number(value);
  const cleared = value.trim() === '';
  const invalid = !cleared && (!Number.isFinite(amount) || amount <= 0);

  /** 打开时重置成这位成员当前的真实配置，而不是上一次谁的残留。 */
  const reset = () => {
    setValue(member.limitCNY ?? '');
    setPeriod(member.period);
    setCarryOver(member.carryOver);
    setNote('');
  };

  const unit = PERIOD_UNITS[period];
  const scope = CURRENT_PERIOD_LABELS[period];
  const periodChanged = !cleared && period !== member.period;

  const submit = () => {
    if (invalid) return;
    mutation.mutate(
      {
        userId: member.userId,
        limitCNY: cleared ? null : Math.round(amount * 100) / 100,
        period,
        carryOver,
        note: note.trim() || undefined,
      },
      {
        onSuccess: (result) => {
          toast.success(
            cleared
              ? `${member.name} 已改为不限额`
              : `${member.name} ${result.periodLabel}额度 ${formatCny(result.limitCNY)}`,
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
          reset();
          setOpen(true);
        }}
      >
        {trigger}
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>给 {member.name} 分配算力</DialogTitle>
            <DialogDescription>
              设定他每个周期最多能花掉多少算力。这只是上限 ——
              不会从企业算力余额里预先划走钱，也不限定他用在哪位硅基员工上。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-fg-muted">
              <span>
                {member.periodLabel}已用 {formatCnyPrecise(member.usedCNY)}
              </span>
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
              aria-label="每周期算力额度（元）"
            />

            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setValue(String(p))}
                  className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-muted/70"
                >
                  ¥{p}/{unit}
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

            {/* 周期与结转对「不限额」没有意义，清空金额时整块隐藏，
                免得有人以为自己设置了什么。 */}
            {!cleared && (
              <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="allowance-period" className="text-xs">
                    重置周期
                  </Label>
                  <Select
                    value={period}
                    onValueChange={(v) => setPeriod(v as AllowancePeriod)}
                  >
                    <SelectTrigger id="allowance-period" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PERIOD_OPTIONS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {PERIOD_LABELS[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-fg-muted">
                    额度在每个周期开始时重置。改周期立即生效，不按已过天数折算。
                  </p>
                </div>

                <div className="flex items-start justify-between gap-3 border-t border-border/60 pt-3">
                  <div className="min-w-0">
                    <Label htmlFor="allowance-carryover" className="text-xs">
                      未用完的额度结转到下一周期
                    </Label>
                    <p className="mt-0.5 text-xs text-fg-muted">
                      最多结转 1 个周期 —— 攒半年再一次性花掉，等于额度没起作用。
                    </p>
                  </div>
                  <Switch
                    id="allowance-carryover"
                    checked={carryOver}
                    onCheckedChange={setCarryOver}
                  />
                </div>
              </div>
            )}

            {!cleared && (
              <div className="space-y-1.5">
                <Label htmlFor="allowance-note" className="text-xs">
                  变更备注（可选）
                </Label>
                <Input
                  id="allowance-note"
                  maxLength={200}
                  placeholder="例：Q4 项目期临时调高"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <p className="text-xs text-fg-muted">
                  会记进变更留痕。三个月后回头看「他这月为什么被改道」，靠的就是这一行。
                </p>
              </div>
            )}

            {periodChanged && (
              <p className="text-xs text-amber-600">
                周期从「{member.periodLabel}」改成「{PERIOD_LABELS[period]}」后，
                {scope}已用的 {formatCnyPrecise(member.usedCNY)} 会按新周期的窗口重新统计 ——
                窗口变了，已用金额也会跟着变。
              </p>
            )}

            {/*
              §5.7 ④：额度用尽是**改道**不是拦停。旧文案写的「保存后他本月无法继续对话」
              是错的 —— 扣费链上个人钱包排在企业资金之后，他自己有余额就照样对话，
              只是这些消费由他自付。把改道说成停用，会让管理员以为自己按了个开关。
            */}
            {!cleared && Number(member.usedCNY) > amount && amount > 0 && (
              <p className="text-xs text-amber-600">
                他{scope}已花 {formatCnyPrecise(member.usedCNY)}，超过这个额度 ——
                保存后公司{scope}不再为他付费。对话不会中断：接下来的消费改由他的
                个人余额支付，个人余额也用尽才真的用不了。额度将于{' '}
                {member.limitCNY === null || period !== member.period
                  ? `下一个${PERIOD_UNITS[period]}周期开始时`
                  : new Date(member.resetAt).toLocaleDateString('zh-CN')}{' '}
                重置。
              </p>
            )}

            {!cleared && Number(member.topUpRemainingCNY) > 0 && (
              <p className="text-xs text-fg-muted">
                他还有未用完的追加额度 {formatCny(member.topUpRemainingCNY)} ——
                跨周期存活，排在常规额度之后消耗，改上限不会动它。
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
