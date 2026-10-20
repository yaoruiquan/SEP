import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { recoverVideoTask } from './media-video-recover.mjs';

const money = z.string().max(128).regex(/^\d+(?:\.\d{1,12})?$/);
const quoteSchema = z.object({
  object: z.literal('sub2api.video_pricing'), schema_version: z.literal(1), currency: z.literal('USD'),
  model: z.literal('minimax-h3'), operation: z.enum(['text-to-video', 'image-to-video']),
  resolution: z.literal('720p'), duration_seconds: z.literal(4), billing_mode: z.enum(['video', 'per_request']),
  pricing_status: z.literal('quoted'), pricing_source: z.string().trim().min(1).max(128),
  pricing_authority: z.literal('sub2api_customer_billing'), amount_usd: money,
  pricing_version: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
  effective_rate_multiplier: z.number().finite().nonnegative(),
  observed_at: z.string().datetime({ offset: true }), expires_at: z.string().datetime({ offset: true }),
}).strict();
const settledUsageSchema = z.object({
  object: z.literal('sub2api.video_request_usage'), schema_version: z.literal(1), currency: z.literal('USD'),
  request_id: z.string(), model: z.literal('minimax-h3'), status: z.literal('settled'),
  actual_cost_usd: money, video_count: z.literal(1), duration_seconds: z.literal(4), resolution: z.literal('720p'),
}).strict();

function verifiedQuote(value, operation) {
  const parsed = quoteSchema.safeParse(value);
  if (!parsed.success) throw new Error('RELAY_QUOTE_INVALID');
  const quote = parsed.data;
  const now = Date.now(), observed = Date.parse(quote.observed_at), expires = Date.parse(quote.expires_at);
  if (quote.operation !== operation || /public|fallback|default|unknown/i.test(quote.pricing_source) ||
    !Number.isFinite(Number(quote.amount_usd)) || Number(quote.amount_usd) <= 0 ||
    observed > now + 5000 || expires <= now || expires > now + 120_000 || expires <= observed ||
    expires - observed > 120_000) throw new Error('RELAY_QUOTE_INVALID');
  return { amountUsd: quote.amount_usd, version: quote.pricing_version, expiresAt: quote.expires_at };
}

