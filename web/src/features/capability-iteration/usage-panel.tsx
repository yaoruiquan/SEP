'use client';

import { useState } from 'react';
import { ChevronDown, MessageSquareText, Sparkles, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ExecutionDetailPanel } from './execution-detail-panel';
import { useCapabilityUsage } from './use-capability-iteration';

/**
 * 使用记录。
 *
 * 会议要求「员工的使用记录需要可追踪：谁在使用、用了多少次、进行了多少轮对话」。
 * 顶部大字回答「本企业多少人在用」—— 这是会议明确点出来的一个数字。
 *
 * 措辞刻意避开「监控」：会议原话是对外统一用「能力迭代」。数据要有，但框架是
 * 「沉淀企业能力」而不是「盯着员工」。
 */
export function UsagePanel({
  capabilityId,
  canManage = false,
}: {
  capabilityId: string;
  canManage?: boolean;
}) {
  const { data, isLoading, isError } = useCapabilityUsage(capabilityId);
  // 执行明细是使用统计的下钻，不是平级话题 —— 原先它占一个独立 tab，
  // §6.7「目录层级越深越难用」之后收进这里，默认收起
  const [showExecutions, setShowExecutions] = useState(false);

  if (isLoading) {
    return <div className="h-40 animate-pulse rounded-glass-lg border border-glassline bg-glass-1" />;
  }

  if (isError || !data) {
    return (
      <p className="rounded-glass-lg border border-gdanger/25 bg-gdanger/[0.06] px-4 py-6 text-center text-xs text-gdanger">
        使用记录加载失败
      </p>
    );
  }

  const { summary, byEmployee, byMember } = data;
  const noUsage = summary.totalRounds === 0;

  if (noUsage) {
    return (
      <div className="rounded-glass-lg border border-dashed border-glassline bg-glass-1 px-4 py-10 text-center">
        <Sparkles className="mx-auto h-5 w-5 text-gtext-disabled" />
        <p className="mt-2.5 text-sm font-medium text-gtext-secondary">这个技能还没有被使用过</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-gtext-muted">
          企业成员在对话中调用它之后，使用情况会出现在这里，用于判断哪些经验值得沉淀成企业版本。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 顶部一行大字 —— 会议要求的「使用人数」要明显 */}
      <div className="rounded-glass-lg border border-glassline-brand bg-gbrand/[0.06] px-4 py-3.5">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-semibold text-gtext-primary">
          <span>本企业</span>
          <span className="text-2xl font-bold tabular-nums text-gbrand-text">
            {summary.distinctUserCount}
          </span>
          <span>人在用</span>
          <span className="text-gtext-muted">·</span>
          <span className="tabular-nums">{summary.totalConversations}</span>
          <span>个会话</span>
          <span className="text-gtext-muted">·</span>
          <span className="tabular-nums">{summary.totalRounds}</span>
          <span>次调用</span>
        </p>
        <p className="mt-1 text-[11px] text-gtext-muted">
          用于识别可沉淀到企业技能中的使用经验
        </p>
      </div>

      <UsageBreakdown
        title="按硅基员工"
        icon={Users}
        rows={byEmployee.map((row) => ({
          key: row.employeeId,
          label: row.employeeName,
          rounds: row.rounds,
        }))}
      />

      {/* byMember 仅企业管理员可见 —— 后端按角色决定是否返回这一段 */}
      {byMember && byMember.length > 0 && (
        <UsageBreakdown
          title="按成员"
          icon={MessageSquareText}
          rows={byMember.map((row) => ({
            key: row.userId,
            label: row.userName ?? '未知成员',
            rounds: row.rounds,
          }))}
          note="仅企业管理员可见"
        />
      )}

      {canManage && (
        <section className="rounded-glass-lg border border-glassline bg-glass-1">
          <button
            type="button"
            onClick={() => setShowExecutions((prev) => !prev)}
            aria-expanded={showExecutions}
            className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left"
          >
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-gtext-muted transition-transform',
                !showExecutions && '-rotate-90',
              )}
            />
            <span className="text-xs font-semibold text-gtext-primary">执行明细</span>
            <span className="text-[11px] text-gtext-muted">
              单次调用的输入输出与版本归属 · 仅企业管理员可见
            </span>
          </button>
          {showExecutions && (
            <div className="border-t border-glassline p-3.5">
              <ExecutionDetailPanel capabilityId={capabilityId} canManage={canManage} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function UsageBreakdown({
  title,
  icon: Icon,
  rows,
  note,
}: {
  title: string;
  icon: React.ElementType;
  rows: Array<{ key: string; label: string; rounds: number }>;
  note?: string;
}) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((row) => row.rounds), 1);
  const sorted = [...rows].sort((left, right) => right.rounds - left.rounds);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-gtext-muted">
          <Icon className="h-3 w-3" />
          {title}
        </p>
        {note && <span className="text-[10px] text-gtext-disabled">{note}</span>}
      </div>

      <div className="mt-2 space-y-1.5">
        {sorted.map((row) => (
          <div key={row.key} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-xs text-gtext-primary">{row.label}</span>
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-glass-pill bg-glass-3">
              <span
                className="block h-full rounded-glass-pill bg-gbrand transition-all duration-500"
                style={{ width: `${Math.max((row.rounds / max) * 100, 3)}%` }}
              />
            </div>
            <span className="w-16 shrink-0 text-right text-xs tabular-nums text-gtext-secondary">
              {row.rounds} 次
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
