'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Gauge, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCny } from '@/lib/api/use-compute-credit';
import { useAuthStore } from '@/lib/auth-store';
import { PersonalDepositDialog } from '@/features/compute/personal-deposit-dialog';
import type { ComputeBlockedInfo } from './use-chat-stream';

interface Props {
  /** 非空即弹窗。来自 `useChatStream` 的 `state.blocked` */
  info: ComputeBlockedInfo | null;
  /** 关闭弹窗（清掉 state.blocked）。气泡区的红字提示不跟着清 */
  onClose: () => void;
}

/**
 * 对话被算力闸门拦下时的明确弹窗（方案 §5.5 #3 的验收点）。
 *
 * 为什么必须是弹窗而不是气泡下的一行红字：被拦下时用户下一步该做什么完全不显然 ——
 * 额度什么时候重置、找谁、还是自己掏钱，三个问题都得当场答上。
 *
 * ⚠️ 宿主要**无条件挂载**它（`<QuotaBlockedDialog info={state.blocked} …/>`，
 * 不要写成 `{state.blocked && <QuotaBlockedDialog …/>}`）：点「个人余额充值」时
 * 本弹窗会先自关（info 变 null），充值弹窗的开关状态存在这里，条件挂载会让它
 * 刚打开就被卸载。
 */
export function QuotaBlockedDialog({ info, onClose }: Props) {
  const [depositOpen, setDepositOpen] = useState(false);
  const roleInEnterprise = useAuthStore((s) => s.roleInEnterprise);
  const isAdmin = roleInEnterprise === 'ENTERPRISE_ADMIN';

  // ALLOWANCE = 你这周期花超了（公司账上有钱）；BALANCE = 公司账上没钱了。
  // 两者都说成「余额不足」，成员会去催财务充值，而钱其实是够的。
  const byAllowance = info?.blockedBy === 'ALLOWANCE';

  const openDeposit = () => {
    onClose();
    // 下一帧再开：两层 Radix Dialog 同时在场会互相抢焦点，
    // 等本弹窗卸载、Radix 把焦点还回去之后再挂充值弹窗才不会闪。
    requestAnimationFrame(() => setDepositOpen(true));
  };

  return (
    <>
      <Dialog open={!!info} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
              {byAllowance ? '算力额度已用尽' : '企业算力余额不足'}
            </DialogTitle>
            {/*
              后端 reason 原样展示：它已经带了重置时间（按 Asia/Shanghai 业务时区渲染）
              和两条出路。前端再拼一遍就会有两份说法，浏览器时区一变就对不上。
            */}
            <DialogDescription className="leading-6">
              {info?.message}
            </DialogDescription>
          </DialogHeader>

          <div className="border border-border/70 bg-muted/40 px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-fg-muted">你的个人余额</span>
              <span className="font-medium tabular-nums text-foreground">
                {formatCny(info?.personalBalanceCNY)}
              </span>
            </div>
            {/*
              自付不是自我惩罚：管理员端的「本周期已用」只统计企业资金，
              不会因为你自己掏钱而增长（§5.5 #4 的判据）。不写这句，
              用户会怕充值反而把自己的额度烧得更快。
            */}
            <p className="mt-1.5 text-xs leading-5 text-fg-muted">
              个人余额只在公司不为这次对话付钱时才被动用。充值后即可继续对话，
              管理员端的「本周期已用」不会因此增长。
            </p>
          </div>

          <DialogFooter>
            {byAllowance ? (
              // 两种角色都落在「算力余额」页，只是锚点不同：管理员的目标是
              // 页顶的成员额度分配表，成员的目标是页内「我的算力」那一块。
              <Link
                href={isAdmin ? '/compute-quota' : '/compute-quota#my-compute'}
                onClick={onClose}
                className="inline-flex h-10 items-center justify-center gap-1.5 border border-border/70 px-4 text-sm text-foreground transition-colors hover:bg-muted/40"
              >
                <Gauge className="h-4 w-4" />
                {isAdmin ? '去调整额度' : '查看我的额度'}
              </Link>
            ) : (
              <Link
                href={isAdmin ? '/wallet' : '/compute-quota#my-compute'}
                onClick={onClose}
                className="inline-flex h-10 items-center justify-center gap-1.5 border border-border/70 px-4 text-sm text-foreground transition-colors hover:bg-muted/40"
              >
                <Wallet className="h-4 w-4" />
                {isAdmin ? '给企业钱包充值' : '查看我的算力'}
              </Link>
            )}
            {/* primary 而非 glass-primary：Portal 里没有 glass 作用域令牌 */}
            <Button variant="primary" onClick={openDeposit}>
              <Wallet className="h-4 w-4" />
              个人余额充值
            </Button>
          </DialogFooter>

          {!isAdmin && (
            <p className="text-xs leading-5 text-fg-muted">
              {byAllowance
                ? '要继续用公司额度：联系企业管理员调高额度或追加一次性额度。'
                : '要继续用公司资金：联系企业管理员为企业钱包充值。'}
            </p>
          )}
        </DialogContent>
      </Dialog>

      <PersonalDepositDialog open={depositOpen} onOpenChange={setDepositOpen} />
    </>
  );
}
