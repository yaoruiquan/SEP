import {
  BadGatewayException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatCompletionUsage } from 'shared';
import { validGatewayUsage } from './gateway-response';

export function timeoutValue(
  config: ConfigService,
  name: string,
  fallback: number,
): number {
  const raw = config.get<string | number>(name) ?? fallback;
  const value =
    typeof raw === 'number' || /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) {
    throw new InternalServerErrorException(
      `${name} must be an integer between 1 and 2147483647`,
    );
  }
  return value;
}

/** Owns the fetch and body time budgets until EOF, cancellation, or failure. */
export function createGatewayStreamLifecycle(
  config: ConfigService,
  clientSignal?: AbortSignal,
  mode: 'stream' | 'json' = 'stream',
) {
  const jsonMs = mode === 'json' ? timeoutValue(config, 'GATEWAY_NON_STREAM_TIMEOUT_MS', 120000) : undefined;
  const headerMs = jsonMs ?? timeoutValue(
    config,
    'GATEWAY_STREAM_HEADER_TIMEOUT_MS',
    120000,
  );
  const idleMs = jsonMs ?? timeoutValue(config, 'GATEWAY_STREAM_IDLE_TIMEOUT_MS', 120000);
  const totalMs = jsonMs ?? timeoutValue(
    config,
    'GATEWAY_STREAM_TOTAL_TIMEOUT_MS',
    600000,
  );
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout>;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let output: ReadableStreamDefaultController<Uint8Array> | undefined;
  let settled = false;

  function cleanup() {
    settled = true;
    clearTimeout(headerTimer);
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    clientSignal?.removeEventListener('abort', cancelClient);
  }
  function abort(reason: unknown) {
    if (settled) return;
    cleanup();
    controller.abort(reason);
    output?.error(reason);
    void reader?.cancel(reason).catch(() => undefined);
  }
  function timeout(code: string) {
    abort(
      new BadGatewayException({
        error: {
          message: 'sub2api 请求超时',
          type: 'api_error',
          code,
          param: null,
        },
      }),
    );
  }
  function cancelClient() {
    abort(
      new BadGatewayException({
        error: {
          message: '客户端已断开连接',
          type: 'api_error',
          code: 'CLIENT_DISCONNECTED',
          param: null,
        },
      }),
    );
  }
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => timeout('UPSTREAM_STREAM_IDLE_TIMEOUT'),
      idleMs,
    );
  }

  const headerTimer = setTimeout(
    () => timeout('UPSTREAM_STREAM_HEADER_TIMEOUT'),
    headerMs,
  );
  const totalTimer = setTimeout(
    () => timeout('UPSTREAM_STREAM_TOTAL_TIMEOUT'),
    totalMs,
  );
  clientSignal?.addEventListener('abort', cancelClient, { once: true });
  if (clientSignal?.aborted) cancelClient();

  return {
    signal: controller.signal,
    cleanup,
    wrap(response: Response): Response {
      clearTimeout(headerTimer);
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => undefined);
        throw controller.signal.reason;
      }
      if (!response.body) {
        cleanup();
        return response;
      }
      reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          output = streamController;
        },
        async pull(streamController) {
          try {
            // Backpressure is not upstream silence; only budget outstanding reads.
            resetIdle();
            while (!settled) {
              const { done, value } = await reader!.read();
              if (settled) return;
              if (done) {
                cleanup();
                streamController.close();
                return;
              }
              if (value.byteLength) {
                clearTimeout(idleTimer);
                streamController.enqueue(value);
                return;
              }
            }
          } catch (error) {
            abort(error);
          }
        },
        async cancel(reason) {
          cleanup();
          controller.abort(reason);
          await reader!.cancel(reason).catch(() => undefined);
        },
      });
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  };
}

/** Observes SSE for accounting and diagnostics without rewriting any wire bytes. */
export function createChatCompletionStreamObserver() {
  const decoder = new TextDecoder();
  const maxEventLength = 1024 * 1024;
  const maxEventLines = 4096;
  let buffer = '';
  let data: string[] = [];
  let eventLength = 0;
  let eventLines = 0;
  let oversized = false;
  let oversizedLine = false;
  let usage: ChatCompletionUsage | null = null;
  let finishReason: string | null = null;
  let done = false;
  let protocolError = false;
  let finished = false;

  function dispatch(complete = true) {
    if (!oversized && data.length) {
      const payload = data.join('\n');
      if (payload.trim() === '[DONE]') { if (complete) done = true; }
      else {
        try {
          const json = JSON.parse(payload);
          const candidate = validGatewayUsage(json.usage);
          if (candidate) usage = candidate;
          if (json.error) protocolError = true;
          const reason = json.choices?.[0]?.finish_reason;
          if (complete && typeof reason === 'string' && reason) finishReason = reason.slice(0, 100);
        } catch {
          /* Non-JSON events remain untouched on the wire. */
        }
      }
    }
    data = [];
    eventLength = 0;
    eventLines = 0;
    oversized = false;
  }
  function line(value: string) {
    if (!value) {
      dispatch();
      return;
    }
    if (oversized) return;
    // Include framing and per-line overhead, including empty data fields.
    eventLength += Buffer.byteLength(value, 'utf8') + 2;
    eventLines += 1;
    if (eventLength > maxEventLength || eventLines > maxEventLines) {
      oversized = true;
      data = [];
    } else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
  }
  function parse(final = false) {
    let match: RegExpExecArray | null;
    while ((match = /\r\n|\r|\n/.exec(buffer))) {
      if (!final && match[0] === '\r' && match.index === buffer.length - 1)
        break;
      const value = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      if (oversizedLine) {
        oversizedLine = false;
        oversized = true;
      } else line(value);
    }
    if (Buffer.byteLength(buffer, 'utf8') > maxEventLength) {
      buffer = '';
      oversizedLine = true;
    }
    if (final) {
      if (!oversizedLine && buffer) line(buffer);
      buffer = '';
      // An EOF tail can carry accounting data, but is not a dispatched SSE event.
      dispatch(false);
    }
  }
  return {
    write(chunk: Uint8Array) {
      buffer += decoder.decode(chunk, { stream: true });
      parse();
    },
    snapshot() { return { usage, finishReason, done, protocolError }; },
    finish() {
      if (!finished) {
        buffer += decoder.decode();
        parse(true);
        finished = true;
      }
      return { usage, finishReason, done, protocolError };
    },
  };
}
