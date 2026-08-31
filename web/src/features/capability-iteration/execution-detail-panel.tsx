'use client';

import { useState } from 'react';
import { ChevronDown, CircleAlert, CircleCheck, Lock, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCapabilityExecutions, type ExecutionDetail } from './use-capability-iteration';

/**
 * 执行明细。
 *
 * 会议要求「输入了什么、输出了什么」可查。这是决策 2 里权限最敏感的一块 ——
 * 含成员的真实输入内容，所以后端只对 ENTERPRISE_ADMIN 开放，前端也按 canManage
 * 决定要不要发请求（避免普通成员触发一次必然 403 的调用）。
 */
export function ExecutionDetailPanel({
  capabilityId,
  canManage,
}: {
  capabilityId: string;
  canManage: boolean;
}) {
  const { data, isLoading, isError } = useCapabilityExecutions(capabilityId, canManage);
  const [expandedId, setExpandedId] = useState<string>();

  if (!canManage) {
    return (
      <div className="rounded-glass-lg border border-glassline bg-glass-1 px-4 py-10 text-center">
        <Lock className="mx-auto h-5 w-5 text-gtext-disabled" />
        <p className="mt-2.5 text-sm font-medium text-gtext-secondary">执行明细仅企业管理员可见</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-gtext-muted">
          明细包含成员的对话输入内容，因此权限收紧到企业管理员。
        </p>
      </div>
    );
  }

  if (isLoading) {
    return <div className="h-40 animate-pulse rounded-glass-lg border border-glassline bg-glass-1" />;
  }

  if (isError || !data) {
    return (
      <p className="rounded-glass-lg border border-gdanger/25 bg-gdanger/[0.06] px-4 py-6 text-center text-xs text-gdanger">
        执行明细加载失败
      </p>
    );
  }

  if (data.items.length === 0) {
    return (
      <p className="rounded-glass-lg border border-dashed border-glassline bg-glass-1 px-4 py-10 text-center text-xs text-gtext-muted">
        还没有执行记录
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {data.items.map((execution) => {
        const expanded = expandedId === execution.id;
        const failed = execution.status === 'FAILED';

        return (
          <div
            key={execution.id}
            className={cn(
              'rounded-glass-lg border transition-colors',
              failed ? 'border-gdanger/25 bg-gdanger/[0.04]' : 'border-glassline bg-glass-1',
            )}
          >
            <button
              type="button"
              onClick={() => setExpandedId(expanded ? undefined : execution.id)}
              aria-expanded={expanded}
              className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left"
            >
              {failed ? (
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-gdanger" />
              ) : (
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-gsuccess" />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                  <span className="font-medium text-gtext-primary">
                    {execution.userName ?? '未知成员'}
                  </span>
                  {/* 版本归属：这次产出是哪个版本做的 —— B2 打通后才有意义的一列 */}
                  {execution.versionScope ? (
                    <span
                      className={cn(
                        'rounded-glass-pill border px-1.5 py-0.5 text-[10px]',
                        execution.versionScope === 'ENTERPRISE'
                          ? 'border-glassline-brand bg-gbrand/10 text-gbrand-text'
                          : 'border-glassline bg-glass-2 text-gtext-secondary',
                      )}
                    >
                      {execution.versionScope === 'ENTERPRISE' ? '企业版' : '平台版'}
                    </span>
                  ) : (
                    <span className="rounded-glass-pill border border-glassline bg-glass-2 px-1.5 py-0.5 text-[10px] text-gtext-disabled">
                      未记录版本
                    </span>
                  )}
                  {execution.duration !== null && (
                    <span className="inline-flex items-center gap-0.5 tabular-nums text-gtext-muted">
                      <Timer className="h-2.5 w-2.5" />
                      {formatDuration(execution.duration)}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 tabular-nums text-[11px] text-gtext-muted">
                    {new Date(execution.createdAt).toLocaleString('zh-CN', { hour12: false })}
                  </span>
                </div>

                <p className="mt-1 line-clamp-1 text-[11px] text-gtext-muted">
                  {preview(execution.input)}
                </p>
              </div>

              <ChevronDown
                className={cn(
                  'mt-0.5 h-3.5 w-3.5 shrink-0 text-gtext-muted transition-transform',
                  expanded && 'rotate-180',
                )}
              />
            </button>

            {expanded && (
              <div className="space-y-2.5 border-t border-glassline px-3.5 py-3">
                <Block title="输入" body={format(execution.input)} />
                {execution.errorMessage ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gdanger">
                      错误
                    </p>
                    <p className="mt-1 rounded-glass-md border border-gdanger/25 bg-gdanger/[0.06] px-2.5 py-2 text-[11px] leading-5 text-gdanger">
                      {execution.errorMessage}
                    </p>
                  </div>
                ) : (
                  <Block title="输出" body={format(execution.output)} />
                )}
              </div>
            )}
          </div>
        );
      })}

      {data.nextCursor && (
        <p className="pt-1 text-center text-[11px] text-gtext-muted">
          仅显示最近 30 条记录
        </p>
      )}
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gtext-muted">{title}</p>
      <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-glass-md border border-glassline bg-gbg-deep/40 px-2.5 py-2 text-[11px] leading-5 text-gtext-secondary scroll-thin">
        {body}
      </pre>
    </div>
  );
}

/** 输入输出是 Json 列，形状不固定 —— 字符串直接显示，其余序列化 */
function format(value: unknown): string {
  if (value === null || value === undefined) return '（空）';
  if (typeof value === 'string') return value;
  // { text: '…' } 是工具结果的常见形状，直接取出正文比展示一层包裹更有用
  if (typeof value === 'object' && 'text' in (value as Record<string, unknown>)) {
    const text = (value as Record<string, unknown>).text;
    if (typeof text === 'string') return text;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function preview(value: unknown): string {
  return format(value).replace(/\s+/g, ' ').slice(0, 120);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
