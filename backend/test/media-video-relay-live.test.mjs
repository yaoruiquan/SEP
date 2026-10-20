import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { testVideoRelay } from './media-video-relay-live.mjs';

const key = 'private-relay-test-key';
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
});
const task = { id: 'task-original', model: 'minimax-h3', status: 'completed' };
const price = (operation = 'text-to-video', patch = {}) => ({
  object: 'sub2api.video_pricing', schema_version: 1, currency: 'USD', model: 'minimax-h3', operation,
  resolution: '720p', duration_seconds: 4, billing_mode: 'video', pricing_status: 'quoted',
  pricing_source: 'customer_video_contract', pricing_authority: 'sub2api_customer_billing',
  amount_usd: '0.12', pricing_version: 'v1:abc', effective_rate_multiplier: 1,
  observed_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(), ...patch,
});
const usage = (patch = {}) => ({ object: 'sub2api.video_request_usage', schema_version: 1, currency: 'USD',
  request_id: 'client:server-id', model: 'minimax-h3', status: 'settled', actual_cost_usd: '0.12',
  video_count: 1, duration_seconds: 4, resolution: '720p', ...patch });
async function setup(t, overrides = {}) {
  const outputDir = await mkdtemp(join(tmpdir(), 'sep-video-relay-test-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  return { baseUrl: 'https://relay.invalid', apiKey: key, outputDir, allowPaid: true,
    recover: async () => ({ filePath: join(outputDir, 'video.mp4'), byteLength: 200, sha256: 'a'.repeat(64),
      media: { width: 1344, height: 768, durationSeconds: 4.458333, hasAudio: true } }), ...overrides };
}

test('requires explicit paid opt-in before any network call', async t => {
  await assert.rejects(testVideoRelay(await setup(t, { allowPaid: false, fetchImpl: () => assert.fail() })), /PAID_OPT_IN_REQUIRED/);
});

test('unavailable pricing never dispatches generation or writes a submission marker', async t => {
  for (const status of [403, 404, 503]) {
    let calls = 0;
    const options = await setup(t, { fetchImpl: async url => {
      assert.ok(url.endsWith('/pricing')); calls++;
      return new Response('Not available', { status });
    } });
    await assert.rejects(testVideoRelay(options), /RELAY_QUOTE_UNAVAILABLE/);
    assert.equal(calls, 1);
    await assert.rejects(readFile(join(options.outputDir, 'task.json')), { code: 'ENOENT' });
  }
});

test('incomplete, expired or non-customer quotes fail before generation', async t => {
  for (const patch of [{ currency: 'CNY' }, { schema_version: 2 }, { pricing_authority: 'public_catalog' },
    { pricing_source: 'public_fallback' }, { amount_usd: '0' }, { amount_usd: '-1' },
    { operation: 'image-to-video' }, { expires_at: 'invalid' }, { observed_at: 'invalid' },
    { expires_at: new Date(Date.now() - 1_000).toISOString() },
    { expires_at: new Date(Date.now() + 300_000).toISOString() }]) {
    const options = await setup(t, { fetchImpl: async url => {
      assert.ok(url.endsWith('/pricing')); return json(price('text-to-video', patch));
    } });
    await assert.rejects(testVideoRelay(options), /RELAY_QUOTE_INVALID/);
    await assert.rejects(readFile(join(options.outputDir, 'task.json')), { code: 'ENOENT' });
  }
});

test('creates once, immediately persists task identity and resumes only original GETs', async t => {
  const calls = [];
  const options = await setup(t, { fetchImpl: async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, `Bearer ${key}`);
    if (url.endsWith('/pricing')) return json(price());
    if (url.includes('/usage?')) return new Response('Not found', { status: 404 });
    return json(task, 200, { 'X-Client-Request-ID': 'server-id' });
  } });
  const first = await testVideoRelay(options);
  assert.equal(first.realSepBillingVerified, false);
  assert.equal(first.sepWalletWrites, 0);
  assert.equal(first.quote.amountUsd, '0.12');
  const saved = await readFile(join(options.outputDir, 'task.json'), 'utf8');
  assert.equal(JSON.parse(saved).taskId, task.id);
  assert.ok(!saved.includes(key));
  await testVideoRelay(options);
  assert.equal(calls.filter(c => c.url.endsWith('/videos') && c.init.method === 'POST').length, 1);
});

test('HTTP rejection never becomes a retry and only known failure metadata is persisted', async t => {
  const calls = [];
  const options = await setup(t, { fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/pricing')) return json(price());
    return json({ error: { code: key, message: 'Media generation is not enabled for this group' } }, 403);
  } });
  await assert.rejects(testVideoRelay(options), /RELAY_SUBMISSION_REJECTED_OR_UNKNOWN/);
  const saved = await readFile(join(options.outputDir, 'task.json'), 'utf8');
  assert.equal(JSON.parse(saved).failureKind, 'GROUP_MEDIA_DISABLED');
  assert.ok(!saved.includes(key));
  const count = calls.length;
  await assert.rejects(testVideoRelay(options), /RELAY_UNKNOWN_SUBMISSION_DO_NOT_RESUBMIT/);
  assert.equal(calls.length, count);
});

