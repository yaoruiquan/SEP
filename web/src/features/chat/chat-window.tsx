'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { qk } from '@/lib/query-keys';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { MessageBubble } from './message-bubble';
import { InputBar } from './input-bar';
import { ModelSwitcher } from './model-switcher';
import { useChatStream, type SendOutcome } from './use-chat-stream';
import { useConversation } from './use-conversations';
import { useSubscribedEmployees } from './use-subscribed-employees';
import { useAuthStore } from '@/lib/auth-store';
import { useModelConfig } from '@/features/enterprise-settings/use-model-config';
import type { Message, MessageAttachment } from '@/lib/types';

interface ChatWindowProps {
  conversationId: string;
}

/** Local echo of a just-sent user message before the server round-trips. */
interface PendingUser {
  id: string;
  content: string;
  attachments?: MessageAttachment[];
}

export function ChatWindow({ conversationId }: ChatWindowProps) {
  const qc = useQueryClient();
  const { data: conversation, isLoading } = useConversation(conversationId);
  const { state, send, stop } = useChatStream();
  const [pendingUser, setPendingUser] = useState<PendingUser | null>(null);
  // 本轮流式回复的作者，用于让实时气泡显示正确的员工而非会话默认员工
  const [streamingAuthorId, setStreamingAuthorId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 企业模型策略：用于 ModelSwitcher 的白名单 + 锁定控制
  const enterprise = useAuthStore((s) => s.enterprise);
  const { data: modelConfig } = useModelConfig(enterprise?.id ?? '');

  // 多员工协作：加载用户订阅的所有员工
  const { data: subscribedEmployees = [] } = useSubscribedEmployees();

  const employee = conversation?.employee;
  const persisted: Message[] = conversation?.messages ?? [];

  // 会话默认员工排在首位，其余订阅员工去重跟在后面
  const employees = useMemo(() => {
    const list = employee
      ? [
          {
            id: employee.id,
            name: employee.name,
            avatar: employee.avatar ?? null,
            position: subscribedEmployees.find((s) => s.id === employee.id)?.position,
          },
        ]
      : [];
    for (const sub of subscribedEmployees) {
      if (sub.id !== employee?.id) {
        list.push({
          id: sub.id,
          name: sub.name,
          avatar: sub.avatar,
          position: sub.position,
        });
      }
    }
    return list;
  }, [employee, subscribedEmployees]);

  const employeeById = useMemo(
    () => new Map(employees.map((e) => [e.id, e])),
    [employees],
  );

  /** 消息的实际作者；handledBy 缺失时（旧数据）归属会话默认员工 */
  const authorOf = (m: Message) =>
    (m.metadata?.handledBy ? employeeById.get(m.metadata.handledBy) : undefined) ??
    employee;

  /** 本轮流式回复的作者；streamingAuthorId 未设置时归属会话默认员工 */
  const streamingAuthor =
    (streamingAuthorId ? employeeById.get(streamingAuthorId) : undefined) ?? employee;

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

  const handleSend = async (
    text: string,
    targetEmployeeId?: string,
    attachments?: MessageAttachment[],
  ): Promise<SendOutcome> => {
    setPendingUser({ id: `pending-${Date.now()}`, content: text, attachments });
    setStreamingAuthorId(targetEmployeeId ?? employee?.id ?? null);
    const outcome = await send(
      conversationId,
      text,
      targetEmployeeId,
      () => {
        // on completion, refetch canonical history (includes persisted tool calls)
        qc.invalidateQueries({ queryKey: qk.conversation(conversationId) });
        qc.invalidateQueries({ queryKey: qk.conversations });
        // 清空 pendingUser,避免重复显示
        setPendingUser(null);
      },
      attachments,
    );

    // 发送失败时这条消息没落库，乐观气泡必须撤掉 —— 留着的话界面上有条
    // 刷新就消失的假消息，正是"记录不见了"的观感来源。文字和附件由
    // InputBar 依据返回值还原，用户不用重新输入、重新上传。
    if (outcome === 'failed') {
      setPendingUser(null);
      setStreamingAuthorId(null);
    }

    return outcome;
  };

  const isEmpty = persisted.length === 0 && !pendingUser && !showLiveAssistant;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="z-10 flex flex-shrink-0 items-center gap-3 border-b border-border bg-white px-6 py-3">
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
            enterpriseId={enterprise?.id ?? ''}
            allowedChatModels={modelConfig?.allowedChatModels ?? []}
            canSwitch={modelConfig?.allowUserSwitchModel ?? true}
          />
        )}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scroll-thin">
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
              .filter((m) => m.role !== 'TOOL')
              .map((m) => {
                const author = authorOf(m);
                return (
                  <MessageBubble
                    key={m.id}
                    role={m.role.toLowerCase() as 'user' | 'assistant'}
                    content={m.content}
                    toolCalls={m.toolCalls}
                    knowledgeSources={m.knowledgeSources}
                    attachments={m.attachments}
                    employeeName={author?.name}
                    employeeAvatar={author?.avatar}
                  />
                );
              })}

            {pendingUser && (
              <MessageBubble
                role="user"
                content={pendingUser.content}
                attachments={pendingUser.attachments}
              />
            )}

            {showLiveAssistant && (
              <MessageBubble
                role="assistant"
                content={state.text}
                reasoning={state.reasoning}
                toolCalls={state.toolCalls}
                employeeName={streamingAuthor?.name}
                employeeAvatar={streamingAuthor?.avatar}
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

      <div className="z-20 flex-shrink-0 border-t bg-white">
        <InputBar
          onSend={handleSend}
          onStop={stop}
          streaming={state.streaming}
          defaultEmployeeId={employee?.id ?? ''}
          employees={employees}
        />
      </div>
    </div>
  );
}
