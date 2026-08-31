'use client';

import { useEffect } from 'react';
import { Loader2, MessageSquareText, X } from 'lucide-react';
import { Markdown } from '@/features/chat/markdown';
import { cn } from '@/lib/utils';
import type { StepConversation } from '../use-task-execution';

const ROLE_LABEL = {
  USER: '交给员工的输入',
  ASSISTANT: '员工的回复',
  TOOL: '工具执行结果',
} as const;

const ROLE_STYLE = {
  USER: 'border-glassline bg-glass-2',
  ASSISTANT: 'border-glassline-brand bg-gbrand/[0.05]',
  TOOL: 'border-glassline bg-gbg-deep/40',
} as const;

export interface StepConversationDialogProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  data: StepConversation | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * 单步的完整对话。
 *
 * 会议要求「每一步结果均应可查看，不能只显示最终结果」。步骤卡片上给的是最终
 * 产出，这里给的是产生它的整段对话 —— 包括工具调用的中间结果。演示时被问到
 * 「它凭什么得出这个结论」，答案在这里。
 */
export function StepConversationDialog({
  open,
  loading,
  error,
  data,
  onOpenChange,
}: StepConversationDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-50 grid place-items-center bg-gbg-deep/60 px-4 backdrop-blur-glass-xs"
      onClick={() => onOpenChange(false)}
      role="presentation"
    >
      <section
        className="flex max-h-[min(82vh,44rem)] w-full max-w-3xl flex-col overflow-hidden rounded-glass-xl border border-glassline bg-gbg-raised shadow-glass-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="步骤完整对话"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-glassline px-5 py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-gtext-primary">
              <MessageSquareText className="h-4 w-4 text-gbrand-text" />
              这一步的完整对话
            </p>
            <p className="mt-1 truncate text-xs text-gtext-muted">
              {data
                ? `${data.step.employee.name} · ${data.step.title} · ${data.messages.length} 条消息`
                : '正在读取…'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-glass-md text-gtext-muted transition-colors hover:bg-glass-2 hover:text-gtext-primary"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scroll-thin">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-gtext-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在读取对话记录
            </div>
          )}

          {error && !loading && (
            <p className="rounded-glass-md border border-gdanger/25 bg-gdanger/[0.06] px-3 py-2 text-xs text-gdanger">
              {error}
            </p>
          )}

          {!loading && !error && data?.messages.length === 0 && (
            <p className="py-10 text-center text-xs text-gtext-muted">
              这一步还没有对话记录 —— 它可能还没开始执行。
            </p>
          )}

          <div className="space-y-3">
            {data?.messages.map((message) => (
              <div
                key={message.id}
                className={cn('rounded-glass-md border px-3 py-2.5', ROLE_STYLE[message.role])}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gtext-muted">
                    {ROLE_LABEL[message.role]}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-gtext-muted">
                    {new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}
                    {message.modelId ? ` · ${message.modelId}` : ''}
                  </span>
                </div>
                <div className="markdown-body mt-1.5 text-xs leading-5">
                  <Markdown content={message.content} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
