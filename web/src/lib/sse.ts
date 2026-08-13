import { API_BASE } from './api-client';
import { authAccessor } from './auth-store';
import type { MessageAttachment } from './types';

export interface SseEvent {
  event: string;
  data: unknown;
}

/**
 * POST a message to the conversation SSE endpoint and yield parsed events.
 * EventSource can't POST, so we stream the fetch body and parse the
 * `event: <name>\ndata: <json>\n\n` frames ourselves.
 */
export async function* streamMessage(
  sessionId: string,
  content: string,
  targetEmployeeId?: string, // 🆕 多员工协作：指定处理该消息的员工
  signal?: AbortSignal,
  // 🆕 多模态：文件已在选中时上传完毕，这里只传元数据记录
  attachments?: MessageAttachment[],
): AsyncGenerator<SseEvent> {
  const token = authAccessor.getToken();
  const res = await fetch(`${API_BASE}/conversations/${sessionId}/messages`, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      content,
      targetEmployeeId,
      // 后端 Zod 校验 attachments 为 `.optional()`，空数组也合法，
      // 但省略掉能让「纯文本消息」的请求体保持原样
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    }),
  });

  if (!res.ok || !res.body) {
    let msg = `发送失败 (${res.status})`;
    try {
      const j = await res.json();
      if (j?.message) msg = Array.isArray(j.message) ? j.message.join('; ') : j.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // frames are separated by a blank line
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const parsed = parseFrame(frame);
      if (parsed) yield parsed;
    }
  }
}

function parseFrame(frame: string): SseEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join('\n');
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    /* keep as string (text_delta / reasoning_delta may be raw strings) */
  }
  return { event, data };
}
