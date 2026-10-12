import { ConfigService } from '@nestjs/config';
import { GatewayService } from './gateway.service';
import { createChatCompletionStreamObserver } from './gateway-stream';

describe('Gateway streaming time budgets', () => {
  let service: GatewayService;
  let fetchMock: jest.SpyInstance;
  let upstream: ReadableStreamDefaultController<Uint8Array>;
  let requestSignal: AbortSignal;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new GatewayService(
      {} as never,
      new ConfigService(),
      {} as never,
      {} as never,
      {} as never,
    );
    jest.spyOn(service, 'getSub2ApiConfig').mockResolvedValue({
      baseUrl: 'https://relay.test/v1',
      apiKey: 'synthetic',
      defaultModel: 'test-model',
    });
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (_url, init) => {
        requestSignal = init!.signal as AbortSignal;
        return new Response(
          new ReadableStream({
            start(controller) {
              upstream = controller;
            },
          }),
        );
      });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  const dto = {
    model: 'test-model',
    messages: [{ role: 'user' as const, content: 'synthetic' }],
    stream: true,
  };

  it('keeps a 75 second stream alive and preserves its actual finish and DONE', async () => {
    const response = await service.forwardChatCompletion(dto, 'long-stream');
    const body = response.text();
    upstream.enqueue(
      new TextEncoder().encode(
        'data: {"choices":[{"delta":{"content":"synthetic"},"finish_reason":null}]}\n\n',
      ),
    );
    await jest.advanceTimersByTimeAsync(75_000);
    expect(requestSignal.aborted).toBe(false);
    upstream.enqueue(
      new TextEncoder().encode(
        'data: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      ),
    );
    upstream.close();
    expect(await body).toContain('"finish_reason":"stop"');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('resets the idle budget on received bytes, not on total stream age', async () => {
    const response = await service.forwardChatCompletion(dto);
    const body = response.text();
    for (let i = 0; i < 4; i++) {
      upstream.enqueue(new TextEncoder().encode(': keepalive\n\n'));
      await jest.advanceTimersByTimeAsync(90_000);
      expect(requestSignal.aborted).toBe(false);
    }
    upstream.close();
    await body;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('aborts and errors a body that remains idle for 120 seconds', async () => {
    const response = await service.forwardChatCompletion(dto);
    const failure = response.text().catch((error) => error);
    await jest.advanceTimersByTimeAsync(120_000);
    expect(requestSignal.aborted).toBe(true);
    expect(await failure).toMatchObject({
      response: { error: { code: 'UPSTREAM_STREAM_IDLE_TIMEOUT' } },
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('enforces the ten minute total budget even if bytes keep arriving', async () => {
    const response = await service.forwardChatCompletion(dto);
    const failure = response.text().catch((error) => error);
    for (let i = 0; i < 10; i++) {
      upstream.enqueue(new TextEncoder().encode(': keepalive\n\n'));
      await jest.advanceTimersByTimeAsync(60_000);
    }
    expect(await failure).toMatchObject({
      response: { error: { code: 'UPSTREAM_STREAM_TOTAL_TIMEOUT' } },
    });
    expect(requestSignal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancels upstream work and clears all timers on client abort', async () => {
    const client = new AbortController();
    const response = await service.forwardChatCompletion(
      dto,
      'cancel-stream',
      client.signal,
    );
    const failure = response.text().catch((error) => error);
    client.abort();
    expect(await failure).toBeDefined();
    expect(requestSignal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('bounds the wait for upstream headers separately', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener(
            'abort',
            () => reject(init!.signal!.reason),
            { once: true },
          );
        }),
    );
    const failure = service.forwardChatCompletion(dto).catch((error) => error);
    await jest.advanceTimersByTimeAsync(120_000);
    expect(await failure).toMatchObject({
      status: 502,
      response: { error: { code: 'UPSTREAM_STREAM_HEADER_TIMEOUT' } },
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cleans up after upstream body failures', async () => {
    const response = await service.forwardChatCompletion(dto);
    const failure = response.text().catch(error => error);
    upstream.error(new Error('synthetic failure'));
    expect(await failure).toMatchObject({ message: 'synthetic failure' });
    expect(requestSignal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancels the fetch when the downstream reader cancels', async () => {
    const response = await service.forwardChatCompletion(dto);
    await response.body!.cancel();
    expect(requestSignal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('never starts fetch for an already cancelled client', async () => {
    const client = new AbortController();
    client.abort();
    await expect(service.forwardChatCompletion(dto, 'cancelled', client.signal)).rejects.toMatchObject({
      response: { error: { code: 'CLIENT_DISCONNECTED' } },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('uses configured time budgets', async () => {
    service = new GatewayService({} as never, new ConfigService({
      GATEWAY_STREAM_HEADER_TIMEOUT_MS: '40',
      GATEWAY_STREAM_IDLE_TIMEOUT_MS: '50',
      GATEWAY_STREAM_TOTAL_TIMEOUT_MS: '100',
    }), {} as never, {} as never, {} as never);
    jest.spyOn(service, 'getSub2ApiConfig').mockResolvedValue({
      baseUrl: 'https://relay.test/v1', apiKey: 'synthetic', defaultModel: 'test-model',
    });
    const response = await service.forwardChatCompletion(dto);
    const failure = response.text().catch(error => error);
    await jest.advanceTimersByTimeAsync(50);
    expect(await failure).toMatchObject({ response: { error: { code: 'UPSTREAM_STREAM_IDLE_TIMEOUT' } } });
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['0', '-1', '1.5', 'NaN', '2147483648'])('rejects invalid stream timeout %s without fetching', async value => {
    service = new GatewayService({} as never, new ConfigService({ GATEWAY_STREAM_IDLE_TIMEOUT_MS: value }), {} as never, {} as never, {} as never);
    jest.spyOn(service, 'getSub2ApiConfig').mockResolvedValue({
      baseUrl: 'https://relay.test/v1', apiKey: 'synthetic', defaultModel: 'test-model',
    });
    await expect(service.forwardChatCompletion(dto)).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not mistake slow downstream consumption for upstream silence', async () => {
    const response = await service.forwardChatCompletion(dto);
    const reader = response.body!.getReader();
    upstream.enqueue(new TextEncoder().encode('first'));
    expect((await reader.read()).done).toBe(false);
    upstream.enqueue(new TextEncoder().encode('buffered'));
    await jest.advanceTimersByTimeAsync(180_000);
    expect(requestSignal.aborted).toBe(false);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('buffered');
    upstream.close();
    expect((await reader.read()).done).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps non-streaming work alive past 30 seconds and reads the full body', async () => {
    const response = await service.forwardChatCompletion({ ...dto, stream: false });
    const result = response.json();
    upstream.enqueue(new TextEncoder().encode('{"choices":'));
    await jest.advanceTimersByTimeAsync(75_000);
    expect(requestSignal.aborted).toBe(false);
    upstream.enqueue(new TextEncoder().encode('[{"message":{"content":"ok"}}]}'));
    upstream.close();
    expect(await result).toMatchObject({ choices: [{ message: { content: 'ok' } }] });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('counts header and body waiting toward one non-streaming total budget', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      requestSignal = init!.signal as AbortSignal;
      await new Promise(resolve => setTimeout(resolve, 75_000));
      return new Response(new ReadableStream({ start(controller) { upstream = controller; } }));
    });
    const waiting = service.forwardChatCompletion({ ...dto, stream: false });
    await jest.advanceTimersByTimeAsync(75_000);
    const response = await waiting;
    const failure = response.text().catch(error => error);
    await jest.advanceTimersByTimeAsync(45_000);
    expect(await failure).toMatchObject({ response: { error: { code: 'UPSTREAM_STREAM_TOTAL_TIMEOUT' } } });
    expect(requestSignal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('Gateway SSE observation without wire rewriting', () => {
  it('observes split UTF-8, CRLF, no-space data fields and multiline events', () => {
    const observer = createChatCompletionStreamObserver();
    const wire = 'data:{"choices":[{"delta":{"content":"中文"},\r\ndata:"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3}}\r\n\r\ndata:[DONE]\r\n\r\n';
    for (const byte of new TextEncoder().encode(wire)) observer.write(Uint8Array.of(byte));
    expect(observer.finish()).toEqual({ finishReason: 'stop', done: true, protocolError: false, usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } });
  });

  it('does not mistake DONE or usage for a model finish_reason', () => {
    const observer = createChatCompletionStreamObserver();
    observer.write(new TextEncoder().encode('data:{"usage":{"prompt_tokens":2,"completion_tokens":3}}\n\ndata:[DONE]\n\n'));
    expect(observer.finish()).toMatchObject({ finishReason: null, done: true });
  });

  it('bounds oversized diagnostics events and recovers for later frames', () => {
    const observer = createChatCompletionStreamObserver();
    observer.write(new TextEncoder().encode(`data:${'x'.repeat(1024 * 1024 + 1)}`));
    observer.write(new TextEncoder().encode('\n\ndata:{"choices":[{"finish_reason":"stop"}]}\n\ndata:[DONE]\n\n'));
    expect(observer.finish()).toEqual({ finishReason: 'stop', done: true, usage: null, protocolError: false });
  });

  it.each(['\u00e9', '\u4e2d', '\ud83d\ude00'])('bounds a complete multibyte event by UTF-8 bytes and recovers (%s)', (character) => {
    const observer = createChatCompletionStreamObserver();
    const padding = character.repeat(Math.ceil(1024 * 1024 / Buffer.byteLength(character, 'utf8')));
    const wire = `data:${JSON.stringify({
      padding, choices: [{ finish_reason: 'length' }], usage: { prompt_tokens: 2, completion_tokens: 3 },
    })}\n\n`;
    expect(wire.length).toBeLessThan(1024 * 1024);
    expect(Buffer.byteLength(wire, 'utf8')).toBeGreaterThan(1024 * 1024);
    observer.write(Buffer.from(wire, 'utf8'));
    expect(observer.snapshot()).toEqual({ finishReason: null, done: false, usage: null, protocolError: false });
    observer.write(Buffer.from('data:{"choices":[{"finish_reason":"stop"}]}\n\ndata:[DONE]\n\n'));
    expect(observer.finish()).toEqual({ finishReason: 'stop', done: true, usage: null, protocolError: false });
  });

  it('bounds accumulated multibyte lines within one event and recovers after its delimiter', () => {
    const observer = createChatCompletionStreamObserver();
    const comment = `:${'\u4e2d'.repeat(200_000)}\n`;
    expect(Buffer.byteLength(comment, 'utf8')).toBeLessThan(1024 * 1024);
    observer.write(Buffer.from(comment));
    observer.write(Buffer.from(comment));
    observer.write(Buffer.from('data:{"choices":[{"finish_reason":"length"}],"usage":{"prompt_tokens":2,"completion_tokens":3}}\n\n'));
    expect(observer.snapshot()).toEqual({ finishReason: null, done: false, usage: null, protocolError: false });
    observer.write(Buffer.from('data:{"choices":[{"finish_reason":"tool_calls"}]}\n\ndata:[DONE]\n\n'));
    expect(observer.finish()).toEqual({ finishReason: 'tool_calls', done: true, usage: null, protocolError: false });
  });

  it('discards a multibyte unterminated buffer through the next delimiter and recovers', () => {
    const observer = createChatCompletionStreamObserver();
    const prefix = `data:{"padding":"${'\u4e2d'.repeat(350_000)}`;
    const bytes = Buffer.from(prefix, 'utf8');
    // Split inside a multibyte character as well as across the buffer limit.
    observer.write(bytes.subarray(0, 100_001));
    observer.write(bytes.subarray(100_001));
    observer.write(Buffer.from('","choices":[{"finish_reason":"length"}],"usage":{"prompt_tokens":2,"completion_tokens":3}}\n\n'));
    expect(observer.snapshot()).toEqual({ finishReason: null, done: false, usage: null, protocolError: false });
    observer.write(Buffer.from('data:{"choices":[{"finish_reason":"stop"}]}\n\ndata:[DONE]\n\n'));
    expect(observer.finish()).toEqual({ finishReason: 'stop', done: true, usage: null, protocolError: false });
  });

  it('does not extract usage or completion from an oversized multibyte EOF tail', () => {
    const observer = createChatCompletionStreamObserver();
    observer.write(Buffer.from(`data:${JSON.stringify({
      padding: '\u4e2d'.repeat(350_000), choices: [{ finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 3 },
    })}`));
    expect(observer.finish()).toEqual({ finishReason: null, done: false, usage: null, protocolError: false });
    expect(observer.finish()).toEqual(observer.snapshot());
  });

  it('reports usage at complete event boundaries and finalizes an EOF tail once', () => {
    const observer = createChatCompletionStreamObserver();
    observer.write(new TextEncoder().encode('data:{"usage":{"prompt_tokens":2,"completion_tokens":3}}'));
    expect(observer.snapshot().usage).toBeNull();
    expect(observer.finish().usage).toEqual({ prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 });
    expect(observer.finish()).toEqual(observer.snapshot());
  });

  it.each(['', '\n'])('does not promote an unterminated finish/DONE tail to success (%j)', (ending) => {
    const observer = createChatCompletionStreamObserver();
    observer.write(Buffer.from(`data:{"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3}}${ending}`));
    expect(observer.finish()).toMatchObject({ finishReason: null, usage: { prompt_tokens: 2, completion_tokens: 3 } });
    const done = createChatCompletionStreamObserver();
    done.write(Buffer.from(`data:[DONE]${ending}`));
    expect(done.finish().done).toBe(false);
  });

  it('bounds empty data lines and discards oversized events until their delimiter', () => {
    const observer = createChatCompletionStreamObserver();
    observer.write(Buffer.from('data:\n'.repeat(4097)));
    observer.write(Buffer.from('data:{"choices":[{"finish_reason":"stop"}]}\n\n'));
    expect(observer.snapshot().finishReason).toBeNull();
    observer.write(Buffer.from('data:{"choices":[{"finish_reason":"tool_calls"}]}\n\n'));
    expect(observer.finish().finishReason).toBe('tool_calls');
  });

  it('marks embedded upstream errors and ignores invalid usage', () => {
    const observer = createChatCompletionStreamObserver();
    observer.write(new TextEncoder().encode('data:{"error":{"message":"failed"},"usage":{"prompt_tokens":-1,"completion_tokens":3}}\n\n'));
    expect(observer.finish()).toMatchObject({ protocolError: true, usage: null });
  });
});
