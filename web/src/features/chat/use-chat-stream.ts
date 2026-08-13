'use client';

import { useCallback, useRef, useState } from 'react';
import { streamMessage, type SseEvent } from '@/lib/sse';
import type { MessageAttachment, ToolCallRecord } from '@/lib/types';

/** A live tool invocation surfaced during streaming. */
export interface LiveToolCall {
  name: string;
  capabilityId?: string;
  success?: boolean;
  durationMs?: number;
  status: 'running' | 'done';
}

export interface StreamState {
  /** assistant text accumulated so far */
  text: string;
  /** chain-of-thought / reasoning accumulated so far */
  reasoning: string;
  /** tool calls surfaced in order */
  toolCalls: LiveToolCall[];
  streaming: boolean;
  error: string | null;
}

const EMPTY: StreamState = {
  text: '',
  reasoning: '',
  toolCalls: [],
  streaming: false,
  error: null,
};

export interface DoneInfo {
  messageId?: string;
  toolCalls: ToolCallRecord[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export function useChatStream() {
  const [state, setState] = useState<StreamState>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => setState(EMPTY), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) => ({ ...s, streaming: false }));
  }, []);

  /**
   * Send a message and stream the assistant reply.
   * Resolves once the stream completes. onDone fires with final metadata.
   */
  const send = useCallback(
    async (
      conversationId: string,
      content: string,
      targetEmployeeId?: string, // 🆕 多员工协作：指定处理该消息的员工
      onDone?: (info: DoneInfo) => void,
      attachments?: MessageAttachment[], // 🆕 多模态附件
    ): Promise<void> => {
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ ...EMPTY, streaming: true });

      let doneInfo: DoneInfo = { toolCalls: [] };

      try {
        for await (const e of streamMessage(
          conversationId,
          content,
          targetEmployeeId,
          controller.signal,
          attachments,
        )) {
          applyEvent(e, setState, (info) => {
            doneInfo = info;
          });
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          setState((s) => ({ ...s, streaming: false }));
          return;
        }
        setState((s) => ({
          ...s,
          streaming: false,
          error: (err as Error).message || '连接中断',
        }));
        return;
      }

      abortRef.current = null;
      setState((s) => ({ ...s, streaming: false }));
      onDone?.(doneInfo);
    },
    [],
  );

  return { state, send, stop, reset };
}

function applyEvent(
  e: SseEvent,
  setState: React.Dispatch<React.SetStateAction<StreamState>>,
  captureDone: (info: DoneInfo) => void,
) {
  const d = e.data as Record<string, unknown> | string | null;
  switch (e.event) {
    case 'text_delta': {
      const delta = typeof d === 'string' ? d : ((d as any)?.text ?? '');
      setState((s) => ({ ...s, text: s.text + delta }));
      break;
    }
    case 'reasoning_delta': {
      const delta = typeof d === 'string' ? d : ((d as any)?.text ?? '');
      setState((s) => ({ ...s, reasoning: s.reasoning + delta }));
      break;
    }
    case 'tool_start': {
      const name = (d as any)?.name ?? 'tool';
      const capabilityId = (d as any)?.capabilityId;
      setState((s) => ({
        ...s,
        toolCalls: [...s.toolCalls, { name, capabilityId, status: 'running' }],
      }));
      break;
    }
    case 'tool_end': {
      const name = (d as any)?.name;
      const success = (d as any)?.success;
      const durationMs = (d as any)?.durationMs;
      setState((s) => {
        const next = [...s.toolCalls];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].status === 'running' && (!name || next[i].name === name)) {
            next[i] = { ...next[i], status: 'done', success, durationMs };
            break;
          }
        }
        return { ...s, toolCalls: next };
      });
      break;
    }
    case 'done': {
      const tc = (d as any)?.toolCalls;
      const messageId = (d as any)?.messageId;
      const usage = (d as any)?.usage;  // 🔴 修复 P1-2: 读取 usage
      captureDone({ messageId, toolCalls: Array.isArray(tc) ? tc : [], usage });
      break;
    }
    case 'error': {
      const message = (d as any)?.message ?? '生成失败';
      setState((s) => ({ ...s, streaming: false, error: message }));
      break;
    }
    default:
      break;
  }
}
