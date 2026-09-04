'use client';

import { useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import {
  formatCny,
  formatCnyPrecise,
  useAllowanceChanges,
  useAllowanceTopUps,
  type AllowanceChangeItem,
} from '@/lib/api/use-compute-credit';
import { PERIOD_LABELS } from './allowance-period-labels';

type Tab = 'changes' | 'topUps';

function when(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

/** 「¥500 → 不限额」「每月 → 每周」这类前后对照。相同的那一项不显示。 */
function changeSummary(row: AllowanceChangeItem): string[] {
  const parts: string[] = [];
  const from = row.fromLimitCNY ? formatCny(row.fromLimitCNY) : '不限额';
  const to = row.toLimitCNY ? formatCny(row.toLimitCNY) : '不限额';
  if (from !== to) parts.push(`额度 ${from} → ${to}`);
  if (row.fromPeriod !== row.toPeriod) {
    parts.push(
      `周期 ${row.fromPeriod ? PERIOD_LABELS[row.fromPeriod] : '—'} → ${
        row.toPeriod ? PERIOD_LABELS[row.toPeriod] : '—'
      }`,
    );
  }
  if (row.fromCarryOver !== row.toCarryOver && row.toCarryOver !== null) {
    parts.push(row.toCarryOver ? '开启结转' : '关闭结转');
  }
  // 三项都没变说明这是一条「只留了备注」的记录，如实说，不要显示成空行
  return parts.length > 0 ? parts : ['仅备注'];
}

/**
 * 额度留痕 —— 谁在什么时候把谁的额度改成了多少。
 *
 * 存在的理由是一个具体问题：「他这个月只花了 ¥200 就要自付了，为什么？」
 * 答案通常是「上周有人把他的上限从 ¥500 调到了 ¥150」，而这件事
 * 在额度列表上看不出来 —— 列表只显示现状。所以每条变更都带**当时的已用金额**，
 * 没有它就没法解释当时的判定。
 *
 * 折叠默认收起：这是排查用的信息，不是日常要看的。
 */
export function AllowanceAuditPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('changes');

  const changes = useAllowanceChanges(undefined, open && tab === 'changes');
  const topUps = useAllowanceTopUps(undefined, open && tab === 'topUps');

  const loading = tab === 'changes' ? changes.isLoading : topUps.isLoading;
  const changeRows = changes.data ?? [];
  const topUpRows = topUps.data ?? [];
  const empty = tab === 'changes' ? changeRows.length === 0 : topUpRows.length === 0;

  return (
    <section className="scroll-mt-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-fg-muted transition-colors hover:text-foreground"
      >
        <History className="h-4 w-4" />
        额度留痕
        <span className="text-xs text-fg-muted/70">
          {open ? '收起' : '谁改了谁的额度 · 谁追加过额度'}
        </span>
      </button>

      {open && (
        <div className="mt-3 border border-border/70 bg-card">
          <div className="flex gap-1 border-b border-border/70 px-2 py-2">
            {(
              [
                ['changes', '额度变更'],
                ['topUps', '追加额度'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  tab === key
                    ? 'bg-violet-100 text-violet-700'
                    : 'text-fg-muted hover:bg-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-fg-muted" />
            </div>
          ) : empty ? (
            <p className="py-10 text-center text-sm text-fg-muted">
              {tab === 'changes' ? '还没有额度变更记录' : '还没有追加过额度'}
            </p>
          ) : tab === 'changes' ? (
            <ul>
              {changeRows.map((row) => (
                <li
                  key={row.id}
                  className="border-b border-border/40 px-4 py-2.5 text-xs last:border-b-0"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-medium text-foreground">{row.userName}</span>
                    <span className="text-fg-muted">{changeSummary(row).join(' · ')}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-fg-muted/70">
                      {when(row.createdAt)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-fg-muted/80">
                    {row.usedAtChangeCNY !== null && (
                      <span>当时已用 {formatCnyPrecise(row.usedAtChangeCNY)}</span>
                    )}
                    {row.changedByName && <span>操作人 {row.changedByName}</span>}
                    {row.note && <span className="italic">「{row.note}」</span>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <ul>
              {topUpRows.map((row) => (
                <li
                  key={row.id}
                  className="border-b border-border/40 px-4 py-2.5 text-xs last:border-b-0"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-medium text-foreground">{row.userName}</span>
                    <span className="text-sky-600 tabular-nums">
                      追加 {formatCny(row.amountCNY)}
                    </span>
                    <span className="text-fg-muted">
                      已消耗 {formatCnyPrecise(row.consumedCNY)} · 剩{' '}
                      {formatCnyPrecise(row.remainingCNY)}
                    </span>
                    <span className="ml-auto shrink-0 tabular-nums text-fg-muted/70">
                      {when(row.createdAt)}
                    </span>
                  </div>
                  {(row.grantedByName || row.note) && (
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-fg-muted/80">
                      {row.grantedByName && <span>批准人 {row.grantedByName}</span>}
                      {row.note && <span className="italic">「{row.note}」</span>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
