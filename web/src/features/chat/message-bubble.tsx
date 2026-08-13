'use client';

import { useState } from 'react';
import { Brain, ChevronRight, FileText } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Markdown } from './markdown';
import { ToolCallBlock } from './tool-call-block';
import { AttachmentDisplay } from './attachment-display';
import type { LiveToolCall } from './use-chat-stream';
import type {
  Message,
  MessageAttachment,
  ToolCallRecord,
  KnowledgeSource,
} from '@/lib/types';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls?: (LiveToolCall | ToolCallRecord)[] | null;
  knowledgeSources?: KnowledgeSource[] | null;
  attachments?: MessageAttachment[] | null;
  employeeName?: string | null;
  employeeAvatar?: string | null;
  streaming?: boolean;
}

export function MessageBubble({
  role,
  content,
  reasoning,
  toolCalls,
  knowledgeSources,
  attachments,
  employeeName,
  employeeAvatar,
  streaming,
}: MessageBubbleProps) {
  if (role === 'user') {
    const hasAttachments = !!attachments && attachments.length > 0;
    return (
      <div className="flex justify-end">
        <div
          className={cn(
            'max-w-[75%] space-y-2 rounded-2xl rounded-tr-sm bg-primary px-3 py-2.5 text-[15px] leading-relaxed text-primary-foreground',
            // 纯附件消息（content 为空）不需要文字行的左右内边距对齐
            hasAttachments && !content && 'py-2',
          )}
        >
          {hasAttachments && (
            <AttachmentDisplay attachments={attachments} onPrimary />
          )}
          {content && <div className="whitespace-pre-wrap px-1">{content}</div>}
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
        {knowledgeSources && knowledgeSources.length > 0 && (
          <KnowledgeSources sources={knowledgeSources} />
        )}
      </div>
    </div>
  );
}

function KnowledgeSources({ sources }: { sources: KnowledgeSource[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded-lg border border-border bg-muted/40 text-sm">
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
        <FileText className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
        <span className="font-medium text-fg-muted">参考来源 ({sources.length})</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border p-3">
          {sources.map((source, i) => (
            <div
              key={source.chunkId}
              className="rounded-lg border border-border bg-card p-3 text-xs"
            >
              <div className="mb-1.5 flex items-center gap-2">
                <Badge variant="glass-info" className="text-xs">
                  [{i + 1}]
                </Badge>
                <span className="font-medium text-fg-muted">{source.source}</span>
                <Badge
                  variant={
                    source.score >= 0.8
                      ? 'glass-success'
                      : source.score >= 0.6
                      ? 'glass-info'
                      : 'glass'
                  }
                  className="ml-auto text-xs"
                >
                  相似度: {(source.score * 100).toFixed(0)}%
                </Badge>
              </div>
              <p className="text-fg-subtle line-clamp-3">{source.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReasoningBlock({ text }: { text: string }) {  const [open, setOpen] = useState(false);
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
