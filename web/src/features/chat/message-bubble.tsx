'use client';

import { useState } from 'react';
import { Brain, ChevronRight } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { Markdown } from './markdown';
import { ToolCallBlock } from './tool-call-block';
import type { LiveToolCall } from './use-chat-stream';
import type { Message, ToolCallRecord } from '@/lib/types';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls?: (LiveToolCall | ToolCallRecord)[] | null;
  employeeName?: string | null;
  employeeAvatar?: string | null;
  streaming?: boolean;
}

export function MessageBubble({
  role,
  content,
  reasoning,
  toolCalls,
  employeeName,
  employeeAvatar,
  streaming,
}: MessageBubbleProps) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-[15px] leading-relaxed text-primary-foreground">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <Avatar
        name={employeeName ?? 'AI'}
        src={employeeAvatar ?? undefined}
        className="mt-0.5 h-8 w-8 shrink-0 text-sm"
      />
      <div className="min-w-0 flex-1 space-y-1">
        {employeeName && (
          <p className="text-xs font-medium text-fg-muted">{employeeName}</p>
        )}
        {reasoning && <ReasoningBlock text={reasoning} />}
        {toolCalls?.map((tc, i) => (
          <ToolCallBlock key={i} call={tc} />
        ))}
        {content ? (
          <Markdown content={content} />
        ) : streaming && !reasoning && !toolCalls?.length ? (
          <TypingDots />
        ) : null}
        {streaming && content && <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-fg-muted align-middle" />}
      </div>
    </div>
  );
}

function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-muted/40 text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-fg-subtle transition-transform',
            open && 'rotate-90',
          )}
        />
        <Brain className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
        <span className="font-medium text-fg-muted">思考过程</span>
      </button>
      {open && (
        <div className="whitespace-pre-wrap border-t border-border px-3 py-2 text-[13px] leading-relaxed text-fg-muted">
          {text}
        </div>
      )}
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-2 w-2 animate-bounce rounded-full bg-fg-subtle"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}
