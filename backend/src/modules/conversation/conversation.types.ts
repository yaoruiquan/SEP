/**
 * SSE 事件类型定义
 */
export interface SseEvent {
  event: 'reasoning_delta' | 'text_delta' | 'tool_start' | 'tool_end' | 'done' | 'error';
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
  args?: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  result: string;
}
