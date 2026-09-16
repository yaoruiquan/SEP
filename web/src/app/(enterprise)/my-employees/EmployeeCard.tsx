'use client';

import Link from 'next/link';
import { memo, type ReactNode } from 'react';
import {
  Activity,
  ArrowUpRight,
  Clock3,
  MessageSquare,
  Users,
  Wallet,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { buttonVariants } from '@/components/ui/button';
import type { MyEmployee } from '@/lib/types';
import {
  formatLastUsed,
  formatSuccessRate,
  giftProgress,
} from '@/features/employee/usage-summary';
import { cn } from '@/lib/utils';

export const EmployeeCard = memo(function EmployeeCard({
  employee,
}: {
  employee: MyEmployee;
}) {
  const {
    subscriptionId,
    name,
    employee: template,
    usage,
    grantSource,
  } = employee;
  const gift = giftProgress(employee);
  const bindings = template.bindings ?? [];
  const detailUrl = `/my-employees/${subscriptionId}`;

  return (
    <article className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <Link
        href={detailUrl}
        className="flex min-w-0 items-center gap-3 rounded-md focus-visible:outline-primary"
      >
        <Avatar
          name={name}
          src={template.avatar}
          asset={template.avatarAsset}
          portrait
          className="h-[104px] w-[104px] shrink-0 rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-lg font-semibold leading-6 text-foreground">
            {name}
          </h2>
          {name !== template.name && (
            <p
              className="mt-1 truncate text-xs text-fg-muted"
              title={template.name}
            >
              {template.name}
            </p>
          )}
          <p className="mt-2 text-xs tabular-nums text-fg-muted">
            v{employee.templateVersion}
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            {grantSource === 'DIRECT' ? '直接授权' : '部门授权'}
          </p>
        </div>
      </Link>

      <p
        className="mb-3 mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-fg-muted"
        title={template.description || template.position || undefined}
      >
        {template.description || template.position || '暂无员工简介'}
      </p>

      {usage && (
        <dl
          aria-label="本企业使用情况"
          className="space-y-2 border-t border-border py-3 text-xs"
        >
          <UsageRow icon={<Users />} label="近 30 天在用">
            <span className="font-medium text-foreground">
              {usage.activeUserCount30d} 人
            </span>
            <span> / 已授权 {usage.grantedUserCount} 人</span>
          </UsageRow>
          <UsageRow icon={<Clock3 />} label="上次使用">
            {formatLastUsed(usage.lastUsedAt)}
          </UsageRow>
          <UsageRow icon={<Wallet />} label="本月消费">
            <span className="font-medium text-foreground">
              ¥{Number(usage.monthCostCNY).toFixed(2)}
            </span>
            <span> · {usage.monthCallCount} 次调用</span>
          </UsageRow>
          <UsageRow icon={<Activity />} label="近 30 天成功率">
            <span
              className={
                usage.successRate30d === null
                  ? ''
                  : usage.successRate30d >= 90
                    ? 'text-success'
                    : 'text-warning'
              }
            >
              {formatSuccessRate(usage.successRate30d)}
            </span>
            <span> · {usage.executionCount30d} 次执行</span>
          </UsageRow>
        </dl>
      )}

      {gift && (
        <div className="mb-3 mt-1 space-y-2">
          <div className="flex flex-wrap justify-between gap-1 text-xs text-fg-muted">
            <span>赠送算力</span>
            <span className="tabular-nums">
              剩余 ¥{gift.remainingCNY.toFixed(2)} / ¥
              {gift.grantedCNY.toFixed(2)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="赠送算力剩余比例"
            aria-valuenow={gift.remainingPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            className={cn(
              'h-1.5 overflow-hidden rounded-full bg-muted',
              gift.exhausted && 'bg-danger/20',
            )}
          >
            <div
              className={cn(
                'h-full rounded-full',
                gift.low ? 'bg-warning' : 'bg-success',
              )}
              style={{
                width: `${gift.remainingPercent}%`,
                minWidth: gift.exhausted ? undefined : 3,
              }}
            />
          </div>
          {gift.exhausted && (
            <p className="text-xs text-fg-muted">赠送算力已用尽</p>
          )}
        </div>
      )}

      <div className="mb-4">
        <h3 className="mb-2 text-xs font-medium text-fg-muted">
          已绑定技能与能力
        </h3>
        <div className="flex min-h-6 flex-wrap gap-1.5">
          {bindings.slice(0, 3).map(({ id, capability }) => (
            <span
              key={id}
              title={capability.name}
              className="max-w-full truncate rounded bg-blue-50 px-2 py-1 text-xs text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
            >
              {capability.name}
            </span>
          ))}
          {bindings.length > 3 && (
            <Link
              href={detailUrl}
              className="py-1 text-xs text-fg-muted hover:text-primary"
            >
              还有 {bindings.length - 3} 项
            </Link>
          )}
          {!bindings.length && (
            <span className="text-xs text-fg-muted">暂无绑定能力</span>
          )}
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
        <Link
          href={`/chat?employeeId=${template.id}`}
          className={buttonVariants({ size: 'sm' })}
        >
          <MessageSquare className="h-4 w-4" />
          开始对话
        </Link>
        <Link
          href={detailUrl}
          className="inline-flex items-center gap-1 py-1.5 text-sm text-fg-muted hover:text-primary"
        >
          查看详情
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </article>
  );
});

function UsageRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <dt className="flex shrink-0 items-center gap-2 text-fg-muted">
        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        {label}
      </dt>
      <dd className="min-w-0 text-right tabular-nums text-fg-muted">
        {children}
      </dd>
    </div>
  );
}
