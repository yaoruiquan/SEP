/**
 * SSE 事件类型定义
 */
export interface SseEvent {
  event:
    | 'reasoning_delta'
    | 'text_delta'
    | 'tool_start'
    | 'tool_end'
    | 'done'
    // 非致命提示：本轮对话照常进行，只是有事要告诉用户（例如额度用尽后
    // 改由个人余额支付）。与 error 分开 —— 前端的 error 分支会中止本轮渲染。
    | 'notice'
    | 'error';
  data: unknown;
}

/**
 * 工具调用信息（存储在 Message.toolCalls）
 */
export interface StoredToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * 工具结果信息（存储在 TOOL 角色的 Message.content）
 */
export interface StoredToolResult {
  toolCallId: string;
  toolName: string;
  result: string;
}

/**
 * AI SDK v7 ModelMessage 类型（简化版）
 */
export type ModelMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | AssistantMessageContent[] }
  | { role: 'tool'; content: ToolResultContent[] };

export interface AssistantMessageContent {
  type: 'text' | 'tool-call';
  text?: string;
  toolCallId?: string;
  toolName?: string;
  /** AI SDK v7 用 `input`（v4 是 `args`），字段名不符会被 ModelMessage schema 拒绝。 */
  input?: Record<string, unknown>;
}

/**
 * AI SDK v7 的 tool-result 结构：结果包在 `output: { type, value }` 里，
 * 不再是 v4 的裸 `result` 字符串。
 */
export interface ToolResultContent {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output: { type: 'text'; value: string } | { type: 'error-text'; value: string };
}
