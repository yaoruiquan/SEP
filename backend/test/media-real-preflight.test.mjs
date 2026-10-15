import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectRealMedia } from './media-real-preflight.mjs';

const input = { baseUrl: 'https://relay.example/v1', apiKey: 'test-private-value' };
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

test('only sends five authenticated GETs; catalog and aggregate spend do not authorize generation', async () => {
  const calls = [];
  const result = await inspectRealMedia({ ...input, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/models') && !url.includes('/batches/')) return json({ data: [{ id: 'gpt-image-2' }] });
    if (url.endsWith('/usage')) return json({ balance: 100, usage: { total: { actual_cost: 42 } } });
    return json({ code: 'BATCH_IMAGE_DISABLED', message: 'sensitive upstream message' }, 404);
  } });
  assert.equal(calls.length, 5);
  for (const { url, options } of calls) {
    assert.ok(url.startsWith('https://relay.example/v1/') || url === 'https://relay.example/api/v1/channels/available');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body, undefined);
    assert.equal(options.headers.Authorization, `Bearer ${input.apiKey}`);
  }
  assert.equal(result.modelListed, true);
  assert.equal(result.aggregateUsageAvailable, true);
  assert.equal(result.readyForPaidExecution, false);
  assert.equal(result.endpoints[2].errorCode, 'BATCH_IMAGE_DISABLED');
  assert.equal(result.generationCalls + result.editCalls + result.walletWrites, 0);
  assert.doesNotMatch(JSON.stringify(result), /test-private-value|sensitive upstream|"balance"|"actual_cost"/);
});

test('batch model prices do not prove standard generation or edit prices', async () => {
  const result = await inspectRealMedia({ ...input, fetchImpl: async () => json({ data: [{
    id: 'gpt-image-2', price: 0.01, currency: 'USD',
  }] }) });
  assert.equal(result.batchCatalogAvailable, true);
  assert.equal(result.standardImagePriceVerified, false);
  assert.equal(result.requestBillingVerified, false);
  assert.equal(result.readyForPaidExecution, false);
});

test('network errors and untrusted error bodies never leak response text or credentials', async () => {
  const result = await inspectRealMedia({ ...input, fetchImpl: async (url) => {
    if (url.endsWith('/usage')) throw new Error(`Authorization: Bearer ${input.apiKey}`);
    return json({ error: { code: input.apiKey, message: input.apiKey } }, 401);
  } });
  assert.equal(result.modelListed, false);
  assert.equal(result.aggregateUsageAvailable, false);
  assert.equal(result.endpoints[1].errorCode, 'READ_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(result), /test-private-value|Authorization/);
});

test('oversized, HTML and malformed responses cannot provide evidence', async () => {
  const responses = [
    new Response('x'.repeat(256 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
    new Response('<html>redirect login</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('{broken', { headers: { 'content-type': 'application/json' } }),
  ];
  const result = await inspectRealMedia({ ...input, fetchImpl: async () => responses.shift() });
  assert.ok(result.endpoints.every((endpoint) => !endpoint.validJson));
  assert.equal(result.readyForPaidExecution, false);
});

test('invalid target or credential is rejected before any network operation', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return json({}); };
  for (const value of [
    { baseUrl: 'http://relay.example' }, { baseUrl: 'https://user:pass@relay.example' },
    { baseUrl: 'https://relay.example?key=secret' }, { baseUrl: 'https://relay.example/#key' },
    { apiKey: '' }, { apiKey: 'key\r\nheader' }, { model: 'gpt-image-2.5' },
  ]) await assert.rejects(inspectRealMedia({ ...input, ...value, fetchImpl }));
  assert.equal(calls, 0);
});


test('key token billing multipliers do not authorize image execution or imply an image price', async () => {
  for (const rate of [0, 1, 1.5]) {
    const result = await inspectRealMedia({ ...input, fetchImpl: async (url) => url.endsWith('/sub2api/billing')
      ? json({ object: 'sub2api.key_billing', schema_version: 1, billing_scope: 'token', effective_rate_multiplier: rate,
        private_field: input.apiKey })
      : json({ error: { code: 'UNAUTHORIZED' } }, 401) });
    assert.deepEqual(result.tokenBillingInfo, { billingScope: 'token', effectiveRateMultiplier: rate });
    assert.equal(result.standardImagePriceVerified, false);
    assert.equal(result.readyForPaidExecution, false);
    assert.doesNotMatch(JSON.stringify(result), /test-private-value|private_field/);
  }
  for (const rate of [-1, '1', null]) {
    const result = await inspectRealMedia({ ...input, fetchImpl: async () => json({
      object: 'sub2api.key_billing', schema_version: 1, billing_scope: 'token', effective_rate_multiplier: rate,
    }) });
    assert.equal(result.tokenBillingInfo, null);
  }
});
