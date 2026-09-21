'use client';

import Link from 'next/link';
import { memo } from 'react';
import {
  Activity,
  ArrowUpRight,
  Clock3,
  MessageSquare,
  Users,
  Wallet,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Avatar } from '@/components/ui/avatar';
import { buttonVariants } from '@/components/ui/button';
import type { MyEmployee } from '@/lib/types';
import {
  formatLastUsed,
  formatSuccessRate,
  giftProgress,
} from '@/features/employee/usage-summary';
import { cn } from '@/lib/utils';

export const EmployeeCard3D = memo(function EmployeeCard3D({
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
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="glass-card group relative flex min-w-0 flex-col overflow-hidden rounded-glass-lg border border-glassline p-4 transition-all duration-300 hover:border-glassline-brand hover:shadow-glow-brand"
    >
      {/* 悬停光效 */}
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <div className="absolute -top-24 right-0 h-48 w-48 rounded-full bg-gbrand-text/10 blur-3xl" />
      </div>

      <Link
        href={detailUrl}
        className="relative z-10 flex min-w-0 items-center gap-3 rounded-md focus-visible:outline-primary"
      >
        <motion.div
          whileHover={{ scale: 1.05 }}
          transition={{ type: 'spring', stiffness: 300 }}
        >
          <Avatar
            name={name}
            src={template.avatar}
            asset={template.avatarAsset}
            portrait
            className="h-[104px] w-[104px] shrink-0 rounded-glass-md border-2 border-glassline group-hover:border-glassline-brand"
          />
        </motion.div>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-lg font-semibold leading-6 text-gtext-primary">
            {name}
          </h2>
          {name !== template.name && (
            <p
              className="mt-1 truncate text-xs text-gtext-muted"
              title={template.name}
            >
              {template.name}
            </p>
          )}
          <p className="mt-2 text-xs tabular-nums text-gtext-muted">
            v{employee.templateVersion}
          </p>
          <p className="mt-1 text-xs text-gtext-muted">
            {grantSource === 'DIRECT' ? '直接授权' : '部门授权'}
          </p>
        </div>
      </Link>

      <p
        className="relative z-10 mb-3 mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-gtext-secondary"
        title={template.description || template.position || undefined}
      >
        {template.description || template.position || '暂无员工简介'}
      </p>

      {usage && (
        <dl
          aria-label="本企业使用情况"
          className="relative z-10 space-y-2 border-t border-glassline py-3 text-xs"
        >
          <UsageRow icon={<Users />} label="近 30 天在用">
            <span className="font-medium text-gtext-primary">
              {usage.activeUserCount30d} 人
            </span>
            <span> / 已授权 {usage.grantedUserCount} 人</span>
          </UsageRow>
          <UsageRow icon={<Clock3 />} label="上次使用">
            {formatLastUsed(usage.lastUsedAt)}
          </UsageRow>
          <UsageRow icon={<Wallet />} label="本月消费">
            <span className="font-medium text-gtext-primary">
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
                    ? 'text-gsuccess'
                    : 'text-gwarning'
              }
            >
              {formatSuccessRate(usage.successRate30d)}
            </span>
            <span> · {usage.executionCount30d} 次执行</span>
          </UsageRow>
        </dl>
      )}

      {gift && (
        <div className="relative z-10 mb-3 mt-1 space-y-2">
          <div className="flex flex-wrap justify-between gap-1 text-xs text-gtext-muted">
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
              'h-1.5 overflow-hidden rounded-full bg-glass-2',
              gift.exhausted && 'bg-gdanger/20',
            )}
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${gift.remainingPercent}%` }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className={cn(
                'h-full rounded-full',
                gift.low ? 'bg-gwarning' : 'bg-gsuccess',
              )}
              style={{
                minWidth: gift.exhausted ? undefined : 3,
              }}
            />
          </div>
          {gift.exhausted && (
            <p className="text-xs text-gtext-muted">赠送算力已用尽</p>
          )}
        </div>
      )}

      <div className="relative z-10 mb-4">
        <h3 className="mb-2 text-xs font-medium text-gtext-muted">
          已绑定技能与能力
        </h3>
        <div className="flex min-h-6 flex-wrap gap-1.5">
          {bindings.slice(0, 3).map(({ id, capability }) => (
            <motion.span
              key={id}
              title={capability.name}
              whileHover={{ scale: 1.05 }}
              className="max-w-full truncate rounded-md border border-glassline bg-gbrand/10 px-2 py-1 text-xs text-gbrand-text backdrop-blur-sm"
            >
              {capability.name}
            </motion.span>
          ))}
          {bindings.length > 3 && (
            <Link
              href={detailUrl}
              className="py-1 text-xs text-gtext-muted hover:text-gbrand-text"
            >
              还有 {bindings.length - 3} 项
            </Link>
          )}
          {!bindings.length && (
            <span className="text-xs text-gtext-muted">暂无绑定能力</span>
          )}
        </div>
      </div>

      <div className="relative z-10 mt-auto flex items-center justify-between gap-3 border-t border-glassline pt-3">
        <Link
          href={`/chat?employeeId=${template.id}`}
          className={cn(
            buttonVariants({ size: 'sm' }),
            'bg-gbrand text-white hover:bg-gbrand-hover',
          )}
        >
          <MessageSquare className="h-4 w-4" />
          开始对话
        </Link>
        <Link
          href={detailUrl}
          className="inline-flex items-center gap-1 py-1.5 text-sm text-gtext-muted hover:text-gbrand-text"
        >
          查看详情
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </motion.article>
  );
});

function UsageRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <dt className="flex shrink-0 items-center gap-2 text-gtext-muted">
        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        {label}
      </dt>
      <dd className="min-w-0 text-right tabular-nums text-gtext-muted">
        {children}
      </dd>
    </div>
  );
}
