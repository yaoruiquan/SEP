'use client';

import { Check, ChevronRight, Loader2, Wrench, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { LiveToolCall } from './use-chat-stream';
import type { ToolCallRecord } from '@/lib/types';

interface ToolCallBlockProps {
  call: LiveToolCall | ToolCallRecord;
}

/** Normalize either a live streaming call or a persisted record into one shape. */
function normalize(call: LiveToolCall | ToolCallRecord) {
  const status =
    'status' in call && call.status
      ? call.status
      : call.success === undefined
        ? 'done'
        : 'done';
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
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-muted/50 text-sm">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left',
          hasDetail && 'hover:bg-muted',
        )}
      >
        {hasDetail ? (
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-fg-subtle transition-transform',
              open && 'rotate-90',
            )}
          />
        ) : (
          <Wrench className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
        )}
        <span className="font-medium text-foreground">调用能力</span>
        <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[12px] text-primary">
          {c.name}
        </code>
        <span className="ml-auto flex items-center gap-1.5 text-xs">
          {c.running ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="text-fg-muted">执行中</span>
            </>
          ) : c.success === false ? (
            <>
              <X className="h-3.5 w-3.5 text-danger" />
              <span className="text-danger">失败</span>
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5 text-success" />
              <span className="text-fg-muted">
                完成
                {typeof c.durationMs === 'number' && ` · ${(c.durationMs / 1000).toFixed(1)}s`}
              </span>
            </>
          )}
        </span>
      </button>
      {open && hasDetail && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          {c.args !== undefined && (
            <DetailBlock label="入参" value={c.args} />
          )}
          {c.result !== undefined && (
            <DetailBlock label="结果" value={c.result} />
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
    <div>
      <p className="mb-1 text-xs font-medium text-fg-subtle">{label}</p>
      <pre className="max-h-48 overflow-auto rounded bg-background p-2 text-[12px] leading-relaxed scroll-thin">
        {text}
      </pre>
    </div>
  );
}
