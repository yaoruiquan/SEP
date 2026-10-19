import { deflateSync } from 'node:zlib';
import { HttpException } from '@nestjs/common';
import type { SettingKey } from 'shared';
import { SettingService } from '../setting/setting.service';
import { MediaRealQuoteRequestSchema } from '../../shared/media-real.dto';
import { ImageDispatchError, Sub2apiImageAdapter } from './sub2api-image.adapter';

const BASE_URL = 'https://media.example.test/v1/';
const API_KEY = 'private-test-api-key';
const REQUEST_ID = 'sub2api.req:123';
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQ2FIBAAJEAU2Vdyv6AAAAAElFTkSuQmCC';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBytes, data]);
  let crc = 0xffffffff;
  for (const byte of crcInput) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function validPngBase64(width: number, height: number): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

const REQUEST_PNG_BASE64 = validPngBase64(1024, 1024);

function input(operation: 'generate' | 'edit' = 'generate') {
  return MediaRealQuoteRequestSchema.parse({
    profileId: 'real-image', configVersion: 'real-v1', operation,
    referenceIds: operation === 'edit' ? ['reference-1'] : [],
    creativeBrief: 'A product photograph',
    parameters: { size: '1024x1024', count: 1, quality: 'medium' },
  });
}

function price(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    object: 'sub2api.image_pricing', schema_version: 1, currency: 'USD', model: 'gpt-image-2',
    operation: 'generate', size: '1024x1024', n: 1, quality: 'medium', billing_mode: 'image',
    pricing_status: 'quoted', pricing_source: 'live-contract', amount_usd: '0.040000',
    pricing_version: 'price-v1', effective_rate_multiplier: 1,
    observed_at: new Date(now).toISOString(), expires_at: new Date(now + 60_000).toISOString(),
    ...overrides,
  };
}

function response(value: unknown, options: { status?: number; requestId?: string; contentType?: string } = {}) {
  const headers = new Headers();
  headers.set('content-type', options.contentType ?? 'application/json');
  if (options.requestId) headers.set('x-request-id', options.requestId);
  return new Response(JSON.stringify(value), { status: options.status ?? 200, headers });
}

function usage(overrides: Record<string, unknown> = {}) {
  return {
    object: 'sub2api.request_usage', schema_version: 1, currency: 'USD',
    request_id: REQUEST_ID, status: 'settled', model: 'gpt-image-2',
    actual_cost_usd: '0.040000', image_count: 1, ...overrides,
  };
}