test('a network-ambiguous POST is not dispatched a second time', async t => {
  let submits = 0;
  const options = await setup(t, { fetchImpl: async url => {
    if (url.endsWith('/pricing')) return json(price());
    submits++;
    throw new Error('Disconnected');
  } });
  await assert.rejects(testVideoRelay(options), /Disconnected/);
  await assert.rejects(testVideoRelay(options), /DO_NOT_RESUBMIT/);
  assert.equal(submits, 1);
});

test('sends frozen quote headers and only accepts matching usage identity', async t => {
  const options = await setup(t, { fetchImpl: async (url, init) => {
    if (url.endsWith('/pricing')) return json(price());
    if (url.includes('/usage?')) return json(usage({ request_id: 'different-request' }));
    if (init.method === 'POST') {
      assert.equal(init.headers['X-Video-Pricing-Version'], 'v1:abc');
      assert.equal(init.headers['X-Video-Operation'], 'text-to-video');
    }
    return json(task, 200, { 'X-Client-Request-ID': 'server-id' });
  } });
  const result = await testVideoRelay(options);
  assert.equal(result.quote.amountUsd, '0.12');
  assert.equal(result.usage, null);
});

test('image request preserves PNG reference and JSON metadata in multipart', async t => {
  const options = await setup(t);
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  options.referencePath = join(options.outputDir, 'ref.png');
  await writeFile(options.referencePath, png);
  options.fetchImpl = async (url, init) => {
    if (url.endsWith('/pricing')) return json(price('image-to-video'));
    if (init.method === 'POST') {
      assert.ok(init.body instanceof FormData);
      assert.deepEqual(Buffer.from(await init.body.get('input_reference').arrayBuffer()), png);
      assert.equal(init.body.get('seconds'), '4');
    }
    return json(task);
  };
  assert.equal((await testVideoRelay(options)).operation, 'image-to-video');
});

test('changed relay key cannot resume another connection task or start a second one', async t => {
  const options = await setup(t, { fetchImpl: async url => url.endsWith('/pricing')
    ? json(price()) : json(task) });
  await testVideoRelay(options);
  await assert.rejects(testVideoRelay({ ...options, apiKey: 'other-key', fetchImpl: () => assert.fail() }), /RELAY_STATE_CONFLICT/);
});

test('saved media survives unavailable billing and resumes billing without querying or submitting video', async t => {
  let phase = 0, submits = 0, queries = 0, recovered = 0;
  const options = await setup(t, { recover: async () => {
    recovered++;
    return { filePath: 'video.mp4', byteLength: 200, sha256: 'a'.repeat(64), media: { hasAudio: true } };
  }, fetchImpl: async (url, init) => {
    if (url.endsWith('/pricing')) { assert.equal(phase, 0); return json(price()); }
    if (url.includes('/usage?')) {
      if (phase === 0) throw new Error(key);
      return json(usage());
    }
    assert.equal(phase, 0, 'Saved task must not query upstream again for billing reconciliation.');
    if (init.method === 'POST') { submits++; return json({ ...task, status: 'queued' }, 200, { 'X-Client-Request-ID': 'server-id' }); }
    queries++; return json(task);
  } });
  const first = await testVideoRelay(options);
  assert.equal(first.usage, null); assert.equal(first.relayBillingVerified, false);
  assert.equal(first.realSepBillingVerified, false);
  phase++;
  const second = await testVideoRelay(options);
  assert.equal(second.usage.actualCostUsd, '0.12'); assert.equal(second.relayBillingVerified, true);
  assert.equal(second.realSepBillingVerified, false);
  assert.equal(submits, 1); assert.equal(queries, 1); assert.equal(recovered, 2);
  assert.ok(!(await readFile(join(options.outputDir, 'result.json'), 'utf8')).includes(key));
});

test('malformed or incompatible usage never confirms a relay charge', async t => {
  for (const patch of [{ schema_version: 2 }, { currency: 'CNY' }, { video_count: null }, { video_count: 2 },
    { resolution: '2k' }, { duration_seconds: 8 }, { status: 'pending' }, { actual_cost_usd: '-1' }]) {
    const options = await setup(t, { fetchImpl: async (url) => {
      if (url.endsWith('/pricing')) return json(price());
      if (url.includes('/usage?')) return json(usage(patch));
      return json(task, 200, { 'X-Client-Request-ID': 'server-id' });
    } });
    const result = await testVideoRelay(options);
    assert.equal(result.usage, null); assert.equal(result.relayBillingVerified, false);
  }
});