async function boundedJson(response) {
  if (!response.body || !response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel();
    throw new Error('RELAY_JSON_REQUIRED');
  }
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256 * 1024) throw new Error('RELAY_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Explicit isolated supplier probe. Never writes SEP configuration or wallet records. */
export async function testVideoRelay({ baseUrl, apiKey, outputDir, referencePath, allowPaid = false,
  fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 60,
  recover = recoverVideoTask, log = () => {} }) {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    !apiKey?.trim() || /[\r\n]/.test(apiKey)) throw new Error('RELAY_CONNECTION_INVALID');
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/v1') ? path : `${path}/v1`;
  const root = url.href.replace(/\/$/, '');
  const connectionFingerprint = createHash('sha256').update(root + '\0' + apiKey).digest('hex');
  const operation = referencePath ? 'image-to-video' : 'text-to-video';
  const dir = resolve(outputDir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const statePath = join(dir, 'task.json');
  const lockPath = join(dir, '.live.lock');
  const lock = await open(lockPath, 'wx', 0o600);
  const request = (path, init = {}) => fetchImpl(root + path, { ...init, redirect: 'error',
    signal: AbortSignal.timeout(180_000), headers: { Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json', ...init.headers } });
  const persist = state => writeFile(statePath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  try {
    let state;
    try { state = JSON.parse(await readFile(statePath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('RELAY_STATE_INVALID'); }
    if (state && (state.root !== root || state.operation !== operation || state.model !== 'minimax-h3' ||
      state.connectionFingerprint !== connectionFingerprint)) throw new Error('RELAY_STATE_CONFLICT');
    if (!state) {
      if (!allowPaid) throw new Error('RELAY_PAID_OPT_IN_REQUIRED');
      const quoteResponse = await request('/sub2api/videos/pricing', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'minimax-h3', operation,
          resolution: '720p', duration_seconds: 4 }) });
      if (!quoteResponse.ok) {
        await quoteResponse.body?.cancel();
        throw new Error('RELAY_QUOTE_UNAVAILABLE');
      }
      const quote = verifiedQuote(await boundedJson(quoteResponse), operation);
      const fields = { model: 'minimax-h3', prompt: 'A plain unbranded white ceramic mug on a wooden table, slow gentle camera movement, soft daylight, no text or logo.',
        seconds: 4, size: '1280x720', resolution: '720p', generate_audio: true, metadata: { resolution: '768P', ratio: '16:9' } };
      const clientRequestId = `sep-video-probe-${randomUUID()}`;
      const headers = { 'X-Client-Request-ID': clientRequestId, 'Idempotency-Key': clientRequestId,
        'X-Video-Pricing-Version': quote.version, 'X-Video-Operation': operation };
      let body;
      if (referencePath) {
        const bytes = await readFile(referencePath);
        if (bytes.length > 10 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('RELAY_REFERENCE_INVALID');
        body = new FormData();
        body.append('input_reference', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'reference.png');
        for (const [name, value] of Object.entries(fields)) body.append(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
      } else { headers['Content-Type'] = 'application/json'; body = JSON.stringify(fields); }
      if (Date.parse(quote.expiresAt) <= Date.now()) throw new Error('RELAY_QUOTE_EXPIRED');
      // A failed/unknown submission marker is intentionally not retried on restart.
      state = { root, connectionFingerprint, operation, model: 'minimax-h3', submittedAt: new Date().toISOString(),
        clientRequestId, taskId: null, requestId: null, dispatch: 'UNKNOWN', quote, sepWalletWrites: 0 };
      await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      const response = await request('/videos', { method: 'POST', body, headers });
      const correlation = response.headers.get('x-client-request-id');
      state.requestId = correlation && /^[A-Za-z0-9_.:-]{1,240}$/.test(correlation) ? `client:${correlation}` : null;
      state.httpStatus = response.status;
      await persist(state);
      const value = await boundedJson(response);
      if (!response.ok) {
        const knownCodes = ['video_pricing_changed', 'video_pricing_not_configured', 'invalid_request_error', 'permission_error'];
        state.errorCode = knownCodes.includes(value?.error?.code) ? value.error.code : null;
        state.failureKind = value?.error?.message === 'Media generation is not enabled for this group'
          ? 'GROUP_MEDIA_DISABLED' : 'REJECTED_OR_UNKNOWN';
        await persist(state);
        throw new Error('RELAY_SUBMISSION_REJECTED_OR_UNKNOWN');
      }
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(value.id ?? '') || value.model !== state.model ||
        !['queued', 'in_progress', 'completed', 'failed', 'cancelled'].includes(value.status)) throw new Error('RELAY_TASK_INVALID');
      state.taskId = value.id; state.dispatch = 'ACCEPTED'; state.status = value.status;
      await persist(state);
      log({ stage: 'accepted', operation, status: state.status, customerQuoteAvailable: !!quote });
    }
    if (!state.taskId) throw new Error('RELAY_UNKNOWN_SUBMISSION_DO_NOT_RESUBMIT');
    for (let count = 0; count < attempts && state.status !== 'completed'; count++) {
      const response = await request(`/videos/${state.taskId}`);
      const task = await boundedJson(response);
      if (!response.ok || task.id !== state.taskId || task.model !== state.model ||
        !['queued', 'in_progress', 'completed', 'failed', 'cancelled'].includes(task.status)) throw new Error('RELAY_ORIGINAL_QUERY_FAILED');
      state.status = task.status;
      await persist(state);
      log({ stage: 'query', operation, status: task.status,
        progress: typeof task.progress === 'number' && Number.isFinite(task.progress) ? task.progress : null });
      if (task.status === 'failed' || task.status === 'cancelled') throw new Error('RELAY_TASK_FAILED');
      if (task.status !== 'completed') await sleep(15_000);
    }
    if (state.status !== 'completed') throw new Error('RELAY_STILL_PENDING_RESUME_ORIGINAL');
    const result = await recover({ baseUrl, apiKey, taskId: state.taskId, model: state.model,
      outputDir: join(dir, 'recovered'), fetchImpl });
    let usage = null;
    if (state.requestId) {
      // Billing failure cannot discard verified local media or trigger another generation.
      try {
        const bill = await request(`/sub2api/videos/usage?request_id=${encodeURIComponent(state.requestId)}`);
        if (bill.ok) {
          const parsed = settledUsageSchema.safeParse(await boundedJson(bill));
          if (parsed.success && parsed.data.request_id === state.requestId) {
            const value = parsed.data;
            usage = { actualCostUsd: value.actual_cost_usd, videoCount: value.video_count,
              durationSeconds: value.duration_seconds, resolution: value.resolution };
          }
        } else await bill.body?.cancel();
      } catch { /* Retain pending billing; recovery must not regenerate the video. */ }
    }
    const evidence = { testedAt: new Date().toISOString(), operation, model: state.model, filePath: result.filePath,
      byteLength: result.byteLength, sha256: result.sha256, media: result.media, quote: state.quote,
      usage, relayBillingVerified: usage !== null, realSepBillingVerified: false, sepWalletWrites: 0 };
    await writeFile(join(dir, 'result.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
    return evidence;
  } finally { await lock.close(); await unlink(lockPath); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  testVideoRelay({ baseUrl: process.env.VIDEO_RELAY_BASE_URL, apiKey: process.env.VIDEO_RELAY_KEY,
    outputDir: process.argv[2], referencePath: process.env.VIDEO_RELAY_REFERENCE_PATH,
    allowPaid: process.env.VIDEO_RELAY_ALLOW_PAID === 'true', log: value => console.log(JSON.stringify(value)) })
    .then(value => console.log(JSON.stringify(value)))
    .catch(error => { console.error(/^RELAY_[A-Z_]+$/.test(error.message) ? error.message : 'RELAY_PROBE_FAILED'); process.exitCode = 1; });
}
