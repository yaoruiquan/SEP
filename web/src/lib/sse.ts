import { API_BASE } from './api-client';
import { authAccessor } from './auth-store';
import type { MessageAttachment } from './types';

export interface SseEvent {
  event: string;
  data: unknown;
}

/**
 * 订阅任务执行事件流。
 *
 * 不用原生 `EventSource`：它不能带 Authorization 头，而后端 JwtStrategy 只从
 * Bearer 头取令牌（见 backend/src/modules/auth/jwt.strategy.ts）。所以这里和
 * 对话流一样用 fetch + 手工解帧。
 *
 * 服务端首帧一定是 `snapshot` 全量，之后是增量补丁 —— 因此中途连上（刷新页面、
 * 任务跑到一半才打开）不会丢内容。
 */
export async function* streamTaskExecution(
  taskRunId: string,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const token = authAccessor.getToken();
  const res = await fetch(`${API_BASE}/tasks/${taskRunId}/stream`, {
    method: 'GET',
    credentials: 'include',
    signal,
    headers: {
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!res.ok || !res.body) {
    let message = `连接执行流失败 (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  yield* readFrames(res.body);
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

  yield* readFrames(res.body);
}

/** 把响应体拆成 `event: <name>\ndata: <json>\n\n` 帧。对话流与任务执行流共用。 */
async function* readFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
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
