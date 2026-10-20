import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectVideoUpstream } from './media-video-preflight.mjs';

const input = { baseUrl: 'https://upstream.example/v1/', publicBaseUrl: 'https://portal.example',
  apiKey: 'test-secret-not-for-output', model: 'minimax-h3' };
const row = { model_name: input.model, model_price: 0.08, quota_type: 1,
  supported_endpoint_types: ['openai-video'], video_spec_prices: { '720p|any|no': 1, '2k|any|yes': 1.625 } };
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});

test('recognizes h3 from explicit ID and endpoint metadata, not name heuristics', async () => {
  const calls = [];
  const result = await inspectVideoUpstream({ ...input, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/models')) return json({ data: [{ id: 'minimax-m3' }, { id: 'minimax-h3' }] });
    if (url.endsWith('/api/pricing')) return json({ data: [row] });
    return json({ error: { message: input.apiKey } }, 404);
  } });
  assert.equal(result.modelListed, true);
  assert.equal(result.advertisedVideo, true);
  assert.deepEqual(result.advertisedPricing, { modelPrice: 0.08, quotaType: 1, specPrices: row.video_spec_prices, unitVerified: false });
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(c => c.options.method), ['GET', 'GET', 'OPTIONS', 'OPTIONS']);
  for (const { url, options } of calls) {
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, url.startsWith('https://portal.example/') ? undefined : `Bearer ${input.apiKey}`);
  }
  assert.equal(result.createProtocolVerified, false);
  assert.equal(result.customerQuoteVerified, false);
  assert.equal(result.readyForPaidExecution, false);
  assert.equal(result.executionPosts + result.configurationWrites, 0);
  assert.doesNotMatch(JSON.stringify(result), /test-secret-not-for-output/);
});

test('successful OPTIONS and a video-looking model ID never prove generation capability', async () => {
  const result = await inspectVideoUpstream({ ...input, model: 'sora-video', fetchImpl: async url =>
    url.endsWith('/models') ? json({ data: [{ id: 'sora-video' }] }) : json({ data: [] }) });
  assert.equal(result.modelListed, true);
  assert.equal(result.advertisedVideo, false);
  assert.equal(result.createProtocolVerified, false);
  assert.equal(result.readyForPaidExecution, false);
});

test('public metadata does not make a model accessible to this credential', async () => {
  const result = await inspectVideoUpstream({ ...input, fetchImpl: async url =>
    url.endsWith('/api/pricing') ? json({ data: [row] }) : json({ data: [] }) });
  assert.equal(result.advertisedVideo, true);
  assert.equal(result.modelListed, false);
  assert.ok(result.blockers.includes('MODEL_NOT_LISTED'));
});

test('rejects ambiguous public rows and invalid prices without forwarding private fields', async () => {
  for (const rows of [[row, row], [{ ...row, model_price: -1 }], [{ ...row, model_price: '0.08' }],
    [{ ...row, quota_type: 0 }], [{ ...row, supported_endpoint_types: ['chat'] }]]) {
    const result = await inspectVideoUpstream({ ...input, fetchImpl: async () => json({ data: rows }) });
    assert.equal(result.advertisedPricing, null);
  }
  const result = await inspectVideoUpstream({ ...input, fetchImpl: async () => json({ data: [{ ...row,
    enable_groups: [input.apiKey], private_field: input.apiKey,
    video_spec_prices: { '720p|any|no': 1, [input.apiKey]: 99, '1080p|any|yes': -1, '2k|any|no': '2' },
  }] }) });
  assert.deepEqual(result.advertisedPricing.specPrices, { '720p|any|no': 1 });
  assert.doesNotMatch(JSON.stringify(result), /test-secret-not-for-output|private_field|enable_groups/);
});

test('network errors, auth failures and untrusted bodies cannot leak secrets', async () => {
  const result = await inspectVideoUpstream({ ...input, fetchImpl: async url => {
    if (url.endsWith('/models')) throw new Error(`Bearer ${input.apiKey}`);
    return json({ data: [row], error: { message: input.apiKey } }, 401);
  } });
  assert.equal(result.advertisedVideo, false);
  assert.equal(result.catalogValid, false);
  assert.equal(result.endpoints[0].errorCode, 'READ_UNAVAILABLE');
  assert.ok(result.blockers.includes('MODEL_CATALOG_UNAVAILABLE'));
  assert.ok(!result.blockers.includes('MODEL_NOT_LISTED'));
  assert.doesNotMatch(JSON.stringify(result), /test-secret-not-for-output|Bearer/);
});

test('bounds and validates responses, including oversized catalogs', async () => {
  const variants = [
    () => new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
    () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    () => json({ data: Array(2001).fill({ id: input.model }) }),
  ];
  for (const response of variants) {
    const result = await inspectVideoUpstream({ ...input, fetchImpl: async () => response() });
    assert.equal(result.catalogValid, false);
    assert.equal(result.modelListed, false);
    assert.equal(result.readyForPaidExecution, false);
  }
});

test('optional public origin is never guessed or queried when absent', async () => {
  const urls = [];
  await inspectVideoUpstream({ ...input, publicBaseUrl: undefined, fetchImpl: async url => {
    urls.push(url); return json({ data: [] });
  } });
  assert.equal(urls.length, 3);
  assert.ok(urls.every(url => url.startsWith('https://upstream.example/v1/')));
});

test('normalizes a bare origin to exactly one /v1 path separator', async () => {
  for (const baseUrl of ['https://upstream.example', 'https://upstream.example/',
    'https://upstream.example/v1', 'https://upstream.example/v1/',
    'https://upstream.example/relay', 'https://upstream.example/relay/v1/']) {
    const urls = [];
    await inspectVideoUpstream({ ...input, baseUrl, publicBaseUrl: undefined, fetchImpl: async url => {
      urls.push(url); return json({ data: [] });
    } });
    const prefix = baseUrl.includes('/relay') ? 'https://upstream.example/relay/v1' : 'https://upstream.example/v1';
    assert.deepEqual(urls, [`${prefix}/models`, `${prefix}/videos`, `${prefix}/video/generations`]);
  }
});

test('invalid input fails before any network request', async () => {
  let calls = 0;
  for (const override of [
    { baseUrl: 'http://upstream.example' }, { baseUrl: 'https://user:pass@upstream.example' },
    { baseUrl: 'https://upstream.example?key=secret' }, { baseUrl: 'https://upstream.example/#key' },
    { publicBaseUrl: 'http://portal.example' }, { publicBaseUrl: 'https://portal.example/private' },
    { publicBaseUrl: 'https://user:pass@portal.example' }, { apiKey: '' }, { apiKey: 'a\r\nb' },
    { model: undefined }, { model: '' }, { model: 'minimax-h3\n' },
  ]) await assert.rejects(inspectVideoUpstream({ ...input, ...override, fetchImpl: async () => { calls++; } }));
  assert.equal(calls, 0);
});
