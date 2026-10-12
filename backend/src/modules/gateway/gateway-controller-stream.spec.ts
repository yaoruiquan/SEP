import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response as ExpressResponse } from 'express';
import { Writable } from 'node:stream';
import type { ChatCompletionRequest } from 'shared';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';

class StreamResponse extends Writable {
  readonly chunks: Buffer[] = [];
  readonly headers = new Map<string, string>();
  headersSent = false;
  onChunk?: () => void;

  constructor(private readonly delayWrites = false) {
    super({ highWaterMark: 1 });
    // pipeline errors are asserted through the response state, not unhandled events.
    this.on('error', () => undefined);
  }

  setHeader(name: string, value: string) {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  flushHeaders() { this.headersSent = true; }

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    this.onChunk?.();
    if (this.delayWrites) setImmediate(callback);
    else callback();
  }

  get bytes() { return Buffer.concat(this.chunks); }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };
const requestId = 'controller-stream-request-123';
const claims: ClientEmploymentClaims = {
  sub: 'user-1', enterpriseId: 'enterprise-1', subscriptionId: 'subscription-1',
  memberId: 'member-1', type: 'client-employment', iat: 1, exp: 9999999999,
};
const dto: ChatCompletionRequest = {
  model: 'test-model', messages: [{ role: 'user', content: 'synthetic' }], stream: true,
};
const finish = 'data:{"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\n';
const usageEvent = `data:${JSON.stringify({ choices: [], usage })}`;
const content = 'data:{"choices":[{"delta":{"content":"中文分片"},"finish_reason":null}]}\r\n\r\n';

