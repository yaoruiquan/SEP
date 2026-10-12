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
    }), {} as never, {} as never);
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
    service = new GatewayService({} as never, new ConfigService({ GATEWAY_STREAM_IDLE_TIMEOUT_MS: value }), {} as never, {} as never);
    jest.spyOn(service, 'getSub2ApiConfig').mockResolvedValue({
      baseUrl: 'https://relay.test/v1', apiKey: 'synthetic', defaultModel: 'test-model',
    });
    await expect(service.forwardChatCompletion(dto)).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('Gateway SSE observation without wire rewriting', () => {
  it('observes split UTF-8, CRLF, no-space data fields and multiline events', () => {
    const observer = createChatCompletionStreamObserver();
    const wire = 'data:{"choices":[{"delta":{"content":"中文"},\r\ndata:"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3}}\r\n\r\ndata:[DONE]\r\n\r\n';
    for (const byte of new TextEncoder().encode(wire)) observer.write(Uint8Array.of(byte));
    expect(observer.finish()).toEqual({ finishReason: 'stop', done: true, usage: { prompt_tokens: 2, completion_tokens: 3 } });
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
    expect(observer.finish()).toEqual({ finishReason: 'stop', done: true, usage: null });
  });
});
