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

/**
 * 算力被拦下的详情。
 *
 * `blockedBy` 决定第二条出路：`ALLOWANCE` 是「你这周期花超了」——
 * 找管理员调额度；`BALANCE` 是「公司账上没钱了」—— 给企业钱包充值。
 * 两者都说成「余额不足」，成员会去催财务充值，而公司的钱其实是够的。
 */
export interface ComputeBlockedInfo {
  message: string;
  blockedBy: 'ALLOWANCE' | 'BALANCE';
  /** 成员个人余额（元，字符串）。被拦下时通常是 "0.00" */
  personalBalanceCNY: string;
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
  /**
   * 算力额度 / 余额把这条消息拦下了。非空即应弹窗 ——
   * 这是方案 §5.5 #3 的验收点：必须是**明确弹窗**，不能只在气泡下留一行红字。
   */
  blocked: ComputeBlockedInfo | null;
  /**
   * 非致命提示，最典型的是「本轮由你的个人余额支付」。
   * 与 error 分开：这一轮照常出结果，红字会让用户以为发失败了。
   */
  notice: string | null;
}

const EMPTY: StreamState = {
  text: '',
  reasoning: '',
  toolCalls: [],
  streaming: false,
  error: null,
  blocked: null,
  notice: null,
};

export interface DoneInfo {
  messageId?: string;
  text?: string;
  toolCalls: ToolCallRecord[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * 发送结果。调用方需要区分这三种情况才能决定输入框怎么处理：
 * - `ok`：正常收完流，清空输入框。
 * - `failed`：请求没建立或中途断了，消息大概率没落库 —— 必须把用户的
 *   文字和附件还回去，否则用户得重新打字、重新上传一遍。
 * - `aborted`：用户自己点了停止，消息已经发出去了，不能还原（会重复）。
 */
export type SendOutcome = 'ok' | 'failed' | 'aborted';

export function useChatStream() {
  const [state, setState] = useState<StreamState>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => setState(EMPTY), []);

  /** 关掉「额度用尽」弹窗。红字提示留在气泡区，不跟着一起清。 */
  const dismissBlocked = useCallback(
    () => setState((s) => ({ ...s, blocked: null })),
    [],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) => ({ ...s, streaming: false }));
  }, []);

  /**
   * Send a message and stream the assistant reply.
   * Resolves once the stream completes. onDone fires with final metadata.
   * 返回值见 {@link SendOutcome} —— 调用方靠它决定要不要还原输入框。
   */
  const send = useCallback(
    async (
      conversationId: string,
      content: string,
      targetEmployeeId?: string, // 🆕 多员工协作：指定处理该消息的员工
      onDone?: (info: DoneInfo) => void,
      attachments?: MessageAttachment[], // 🆕 多模态附件
    ): Promise<SendOutcome> => {
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ ...EMPTY, streaming: true });

      let doneInfo: DoneInfo = { toolCalls: [] };
      let finalText = '';
      // 闸门拦下时流会正常结束（没有 done 事件），不会走进 catch。
      // 不记这一笔就会返回 'ok'，乐观气泡留在界面上、输入框也被清空 ——
      // 用户得重新打一遍这条根本没发出去的消息。
      let blockedByCompute = false;

      try {
        for await (const e of streamMessage(
          conversationId,
          content,
          targetEmployeeId,
          controller.signal,
          attachments,
        )) {
          if (e.event === 'error' && isComputeBlocked(e.data)) {
            blockedByCompute = true;
          }
          applyEvent(e, setState, (info) => {
            doneInfo = info;
          }, (delta) => {
            finalText += delta;
          });
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          setState((s) => ({ ...s, streaming: false }));
          return 'aborted';
        }
        setState((s) => ({
          ...s,
          streaming: false,
          error: (err as Error).message || '连接中断',
        }));
        return 'failed';
      }

      abortRef.current = null;
      setState((s) => ({ ...s, streaming: false }));
      // 被算力闸门拦下等同于「这条没发出去」：不能触发 onDone（会去
      // refetch 历史并清掉输入框），要按 failed 处理，把文字还给用户。
      if (blockedByCompute) return 'failed';
      onDone?.({ ...doneInfo, text: finalText });
      return 'ok';
    },
    [],
  );

  return { state, send, stop, reset, dismissBlocked };
}

/** 后端 COMPUTE_BLOCKED 事件的判别。字段缺失时按「不是算力问题」处理。 */
function isComputeBlocked(data: unknown): boolean {
  return (
    !!data &&
    typeof data === 'object' &&
    (data as { code?: unknown }).code === 'COMPUTE_BLOCKED'
  );
}

function applyEvent(
  e: SseEvent,
  setState: React.Dispatch<React.SetStateAction<StreamState>>,
  captureDone: (info: DoneInfo) => void,
  captureText?: (delta: string) => void,
) {
  const d = e.data as Record<string, unknown> | string | null;
  switch (e.event) {
    case 'text_delta': {
      const delta = typeof d === 'string' ? d : ((d as any)?.text ?? '');
      captureText?.(delta);
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
    // 非致命提示：本轮照常出结果，只是有事要告诉用户
    // （目前只有一种：额度用尽，本轮改由个人余额支付）。
    case 'notice': {
      const message = (d as any)?.message;
      if (typeof message === 'string' && message) {
        setState((s) => ({ ...s, notice: message }));
      }
      break;
    }
    case 'error': {
      const message = (d as any)?.message ?? '生成失败';
      // 算力被拦下要弹窗，不能只留一行红字 —— 用户看不出下一步该做什么。
      // error 也一起设：弹窗关掉后气泡区仍需留下「这条没发出去」的痕迹。
      const blocked = isComputeBlocked(d)
        ? {
            message,
            blockedBy:
              (d as any)?.blockedBy === 'ALLOWANCE'
                ? ('ALLOWANCE' as const)
                : ('BALANCE' as const),
            personalBalanceCNY: String((d as any)?.personalBalanceCNY ?? '0.00'),
          }
        : null;
      setState((s) => ({
        ...s,
        streaming: false,
        error: message,
        blocked: blocked ?? s.blocked,
      }));
      break;
    }
    default:
      break;
  }
}
