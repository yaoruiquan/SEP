'use client';

import Link from 'next/link';
import {
  ArrowUpCircle,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  ShieldCheck,
  UserMinus,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { SUBSCRIPTION_STATUS_STYLE, SUBSCRIPTION_STATUS_LABEL } from '@/lib/utils';
import { formatLastUsed } from '@/features/employee/usage-summary';
import {
  attentionMeta,
  describeGrantShape,
  type EmploymentRow,
} from '@/features/subscription/employment-row';
import { employment } from '@/locales/zh-CN';
import type { Subscription } from '@/lib/types';

const TONE_CLASS = {
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-primary/10 text-primary',
} as const;

interface EmploymentTableProps {
  rows: readonly EmploymentRow[];
  isAdmin: boolean;
  onGrant: (sub: Subscription) => void;
  onRename: (sub: Subscription) => void;
  onRelease: (sub: Subscription) => void;
  onUpgrade: (sub: Subscription) => void;
  onChangeStatus: (sub: Subscription, status: 'ACTIVE' | 'PAUSED') => void;
  busy?: boolean;
}

/**
 * 雇佣管理主列表。
 *
 * 为什么是表格而不是卡片：这一页要回答的是「哪一段雇佣关系需要我处理」，
 * 判断依据是**跨行比较**（谁的在用人数是 0、谁还没授权）。19 张卡片摆成网格
 * 没法跳着比一列，而且和「我的硅基员工」长得一样 —— 那一页是使用者视角的
 * 门户，本页是管理台，同形会让人以为是同一个功能的两个入口。
 *
 * 另外 PRD 明确要求「数据密集区用实心表面」（零 GPU 成本），
 * 19 个毛玻璃卡片同屏是最贵的一种画法。
 */
export function EmploymentTable({
  rows,
  isAdmin,
  onGrant,
  onRename,
  onRelease,
  onUpgrade,
  onChangeStatus,
  busy = false,
}: EmploymentTableProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs text-fg-muted">
              <th className="px-4 py-3 text-left font-medium">硅基员工</th>
              <th className="px-4 py-3 text-left font-medium">授权</th>
              {/* 「在用」与「授权」必须挨着：这两个数只有并排看才有意义 ——
                  授权 4 人只 1 人用，说明买了没人用；单看任何一个都得不出结论 */}
              <th className="px-4 py-3 text-left font-medium">近 30 天在用</th>
              <th className="px-4 py-3 text-left font-medium">状态</th>
              <th className="px-4 py-3 text-left font-medium">版本</th>
              <th className="px-4 py-3 text-right font-medium">赠送算力</th>
              {isAdmin && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <EmploymentTableRow
                key={row.subscription.id}
                row={row}
                isAdmin={isAdmin}
                onGrant={onGrant}
                onRename={onRename}
                onRelease={onRelease}
                onUpgrade={onUpgrade}
                onChangeStatus={onChangeStatus}
                busy={busy}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmploymentTableRow({
  row,
  isAdmin,
  onGrant,
  onRename,
  onRelease,
  onUpgrade,
  onChangeStatus,
  busy,
}: {
  row: EmploymentRow;
  isAdmin: boolean;
  onGrant: (sub: Subscription) => void;
  onRename: (sub: Subscription) => void;
  onRelease: (sub: Subscription) => void;
  onUpgrade: (sub: Subscription) => void;
  onChangeStatus: (sub: Subscription, status: 'ACTIVE' | 'PAUSED') => void;
  busy?: boolean;
}) {
  const { subscription: sub, dismissed, primaryAttention } = row;
  const usage = sub.usage;
  const attention = primaryAttention ? attentionMeta(primaryAttention) : null;
  const gift = Number(sub.giftGrantedCNY ?? 0);

  return (
    <tr
      className={cn(
        'border-b border-border/40 last:border-b-0 hover:bg-muted/30',
        dismissed && 'opacity-55',
      )}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar
            name={sub.employee.name}
            src={sub.employee.avatar}
            className="h-9 w-9 shrink-0 text-xs"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {/* 点名字进员工详情：管理员最常做的下一步是「看这位到底被谁用了」 */}
              <Link
                href={`/my-employees/${sub.id}`}
                className="truncate font-medium hover:text-primary hover:underline"
              >
                {sub.name}
              </Link>
              {attention && (
                <Badge className={cn('shrink-0 text-[11px]', TONE_CLASS[attention.tone])}>
                  {attention.label}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-fg-muted">
              {/* 自定义过称呼才补模板名，否则第二行是标题的复读 */}
              {sub.name !== sub.employee.name && <>{sub.employee.name} · </>}
              {sub.employee.position}
            </p>
          </div>
        </div>
      </td>

      <td className="whitespace-nowrap px-4 py-3">
        {usage ? (
          <>
            <span className={usage.grantedUserCount === 0 ? 'text-danger' : 'tabular-nums'}>
              {usage.grantedUserCount === 0 ? '未授权' : `${usage.grantedUserCount} 人`}
            </span>
            {usage.grantedUserCount > 0 && (
              <p className="mt-0.5 text-xs text-fg-muted">{describeGrantShape(sub)}</p>
            )}
          </>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </td>

      <td className="whitespace-nowrap px-4 py-3">
        {usage ? (
          <>
            <span
              className={cn(
                'tabular-nums',
                usage.activeUserCount30d === 0 && usage.grantedUserCount > 0 && 'text-warning',
              )}
              title={
                usage.activeUserCount30d > usage.grantedUserCount
                  ? '在用人数统计近 30 天实际调用过的人，含之后被收回授权或调岗的成员，因此可能多于当前授权人数'
                  : '近 30 天在本企业内实际调用过的人数（去重），系统内部调用不计'
              }
            >
              {usage.activeUserCount30d} 人
            </span>
            <p className="mt-0.5 text-xs text-fg-muted">{formatLastUsed(usage.lastUsedAt)}</p>
          </>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </td>

      <td className="whitespace-nowrap px-4 py-3">
        <Badge className={SUBSCRIPTION_STATUS_STYLE[sub.status]}>
          {SUBSCRIPTION_STATUS_LABEL[sub.status]}
        </Badge>
      </td>

      <td className="whitespace-nowrap px-4 py-3">
        <span className="tabular-nums text-fg-muted">v{sub.templateVersion}</span>
        {sub.upgradeAvailable && !dismissed && (
          <p className="mt-0.5 text-xs text-warning">可升 v{sub.latestVersion}</p>
        )}
      </td>

      <td className="whitespace-nowrap px-4 py-3 text-right">
        {sub.giftStatus === 'NONE' || gift === 0 ? (
          <span className="text-fg-subtle">无</span>
        ) : (
          <span
            className={cn(
              'tabular-nums',
              sub.giftStatus === 'EXHAUSTED' ? 'text-fg-muted' : undefined,
            )}
            // 赠送算力是人民币余额，用完后自动扣企业钱包 ——
            // 不说清这一点，「剩余 ¥0.00」会被读成「这个员工不能用了」
            title="订阅时获得的人民币算力余额。用完后继续对话将从企业钱包余额扣除。"
          >
            ¥{Number(sub.giftRemainingCNY ?? 0).toFixed(2)}
            <span className="text-fg-muted"> / ¥{gift.toFixed(2)}</span>
          </span>
        )}
      </td>

      {isAdmin && (
        <td className="whitespace-nowrap px-4 py-3 text-right">
          {dismissed ? (
            <span className="text-xs text-fg-subtle">已解聘</span>
          ) : (
            <div className="flex items-center justify-end gap-1.5">
              {/* 授权是这一页唯一的高频动作，留在行内；其余收进菜单 */}
              <Button variant="outline" size="sm" onClick={() => onGrant(sub)}>
                <ShieldCheck className="h-3.5 w-3.5" />
                <span className="ml-1">授权</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label={`${sub.name} 的更多操作`}
                    className="rounded-lg border border-border p-2 text-fg-muted hover:bg-muted hover:text-foreground"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onSelect={() => onRename(sub)}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    改称呼
                  </DropdownMenuItem>
                  {sub.upgradeAvailable && (
                    <DropdownMenuItem disabled={busy} onSelect={() => onUpgrade(sub)}>
                      <ArrowUpCircle className="mr-2 h-3.5 w-3.5 text-warning" />
                      升级到 v{sub.latestVersion}
                    </DropdownMenuItem>
                  )}
                  {sub.status === 'ACTIVE' ? (
                    <DropdownMenuItem
                      disabled={busy}
                      onSelect={() => onChangeStatus(sub, 'PAUSED')}
                    >
                      <Pause className="mr-2 h-3.5 w-3.5" />
                      暂停
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      disabled={busy}
                      onSelect={() => onChangeStatus(sub, 'ACTIVE')}
                    >
                      <Play className="mr-2 h-3.5 w-3.5 text-success" />
                      恢复在岗
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() => onRelease(sub)}
                    className="text-danger focus:text-danger"
                  >
                    <UserMinus className="mr-2 h-3.5 w-3.5" />
                    {employment.release}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </td>
      )}
    </tr>
  );
}