describe('GatewayController raw SSE streaming', () => {
  let controller: GatewayController;
  let forward: jest.SpyInstance;
  let chargeUsage: jest.Mock;
  let recordTransaction: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    chargeUsage = jest.fn().mockResolvedValue({ usageRecordId: 'usage-1', alreadyCharged: false });
    const service = new GatewayService(
      {} as never, new ConfigService(), {} as never, { chargeUsage } as never,
    );
    jest.spyOn(service, 'validateAndAuthorize').mockResolvedValue({
      enterpriseId: claims.enterpriseId, subscriptionId: claims.subscriptionId,
      memberId: claims.memberId, employeeId: 'employee-1', allowedModels: [dto.model],
    });
    forward = jest.spyOn(service, 'forwardChatCompletion');
    recordTransaction = jest.spyOn(service, 'recordTransaction');
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    controller = new GatewayController(service);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  function invoke(res: StreamResponse) {
    return controller.chatCompletions(
      dto, claims,
      { 'x-sep-session-id': 'session-1', 'x-sep-message-id': 'message-1' },
      { requestId } as Request & { requestId: string },
      res as unknown as ExpressResponse,
    );
  }

  function respondWithBytes(raw: Buffer, oneByteChunks = false) {
    forward.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(source) {
        if (oneByteChunks) {
          for (const byte of raw) source.enqueue(Uint8Array.of(byte));
        } else source.enqueue(raw);
        source.close();
      },
    })));
  }

  async function expectSingleLedgerEntry() {
    await turn();
    await turn();
    expect(recordTransaction).toHaveBeenCalledTimes(1);
    expect(recordTransaction).toHaveBeenCalledWith({
      enterpriseId: claims.enterpriseId, subscriptionId: claims.subscriptionId,
      memberId: claims.memberId, employeeId: 'employee-1', userId: claims.sub,
      sessionId: 'session-1', messageId: 'message-1', modelId: dto.model, usage,
    });
    expect(chargeUsage).toHaveBeenCalledTimes(1);
    expect(chargeUsage).toHaveBeenCalledWith({
      enterpriseId: claims.enterpriseId, subscriptionId: claims.subscriptionId,
      employeeId: 'employee-1', userId: claims.sub, sessionId: 'session-1',
      messageId: 'message-1', modelId: dto.model, inputTokens: 11, outputTokens: 7,
    });
  }

  it('preserves no-space data fields, CRLF, split UTF-8 and an EOF tail byte-for-byte', async () => {
    const raw = Buffer.from(`: keepalive\r\n\r\n${content}${finish}${usageEvent}\r\n\r\ndata:[DONE]`);
    respondWithBytes(raw, true);
    const res = new StreamResponse();
    await invoke(res);
    expect(res.bytes).toEqual(raw);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.writableFinished).toBe(true);
    await expectSingleLedgerEntry();
  });

  it('records usage from a final unterminated data field without inventing DONE', async () => {
    const raw = Buffer.from(`${content}${finish}${usageEvent}`);
    respondWithBytes(raw, true);
    const res = new StreamResponse();
    await invoke(res);
    expect(res.bytes).toEqual(raw);
    expect(res.bytes.toString()).not.toContain('[DONE]');
    await expectSingleLedgerEntry();
  });

  it('records duplicate usage frames only once', async () => {
    const raw = Buffer.from(`${finish}${usageEvent}\n\n${usageEvent}\n\ndata:[DONE]\n\n`);
    respondWithBytes(raw);
    const res = new StreamResponse();
    await invoke(res);
    expect(res.bytes).toEqual(raw);
    await expectSingleLedgerEntry();
  });

  it('only warns for normal EOF without finish and never synthesizes finish or DONE', async () => {
    const raw = Buffer.from(`${content}${usageEvent}`);
    respondWithBytes(raw, true);
    const res = new StreamResponse();
    await invoke(res);
    expect(res.bytes).toEqual(raw);
    expect(res.writableFinished).toBe(true);
    expect(res.bytes.toString()).not.toContain('[DONE]');
    expect(res.bytes.toString()).not.toContain('"finish_reason":"stop"');
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).toContain(requestId);
    expect(error).not.toHaveBeenCalled();
    await expectSingleLedgerEntry();
  });

  it('waits for a backpressured Writable to finish all raw bytes', async () => {
    const raw = Buffer.from(`${content}${finish}${usageEvent}\n\ndata:[DONE]\n\n`);
    respondWithBytes(raw, true);
    const res = new StreamResponse(true);
    const write = jest.spyOn(res, 'write');
    await invoke(res);
    expect(write.mock.results.some((result) => result.value === false)).toBe(true);
    expect(res.writableFinished).toBe(true);
    expect(res.bytes).toEqual(raw);
    await expectSingleLedgerEntry();
  });

  it('destroys the response on upstream read failure instead of a successful end and logs requestId', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    forward.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(value) { source = value; },
    })));
    const res = new StreamResponse();
    const wrote = deferred<void>();
    res.onChunk = () => wrote.resolve();
    const end = jest.spyOn(res, 'end');
    const outcome = invoke(res).catch((failure) => failure);
    await turn();
    source.enqueue(Buffer.from(content));
    await wrote.promise;
    source.error(new Error('synthetic upstream read failure'));
    await outcome;
    await turn();
    expect(res.writableFinished).toBe(false);
    expect(res.destroyed).toBe(true);
    expect(end).not.toHaveBeenCalled();
    expect(JSON.stringify([...warn.mock.calls, ...error.mock.calls])).toContain(requestId);
    expect(res.bytes.toString()).not.toContain('[DONE]');
    expect(recordTransaction).not.toHaveBeenCalled();
    expect(chargeUsage).not.toHaveBeenCalled();
  });

  it('aborts the upstream client signal when res.close arrives before headers', async () => {
    const entered = deferred<void>();
    const headers = deferred<Response>();
    let signal: AbortSignal | undefined;
    forward.mockImplementation((_dto, _requestId, clientSignal?: AbortSignal) => {
      signal = clientSignal;
      entered.resolve();
      return headers.promise;
    });
    const res = new StreamResponse();
    const outcome = invoke(res).catch((failure) => failure);
    await entered.promise;
    try {
      expect(res.headersSent).toBe(false);
      res.destroy();
      await turn();
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(true);
      expect(forward.mock.calls[0].slice(0, 2)).toEqual([dto, requestId]);
    } finally {
      headers.resolve(new Response(''));
      await outcome;
    }
    expect(recordTransaction).not.toHaveBeenCalled();
  });

  it('aborts the upstream client signal when res.close arrives during a pending read', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    let signal: AbortSignal | undefined;
    const upstreamCancelled = jest.fn();
    const body = new ReadableStream<Uint8Array>({
      start(value) { source = value; }, cancel: upstreamCancelled,
    });
    forward.mockImplementation((_dto, _requestId, clientSignal?: AbortSignal) => {
      signal = clientSignal;
      signal?.addEventListener('abort', () => {
        try { source.error(signal?.reason ?? new Error('client disconnected')); } catch { /* Already cancelled. */ }
      }, { once: true });
      return Promise.resolve(new Response(body));
    });
    const res = new StreamResponse();
    const wrote = deferred<void>();
    res.onChunk = () => wrote.resolve();
    const outcome = invoke(res).catch((failure) => failure);
    await turn();
    source.enqueue(Buffer.from(content));
    await wrote.promise;
    try {
      res.destroy();
      await turn();
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(true);
    } finally {
      try { source.error(new Error('test cleanup')); } catch { /* Already cancelled. */ }
      await outcome;
    }
    expect(res.writableFinished).toBe(false);
    expect(res.bytes.toString()).not.toContain('[DONE]');
    expect(recordTransaction).not.toHaveBeenCalled();
    expect(chargeUsage).not.toHaveBeenCalled();
  });
});
