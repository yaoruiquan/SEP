'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
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
 *
 * 三个可改的东西：**上限**、**周期**、**是否结转**。周期改动立即生效、
 * 不按比例折算（方案 §5.4 Q4）：把「每月 ¥500」改成「每周 ¥500」，
 * 这一刻起本周的上限就是 ¥500，不管这个月已经过了几天 ——
 * 折算出的「¥317」没人能预期，只会变成「我给他加了额度他却还是用不了」。
 */
export function AllocateComputeDialog({ member, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [dailyValue, setDailyValue] = useState(member.dailyLimitCNY ?? '');
  const [monthlyValue, setMonthlyValue] = useState(member.monthlyLimitCNY ?? member.limitCNY ?? '');
  const [note, setNote] = useState('');
  const mutation = useSetMemberAllowance();

  const dailyAmount = Number(dailyValue);
  const monthlyAmount = Number(monthlyValue);
  const dailySet = dailyValue.trim() !== '';
  const monthlySet = monthlyValue.trim() !== '';
  const cleared = !dailySet && !monthlySet;
  const invalid = (dailySet && (!Number.isFinite(dailyAmount) || dailyAmount <= 0)) ||
    (monthlySet && (!Number.isFinite(monthlyAmount) || monthlyAmount <= 0));

  /** 打开时重置成这位成员当前的真实配置，而不是上一次谁的残留。 */
  const reset = () => {
    setDailyValue(member.dailyLimitCNY ?? '');
    setMonthlyValue(member.monthlyLimitCNY ?? member.limitCNY ?? '');
    setNote('');
  };

  const submit = () => {
    if (invalid) return;
    mutation.mutate(
      {
        userId: member.userId,
        limitCNY: cleared ? null : !dailySet && monthlySet ? Math.round(monthlyAmount * 100) / 100 : undefined,
        dailyLimitCNY: dailySet ? Math.round(dailyAmount * 100) / 100 : null,
        monthlyLimitCNY: monthlySet ? Math.round(monthlyAmount * 100) / 100 : null,
        note: note.trim() || undefined,
      },
      {
        onSuccess: (result) => {
          toast.success(
            cleared
              ? `${member.name} 已改为不限额`
              : `${member.name} 限额已更新`,
            cleared ? undefined : '每日与每月限额已分别保存',
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
              设置并行的每日、每月消费上限。限额只控制消费速度，不会扣除企业充值余额。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-fg-muted">
              <span>
                本月已用 {formatCnyPrecise(member.monthlyUsedCNY ?? member.usedCNY)}
              </span>
              <span>
                企业充值余额 {formatCny(member.topUpRemainingCNY)}
              </span>
            </div>

            <div className="space-y-1">
              <Label htmlFor="daily-limit" className="text-xs">每日限额（元）</Label>
              <Input
                id="daily-limit"
                type="number"
                inputMode="decimal"
                min={0.01}
                step={0.01}
                placeholder="留空 = 不限额"
                value={dailyValue}
                onChange={(e) => setDailyValue(e.target.value)}
                aria-label="每日限额（元）"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="monthly-limit" className="text-xs">每月限额（元）</Label>
              <Input
                id="monthly-limit"
                type="number"
                inputMode="decimal"
                min={0.01}
                step={0.01}
                placeholder="留空 = 不限额"
                value={monthlyValue}
                onChange={(e) => setMonthlyValue(e.target.value)}
                aria-label="每月限额（元）"
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-fg-muted">每月常用额度</p>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setMonthlyValue(String(p))}
                    className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-muted/70"
                  >
                    ¥{p}/月
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-fg-muted">每日常用额度</p>
              <div className="flex flex-wrap gap-1.5">
                {[10, 20, 50, 100].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setDailyValue(String(p))}
                    className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-muted/70"
                  >
                    ¥{p}/日
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setDailyValue('');
                  setMonthlyValue('');
                }}
                className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-muted/70"
              >
                不限额
              </button>
            </div>

            {invalid && <p className="text-xs text-red-500">请输入大于 0 的金额</p>}

            {!cleared && <p className="text-xs text-fg-muted">每日和每月同时启用时，系统按剩余额度更低的一项执行。</p>}

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

            {member.dailyLimitCNY && Number(member.dailyRemainingCNY) <= 0 && !member.dailyBypassActive && (
              <Button type="button" size="sm" variant="glass" onClick={() => {
                const end = new Date();
                end.setHours(23, 59, 59, 999);
                mutation.mutate({ userId: member.userId, dailyBypassUntil: end.toISOString() });
              }}>
                今日临时放开每日限额
              </Button>
            )}
            {member.dailyBypassActive && (
              <div className="flex items-center gap-2">
                <p className="text-xs text-emerald-600">今日每日限额已临时放开，月度限额仍然有效。</p>
                <Button type="button" size="sm" variant="ghost" onClick={() => mutation.mutate({ userId: member.userId, dailyBypassUntil: null })}>
                  取消临时放开
                </Button>
              </div>
            )}

            {/*
              §5.7 ④：额度用尽是**改道**不是拦停。旧文案写的「保存后他本月无法继续对话」
              是错的 —— 扣费链上个人钱包排在企业资金之后，他自己有余额就照样对话，
              只是这些消费由他自付。把改道说成停用，会让管理员以为自己按了个开关。
            */}
            {monthlySet && Number(member.monthlyUsedCNY ?? member.usedCNY) > monthlyAmount && (
              <p className="text-xs text-amber-600">新的每月限额低于本月已用金额，超过这个额度后本月企业资金将停止承担。</p>
            )}

            {!cleared && Number(member.topUpRemainingCNY) > 0 && (
              <p className="text-xs text-fg-muted">
                他还有企业充值余额 {formatCny(member.topUpRemainingCNY)} ——
                跨周期保留，受本周期额度上限约束，改上限不会清空余额。
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
