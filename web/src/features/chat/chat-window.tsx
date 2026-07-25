'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { qk } from '@/lib/query-keys';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { MessageBubble } from './message-bubble';
import { InputBar } from './input-bar';
import { ModelSwitcher } from './model-switcher';
import { useChatStream } from './use-chat-stream';
import { useConversation } from './use-conversations';
import type { Message } from '@/lib/types';

interface ChatWindowProps {
  conversationId: string;
}

/** Local echo of a just-sent user message before the server round-trips. */
interface PendingUser {
  id: string;
  content: string;
}

export function ChatWindow({ conversationId }: ChatWindowProps) {
  const qc = useQueryClient();
  const { data: conversation, isLoading } = useConversation(conversationId);
  const { state, send, stop } = useChatStream();
  const [pendingUser, setPendingUser] = useState<PendingUser | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const employee = conversation?.employee;
  const persisted: Message[] = conversation?.messages ?? [];

  // clear the optimistic bubble + local stream once the refetched history includes it
  useEffect(() => {
    if (!state.streaming && pendingUser) {
      setPendingUser(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persisted.length]);

  const showLiveAssistant =
    state.streaming || !!state.text || !!state.error || state.toolCalls.length > 0;

  // auto-scroll to bottom on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [persisted.length, state.text, state.reasoning, state.toolCalls, pendingUser]);

  const handleSend = (text: string) => {
    setPendingUser({ id: `pending-${Date.now()}`, content: text });
    send(conversationId, text, () => {
      // on completion, refetch canonical history (includes persisted tool calls)
      qc.invalidateQueries({ queryKey: qk.conversation(conversationId) });
      qc.invalidateQueries({ queryKey: qk.conversations });
      // 清空 pendingUser,避免重复显示
      setPendingUser(null);
    });
  };

  const isEmpty = persisted.length === 0 && !pendingUser && !showLiveAssistant;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3">
        <Bot className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-foreground">
            {employee?.name ?? '对话'}
          </h2>
          {conversation?.title && (
            <p className="text-xs text-fg-subtle">{conversation.title}</p>
          )}
        </div>
        {conversation && (
          <ModelSwitcher
            conversationId={conversationId}
            currentModelId={conversation.modelId ?? null}
            employeeModelId={employee?.modelId}
          />
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin">
        {isLoading ? (
          <CenteredSpinner label="加载会话…" />
        ) : isEmpty ? (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState
              icon={<Bot className="h-8 w-8" />}
              title={`开始和 ${employee?.name ?? '碳基员工'} 对话`}
              description="输入你的问题，看它如何调用硅基能力完成任务。"
            />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
            {persisted
              .filter((m) => m.role !== 'tool')
              .map((m) => (
                <MessageBubble
                  key={m.id}
                  role={m.role as 'user' | 'assistant'}
                  content={m.content}
                  toolCalls={m.toolCalls}
                  employeeName={employee?.name}
                  employeeAvatar={employee?.avatar}
                />
              ))}

            {pendingUser && (
              <MessageBubble role="user" content={pendingUser.content} />
            )}

            {showLiveAssistant && (
              <MessageBubble
                role="assistant"
                content={state.text}
                reasoning={state.reasoning}
                toolCalls={state.toolCalls}
                employeeName={employee?.name}
                employeeAvatar={employee?.avatar}
                streaming={state.streaming}
              />
            )}

            {state.error && (
              <p className="rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
                {state.error}
              </p>
            )}
          </div>
        )}
      </div>

      <InputBar
        onSend={handleSend}
        onStop={stop}
        streaming={state.streaming}
      />
    </div>
  );
}