async function expectCode(action: Promise<unknown>, status: number, code: string) {
  const error = await action.then(() => { throw new Error('Expected adapter failure'); }, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(status);
  expect((error as HttpException).getResponse()).toMatchObject({ error: { code } });
  return error as HttpException;
}

describe('Sub2apiImageAdapter', () => {
  let fetchMock: jest.SpyInstance;
  let settings: jest.Mocked<Pick<SettingService, 'getEffectiveValue'>>;
  let adapter: Sub2apiImageAdapter;

  beforeEach(() => {
    settings = { getEffectiveValue: jest.fn(async (key: SettingKey): Promise<string> => key === 'MEDIA_BASE_URL' ? BASE_URL : API_KEY) };
    adapter = new Sub2apiImageAdapter(settings as unknown as SettingService);
    fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network call'));
  });

  afterEach(() => jest.restoreAllMocks());

  it('persists and queries the sub2api client billing ID instead of the upstream request ID', async () => {
    const upstream = response({ data: [{ b64_json: REQUEST_PNG_BASE64 }] }, { requestId: 'upstream-request-id' });
    upstream.headers.set('x-client-request-id', 'gateway-client-id');
    fetchMock.mockResolvedValueOnce(upstream);
    const onRequestId = jest.fn(async () => {});
    await expect(adapter.execute(input(), [], onRequestId)).resolves.toMatchObject({ requestId: 'client:gateway-client-id' });
    expect(onRequestId).toHaveBeenCalledWith('client:gateway-client-id');
    fetchMock.mockResolvedValueOnce(response(usage({ request_id: 'client:gateway-client-id' })));
    await expect(adapter.usage('client:gateway-client-id')).resolves.toMatchObject({ status: 'settled' });
    expect(fetchMock.mock.calls[1][0]).toBe('https://media.example.test/v1/sub2api/usage?request_id=client%3Agateway-client-id');
  });

  it.each(['', 'invalid client id', 'first, second', 'x'.repeat(250)])('never falls back to an unrelated request ID for an invalid client billing header %#', async clientId => {
    const upstream = response({ data: [{ b64_json: REQUEST_PNG_BASE64 }] }, { requestId: REQUEST_ID });
    upstream.headers.set('x-client-request-id', clientId);
    fetchMock.mockResolvedValueOnce(upstream);
    const onRequestId = jest.fn(async () => {});
    const failure = await expectCode(adapter.execute(input(), [], onRequestId), 502, 'SUBMISSION_UNKNOWN');
    expect(failure).toMatchObject({ requestId: null, definitelyRejected: false });
    expect(onRequestId).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a current quoted non-token price matching the request', async () => {
    fetchMock.mockResolvedValueOnce(response(price()));
    const result = await adapter.pricing(input());
    expect(result.amount_usd).toBe('0.040000');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://media.example.test/v1/sub2api/images/pricing');
    expect(options.method).toBe('POST');
    expect(new Headers(options.headers).get('authorization')).toBe(`Bearer ${API_KEY}`);
  });

  it('quotes and dispatches the explicitly selected compatible model, accepting OpenAI responses without a model field', async () => {
    const selectedModel = 'gpt-image-1.5';
    fetchMock.mockResolvedValueOnce(response(price({ model: selectedModel })));
    await expect(adapter.pricing(input(), selectedModel)).resolves.toMatchObject({ model: selectedModel });
    fetchMock.mockResolvedValueOnce(response({ data: [{ b64_json: REQUEST_PNG_BASE64 }] }, { requestId: REQUEST_ID }));
    await expect(adapter.execute(input(), [], undefined, selectedModel)).resolves.toMatchObject({ requestId: REQUEST_ID });
    const pricingBody = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    const executionBody = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(pricingBody.model).toBe(selectedModel);
    expect(executionBody.model).toBe(selectedModel);
  });

  it('keeps an explicit mismatching response model unresolved after dispatch', async () => {
    fetchMock.mockResolvedValueOnce(response({ model: 'gpt-image-2', data: [{ b64_json: REQUEST_PNG_BASE64 }] }, { requestId: REQUEST_ID }));
    const error = await expectCode(adapter.execute(input(), [], undefined, 'gpt-image-1.5'), 502, 'SUBMISSION_UNKNOWN');
    expect(error).toMatchObject({ requestId: REQUEST_ID, definitelyRejected: false });
  });

  it('accepts an effective fallback charge explicitly attested by sub2api customer billing', async () => {
    fetchMock.mockResolvedValueOnce(response(price({ pricing_source: 'fallback', pricing_authority: 'sub2api_customer_billing' })));
    await expect(adapter.pricing(input())).resolves.toMatchObject({
      pricing_source: 'fallback', pricing_authority: 'sub2api_customer_billing', amount_usd: '0.040000',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['unknown', { pricing_status: 'unavailable', amount_usd: null }],
    ['fallback source', { pricing_source: 'unknown-default-fallback' }],
    ['unattested fallback', { pricing_source: 'fallback' }],
    ['unknown authority', { pricing_source: 'fallback', pricing_authority: 'supplier_estimate' }],
    ['unknown source despite authority', { pricing_source: 'unknown-default-fallback', pricing_authority: 'sub2api_customer_billing' }],
    ['token billing despite authority', { billing_mode: 'token', pricing_source: 'fallback', pricing_authority: 'sub2api_customer_billing' }],
    ['token billing', { billing_mode: 'token' }],
    ['missing amount', { amount_usd: null }],
    ['wrong model', { model: 'other-image-model' }],
    ['wrong operation', { operation: 'edit' }],
    ['wrong size', { size: '1536x1024' }],
    ['wrong count', { n: 2 }],
    ['wrong quality', { quality: 'high' }],
    ['expired quote', { expires_at: new Date(Date.now() - 1).toISOString() }],
    ['quote lifetime too long', { expires_at: new Date(Date.now() + 121_000).toISOString() }],
  ])('rejects %s pricing without reserving or dispatching', async (_label, overrides) => {
    fetchMock.mockResolvedValueOnce(response(price(overrides)));
    await expectCode(adapter.pricing(input()), 503, 'PRICE_UNAVAILABLE');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/sub2api/images/pricing');
  });

  it('rejects malformed and oversized pricing responses without exposing upstream details', async () => {
    fetchMock.mockResolvedValueOnce(response({ secret: API_KEY }, { contentType: 'text/html' }));
    const error = await expectCode(adapter.pricing(input()), 503, 'PRICE_UNAVAILABLE');
    expect(JSON.stringify(error.getResponse())).not.toContain(API_KEY);
    fetchMock.mockResolvedValueOnce(new Response('x'.repeat(64 * 1024 + 1), {
      headers: { 'content-type': 'application/json' },
    }));
    await expectCode(adapter.pricing(input()), 503, 'PRICE_UNAVAILABLE');
  });

  it('redacts credentials and private URL details for invalid media settings', async () => {
    const secrets = [
      ['http://private-user:private-password@internal.example.test/private/path?token=private-query', API_KEY],
      ['https://media.example.test/private?token=private-query', API_KEY],
      [BASE_URL, `bad\n${API_KEY}`],
      [BASE_URL, '   '],
    ];
    for (const [url, key] of secrets) {
      settings.getEffectiveValue.mockImplementation(async (setting: string) => setting === 'MEDIA_BASE_URL' ? url : key);
      const error = await expectCode(adapter.pricing(input()), 503, 'PRICE_UNAVAILABLE');
      const serialized = JSON.stringify(error.getResponse()) + error.stack;
      expect(serialized).not.toContain('private-user');
      expect(serialized).not.toContain('private-password');
      expect(serialized).not.toContain('private-query');
      expect(serialized).not.toContain('private/path');
      expect(serialized).not.toContain('internal.example.test');
      expect(serialized).not.toContain(API_KEY);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not include upstream URL or credentials when fetch fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error(`failed at ${BASE_URL} Authorization: Bearer ${API_KEY}`));
    const error = await expectCode(adapter.pricing(input()), 503, 'PRICE_UNAVAILABLE');
    expect(JSON.stringify(error.getResponse()) + error.stack).not.toContain(API_KEY);
    expect(JSON.stringify(error.getResponse()) + error.stack).not.toContain('media.example.test');
  });

  it('classifies dispatch connection loss as unknown and never retries', async () => {
    fetchMock.mockRejectedValueOnce(new Error(`socket reset ${BASE_URL} ${API_KEY}`));
    const error = await expectCode(adapter.execute(input(), []), 502, 'SUBMISSION_UNKNOWN');
    expect(error).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.getResponse()) + error.stack).not.toContain(API_KEY);
  });

  it('preserves a validated request ID when dispatch succeeds', async () => {
    fetchMock.mockResolvedValueOnce(response({ data: [{ b64_json: REQUEST_PNG_BASE64 }] }, { requestId: REQUEST_ID }));
    const result = await adapter.execute(input(), []);
    expect(result.requestId).toBe(REQUEST_ID);
    expect(result.images).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://media.example.test/v1/images/generations');
  });

  it('awaits request ID persistence before acquiring or reading the body', async () => {
    const upstream = response({ data: [{ b64_json: REQUEST_PNG_BASE64 }] }, { requestId: REQUEST_ID });
    const getReader = jest.spyOn(upstream.body!, 'getReader');
    let entered!: () => void;
    let persist!: () => void;
    const callbackEntered = new Promise<void>(resolve => { entered = resolve; });
    const persisted = new Promise<void>(resolve => { persist = resolve; });
    const onRequestId = jest.fn(async () => { entered(); await persisted; });
    fetchMock.mockResolvedValueOnce(upstream);
    const execution = adapter.execute(input(), [], onRequestId);
    try {
      await callbackEntered;
      expect(onRequestId).toHaveBeenCalledTimes(1);
      expect(onRequestId).toHaveBeenCalledWith(REQUEST_ID);
      expect(getReader).not.toHaveBeenCalled();
      expect(upstream.bodyUsed).toBe(false);
    } finally { persist(); }
    await expect(execution).resolves.toMatchObject({ requestId: REQUEST_ID });
    expect(getReader).toHaveBeenCalledTimes(1);
    expect(onRequestId).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['storage error', () => Promise.reject(new Error('private persistence failure'))],
    ['HTTP error', () => Promise.reject(new HttpException('private storage response', 400))],
    ['definite dispatch error', () => Promise.reject(new ImageDispatchError(REQUEST_ID, true))],
    ['synchronous exception', () => { throw new Error('private synchronous failure'); }],
  ])('treats a callback %s as unknown, not a definite rejection, without reading or retrying', async (_label, callback) => {
    const upstream = response({ error: 'rejected' }, { status: 429, requestId: REQUEST_ID });
    const getReader = jest.spyOn(upstream.body!, 'getReader');
    const cancel = jest.spyOn(upstream.body!, 'cancel');
    const onRequestId = jest.fn(callback);
    fetchMock.mockResolvedValueOnce(upstream);
    const error = await expectCode(adapter.execute(input(), [], onRequestId), 502, 'SUBMISSION_UNKNOWN');
    expect(error).toMatchObject({ requestId: REQUEST_ID, definitelyRejected: false });
    expect(onRequestId).toHaveBeenCalledTimes(1);
    expect(getReader).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.getResponse())).not.toContain('private');
  });

  it('cancels a successful response without reading when request ID persistence fails', async () => {
    const upstream = response({ data: [{ b64_json: REQUEST_PNG_BASE64 }] }, { requestId: REQUEST_ID });
    const getReader = jest.spyOn(upstream.body!, 'getReader');
    const cancel = jest.spyOn(upstream.body!, 'cancel');
    fetchMock.mockResolvedValueOnce(upstream);
    const onRequestId = jest.fn(async () => { throw new HttpException('storage unavailable', 503); });
    const error = await expectCode(adapter.execute(input(), [], onRequestId), 502, 'SUBMISSION_UNKNOWN');
    expect(error).toMatchObject({ requestId: REQUEST_ID, definitelyRejected: false });
    expect(getReader).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onRequestId).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 'request id', 'a'.repeat(257), 'request/id', '\u00e9'])('does not notify an absent or invalid header ID %#', async requestId => {
    fetchMock.mockResolvedValueOnce(response({ data: [{ b64_json: REQUEST_PNG_BASE64 }] }, { requestId }));
    const onRequestId = jest.fn(async () => {});
    const error = await expectCode(adapter.execute(input(), [], onRequestId), 502, 'SUBMISSION_UNKNOWN');
    expect(error).toMatchObject({ requestId: null, definitelyRejected: false });
    expect(onRequestId).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([REQUEST_ID, 'different-id'])('does not notify repeated response headers, even when their values agree (%s)', async secondId => {
    const upstream = response({ data: [{ b64_json: REQUEST_PNG_BASE64 }] }, { requestId: REQUEST_ID });
    upstream.headers.append('x-request-id', secondId);
    fetchMock.mockResolvedValueOnce(upstream);
    const onRequestId = jest.fn(async () => {});
    const error = await expectCode(adapter.execute(input(), [], onRequestId), 502, 'SUBMISSION_UNKNOWN');
    expect(error).toMatchObject({ requestId: null, definitelyRejected: false });
    expect(onRequestId).not.toHaveBeenCalled();
  });

  it('does not notify on connection failure before response headers', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket reset'));
    const onRequestId = jest.fn(async () => {});
    await expectCode(adapter.execute(input(), [], onRequestId), 502, 'SUBMISSION_UNKNOWN');
    expect(onRequestId).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('notifies once before JSON parsing failure and keeps the request ID for recovery', async () => {
    const upstream = new Response('{broken JSON', { headers: {
      'content-type': 'application/json', 'x-request-id': REQUEST_ID,
    } });
    fetchMock.mockResolvedValueOnce(upstream);
    const onRequestId = jest.fn(async () => {});
    const error = await expectCode(adapter.execute(input(), [], onRequestId), 502, 'SUBMISSION_UNKNOWN');
    expect(error).toMatchObject({ requestId: REQUEST_ID, definitelyRejected: false });
    expect(onRequestId).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not notify again or retry when the response stream fails after headers', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.error(new Error('body disconnected')); },
    });
    fetchMock.mockResolvedValueOnce(new Response(body, { headers: {
      'content-type': 'application/json', 'x-request-id': REQUEST_ID,
    } }));
    const onRequestId = jest.fn(async () => {});
    const error = await expectCode(adapter.execute(input(), [], onRequestId), 502, 'SUBMISSION_UNKNOWN');
    expect(error).toMatchObject({ requestId: REQUEST_ID, definitelyRejected: false });
    expect(onRequestId).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing 429 decision after a successful request ID callback', async () => {
    fetchMock.mockResolvedValueOnce(response({}, { status: 429, requestId: REQUEST_ID }));
    const onRequestId = jest.fn(async () => {});
    const error = await expectCode(adapter.execute(input(), [], onRequestId), 502, 'UPSTREAM_FAILED');
    expect(error).toMatchObject({ requestId: REQUEST_ID, definitelyRejected: true });
    expect(onRequestId).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([1, 2, 3, 4])('accepts settled usage with image_count %i', async imageCount => {
    fetchMock.mockResolvedValueOnce(response(usage({ image_count: imageCount })));
    await expect(adapter.usage(REQUEST_ID)).resolves.toMatchObject({ status: 'settled', image_count: imageCount });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, 0, -1, 1.5, 5, '1'])('rejects settled usage with missing or invalid image_count %#', async imageCount => {
    fetchMock.mockResolvedValueOnce(response(usage({ image_count: imageCount })));
    await expectCode(adapter.usage(REQUEST_ID), 503, 'BILLING_PENDING');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, 0])('allows pending usage with empty or zero image_count %#', async imageCount => {
    fetchMock.mockResolvedValueOnce(response(usage({ status: 'pending', model: null, actual_cost_usd: null, image_count: imageCount })));
    await expect(adapter.usage(REQUEST_ID)).resolves.toMatchObject({ status: 'pending', actual_cost_usd: null });
  });

  it.each([
    ['invalid JSON payload', { data: [{ b64_json: 'not base64' }] }],
    ['corrupt PNG', { data: [{ b64_json: Buffer.from('broken png').toString('base64') }] }],
    ['wrong dimensions', { data: [{ b64_json: PNG_BASE64 }] }],
  ])('treats %s after upstream dispatch as unknown with request ID', async (_label, payload) => {
    fetchMock.mockResolvedValueOnce(response(payload, { requestId: REQUEST_ID }));
    const error = await expectCode(adapter.execute(input(), []), 502, 'SUBMISSION_UNKNOWN');
    expect(error).toBeInstanceOf(HttpException);
    expect((error as unknown as { requestId: string }).requestId).toBe(REQUEST_ID);
    expect((error as unknown as { definitelyRejected: boolean }).definitelyRejected).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps malformed or absent upstream request IDs null', async () => {
    fetchMock.mockResolvedValueOnce(response({ not: 'json image payload' }, { requestId: 'request id with spaces' }));
    const error = await expectCode(adapter.execute(input(), []), 502, 'SUBMISSION_UNKNOWN');
    expect((error as unknown as { requestId: string | null }).requestId).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404, 413, 422, 429])('classifies explicit HTTP %i dispatch rejection as definite', async (status) => {
    fetchMock.mockResolvedValueOnce(response({ error: 'private upstream body' }, { status, requestId: REQUEST_ID }));
    const error = await expectCode(adapter.execute(input(), []), 502, 'UPSTREAM_FAILED');
    expect((error as unknown as { requestId: string }).requestId).toBe(REQUEST_ID);
    expect((error as unknown as { definitelyRejected: boolean }).definitelyRejected).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('classifies gateway 5xx dispatch as unknown and cancels the response body', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); } });
    const cancel = jest.spyOn(body, 'cancel');
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 502, headers: { 'x-request-id': REQUEST_ID } }));
    const error = await expectCode(adapter.execute(input(), []), 502, 'SUBMISSION_UNKNOWN');
    expect((error as unknown as { requestId: string }).requestId).toBe(REQUEST_ID);
    expect((error as unknown as { definitelyRejected: boolean }).definitelyRejected).toBe(false);
    expect(cancel).toHaveBeenCalled();
  });

  it('rejects edit references before dispatch and validates uploaded PNGs', async () => {
    await expectCode(adapter.execute(input('edit'), []), 503, 'INVALID_REFERENCE');
    await expectCode(adapter.execute(input('edit'), [Buffer.from('not png')]), 502, 'OUTPUT_FAILED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
