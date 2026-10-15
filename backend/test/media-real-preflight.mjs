import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_RESPONSE_BYTES = 256 * 1024;
const KNOWN_BATCH_ERRORS = new Set(['BATCH_IMAGE_DISABLED', 'BATCH_IMAGE_GROUP_DISABLED']);

function apiRoot(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('MEDIA_PREFLIGHT_INVALID_BASE_URL');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/v1')) url.pathname += '/v1';
  return url.toString().replace(/\/$/, '');
}

async function boundedJson(response) {
  if (!response.body || !response.headers.get('content-type')?.includes('application/json')) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) return null;
      chunks.push(Buffer.from(part.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Read-only evidence. Catalog presence and aggregate spend never authorize a paid image call. */
export async function inspectRealMedia({ baseUrl, apiKey, model = 'gpt-image-2', fetchImpl = fetch }) {
  const root = apiRoot(baseUrl);
  if (!apiKey?.trim() || /[\r\n]/.test(apiKey)) throw new Error('MEDIA_PREFLIGHT_MISSING_CREDENTIAL');
  if (model !== 'gpt-image-2') throw new Error('MEDIA_PREFLIGHT_UNAPPROVED_MODEL');
  const endpoints = [];
  let modelListed = false;
  let aggregateUsageAvailable = false;
  let batchCatalogAvailable = false;
  let tokenBillingInfo = null;
  for (const path of ['/models', '/usage', '/images/batches/models', '/sub2api/billing', '/api/v1/channels/available']) {
    try {
      const target = path.startsWith('/api/') ? `${new URL(root).origin}${path}` : `${root}${path}`;
      const response = await fetchImpl(target, {
        method: 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      const value = await boundedJson(response);
      const result = { path: path.startsWith('/api/') ? path : `/v1${path}`, httpStatus: response.status, validJson: value !== null };
      if (path === '/models' && response.ok && Array.isArray(value?.data)) {
        modelListed = value.data.some((entry) => entry?.id === model);
      }
      if (path === '/usage' && response.ok) {
        aggregateUsageAvailable = typeof value?.usage?.total?.actual_cost === 'number';
      }
      if (path === '/images/batches/models') {
        batchCatalogAvailable = response.ok && value !== null;
        const code = value?.code ?? value?.error?.code;
        if (KNOWN_BATCH_ERRORS.has(code)) result.errorCode = code;
      }
      if (path === '/sub2api/billing' && response.ok && value?.object === 'sub2api.key_billing'
        && value.schema_version === 1 && value.billing_scope === 'token'
        && typeof value.effective_rate_multiplier === 'number'
        && Number.isFinite(value.effective_rate_multiplier) && value.effective_rate_multiplier >= 0) {
        // A token multiplier is not an image unit price, even when it equals one.
        tokenBillingInfo = { billingScope: 'token', effectiveRateMultiplier: value.effective_rate_multiplier };
      }
      endpoints.push(result);
    } catch {
      // Fetch errors can contain URLs, headers or upstream body text. Persist only a fixed category.
      endpoints.push({ path: path.startsWith('/api/') ? path : `/v1${path}`, httpStatus: null, validJson: false, errorCode: 'READ_UNAVAILABLE' });
    }
  }
  return {
    checkedAt: new Date().toISOString(), mode: 'read-only', model,
    endpoints, modelListed, aggregateUsageAvailable, batchCatalogAvailable, tokenBillingInfo,
    // Batch rates cannot prove the price of /images/generations or /images/edits.
    standardImagePriceVerified: false, requestBillingVerified: false,
    readyForPaidExecution: false, generationCalls: 0, editCalls: 0, walletWrites: 0,
    blockers: [
      ...(!modelListed ? ['MODEL_NOT_VERIFIED'] : []),
      'STANDARD_IMAGE_PRICE_EVIDENCE_MISSING', 'REQUEST_BILLING_EVIDENCE_MISSING',
    ],
  };
}

async function main() {
  const output = process.argv[2];
  if (!output) throw new Error('MEDIA_PREFLIGHT_OUTPUT_REQUIRED');
  const evidence = await inspectRealMedia({
    baseUrl: process.env.MEDIA_BASE_URL, apiKey: process.env.MEDIA_API_KEY,
    model: process.env.MEDIA_TEST_MODEL ?? 'gpt-image-2',
  });
  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ evidence: target, readyForPaidExecution: evidence.readyForPaidExecution,
    modelListed: evidence.modelListed, blockers: evidence.blockers }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('MEDIA_PREFLIGHT_FAILED');
    process.exitCode = 1;
  });
}
