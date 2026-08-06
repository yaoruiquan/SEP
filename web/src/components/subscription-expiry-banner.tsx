'use client';

import Link from 'next/link';
import { AlertTriangle, X, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { differenceInDays, parseISO } from 'date-fns';
import { useSubscriptions } from '@/features/subscription/use-subscriptions';
import type { Subscription } from '@/lib/types';

const WARN_DAYS = 7;

function daysUntilExpiry(sub: Subscription): number | null {
  if (!sub.endDate) return null;
  const days = differenceInDays(parseISO(sub.endDate), new Date());
  return days >= 0 ? days : -1; // -1 表示已过期
}

/**
 * 订阅到期提醒横幅
 *
 * 当企业有订阅将在 7 天内到期时，显示此横幅。
 * 用户可手动关闭（仅本次会话）。
 */
export function SubscriptionExpiryBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { data: subscriptions } = useSubscriptions();

  if (dismissed || !subscriptions?.length) return null;

  const expiringSoon = subscriptions
    .map((s) => ({ ...s, daysLeft: daysUntilExpiry(s) }))
    .filter((s) => s.daysLeft !== null && s.daysLeft <= WARN_DAYS)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));

  if (expiringSoon.length === 0) return null;

  const isAnyExpired = expiringSoon.some((s) => s.daysLeft === -1);
  const soonest = expiringSoon[0];

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
        isAnyExpired
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-amber-200 bg-amber-50 text-amber-800'
      }`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />

      <div className="flex-1 min-w-0">
        {isAnyExpired ? (
          <p>
            <span className="font-semibold">订阅已过期：</span>
            {expiringSoon
              .filter((s) => s.daysLeft === -1)
              .map((s) => s.employee.name)
              .join('、')}
            {' '}的订阅已到期，员工将无法继续使用。
          </p>
        ) : (
          <p>
            <span className="font-semibold">
              {soonest.daysLeft === 0 ? '今日到期：' : `${soonest.daysLeft} 天后到期：`}
            </span>
            {expiringSoon.map((s) => s.employee.name).join('、')}
            {' '}的订阅即将到期，请及时续费。
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Link
          href="/subscriptions"
          className={`flex items-center gap-1 rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
            isAnyExpired
              ? 'border-red-300 bg-red-100 hover:bg-red-200 text-red-700'
              : 'border-amber-300 bg-amber-100 hover:bg-amber-200 text-amber-700'
          }`}
        >
          <RefreshCw className="h-3 w-3" />
          续费
        </Link>
        <button
          onClick={() => setDismissed(true)}
          className="rounded p-1 hover:bg-black/10"
          aria-label="关闭提醒"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
