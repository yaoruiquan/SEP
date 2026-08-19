'use client';

import { Check, ChevronRight, Clock, Loader2, Wrench, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { LiveToolCall } from './use-chat-stream';
import type { ToolCallRecord } from '@/lib/types';

interface ToolCallBlockProps {
  call: LiveToolCall | ToolCallRecord;
}

/** Normalize either a live streaming call or a persisted record into one shape. */
function normalize(call: LiveToolCall | ToolCallRecord) {
  return {
    name: call.name ?? '能力调用',
    capabilityId: call.capabilityId,
    success: call.success,
    durationMs: call.durationMs,
    running: 'status' in call ? call.status === 'running' : false,
    result: (call as ToolCallRecord).result,
    args: (call as ToolCallRecord).arguments,
  };
}

export function ToolCallBlock({ call }: ToolCallBlockProps) {
  const [open, setOpen] = useState(false);
  const c = normalize(call);
  const hasDetail = c.args !== undefined || c.result !== undefined;

  return (
    <div
      className={cn(
        'group relative my-2 overflow-hidden rounded-xl border-l-4 bg-card text-sm shadow-sm ring-1 ring-border transition-all',
        c.running
          ? 'border-l-primary bg-primary/5'
          : c.success === false
            ? 'border-l-danger bg-danger/5'
            : 'border-l-success bg-success/5',
        hasDetail && 'hover:shadow-md',
      )}
    >
      {/* 状态图标背景装饰 */}
      <div
        className={cn(
          'absolute right-0 top-0 h-full w-32 opacity-5 transition-opacity',
          c.running && 'bg-primary',
          c.success === false && 'bg-danger',
          c.success === true && 'bg-success',
        )}
        style={{
          clipPath: 'polygon(100% 0, 100% 100%, 0 100%)',
        }}
      />

      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        disabled={!hasDetail}
        className={cn(
          'relative flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
          hasDetail && 'cursor-pointer hover:bg-muted/50',
          !hasDetail && 'cursor-default',
        )}
      >
        {/* 工具图标 */}
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
            c.running && 'bg-primary/10',
            c.success === false && 'bg-danger/10',
            c.success === true && 'bg-success/10',
          )}
        >
          <Wrench
            className={cn(
              'h-4 w-4',
              c.running && 'text-primary',
              c.success === false && 'text-danger',
              c.success === true && 'text-success',
            )}
          />
        </div>

        {/* 工具信息 */}
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-fg-muted">工具调用</span>
            <code className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-semibold text-primary">
              {c.name}
            </code>
          </div>
          {c.capabilityId && (
            <p className="text-xs text-fg-subtle">ID: {c.capabilityId}</p>
          )}
        </div>

        {/* 状态标识 */}
        <div className="flex shrink-0 items-center gap-2">
          {c.running ? (
            <div className="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-xs font-medium text-primary">执行中</span>
            </div>
          ) : c.success === false ? (
            <div className="flex items-center gap-2 rounded-full bg-danger/10 px-3 py-1.5">
              <X className="h-4 w-4 text-danger" />
              <span className="text-xs font-medium text-danger">失败</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-full bg-success/10 px-3 py-1.5">
              <Check className="h-4 w-4 text-success" />
              <span className="text-xs font-medium text-success">完成</span>
              {typeof c.durationMs === 'number' && (
                <>
                  <div className="h-3 w-px bg-success/30" />
                  <Clock className="h-3 w-3 text-success/70" />
                  <span className="text-xs text-success/90">
                    {(c.durationMs / 1000).toFixed(1)}s
                  </span>
                </>
              )}
            </div>
          )}

          {/* 展开指示器 */}
          {hasDetail && (
            <ChevronRight
              className={cn(
                'h-4 w-4 text-fg-subtle transition-transform',
                open && 'rotate-90',
              )}
            />
          )}
        </div>
      </button>

      {/* 详情面板 */}
      {open && hasDetail && (
        <div className="space-y-3 border-t border-border bg-muted/30 px-4 py-3">
          {c.args !== undefined && (
            <DetailBlock label="调用参数" value={c.args} />
          )}
          {c.result !== undefined && (
            <DetailBlock label="执行结果" value={c.result} />
          )}
        </div>
      )}
    </div>
  );
}

function DetailBlock({ label, value }: { label: string; value: unknown }) {
  const text =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="h-1 w-1 rounded-full bg-primary" />
        <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          {label}
        </p>
      </div>
      <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed text-foreground scroll-thin">
        {text}
      </pre>
    </div>
  );
}
