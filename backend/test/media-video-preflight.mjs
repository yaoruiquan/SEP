import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BYTES = 1024 * 1024;
const VIDEO_ENDPOINTS = new Set(['openai-video']);

function httpsUrl(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('VIDEO_PREFLIGHT_INVALID_URL');
  }
  return url;
}

async function readJson(response) {
  if (!response.body || !response.headers.get('content-type')?.includes('application/json')) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_BYTES) return null;
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

/** Upstream discovery only. Never submits a task or configures an application connection. */
export async function inspectVideoUpstream({ baseUrl, apiKey, model, publicBaseUrl, fetchImpl = fetch }) {
  const base = httpsUrl(baseUrl);
  const path = base.pathname.replace(/\/+$/, '');
  base.pathname = path.endsWith('/v1') ? path : `${path}/v1`;
  const root = base.href.replace(/\/$/, '');
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)) {
    throw new Error('VIDEO_PREFLIGHT_MISSING_CREDENTIAL');
  }
  if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/.test(model)) {
    throw new Error('VIDEO_PREFLIGHT_MODEL_REQUIRED');
  }
  const publicUrl = publicBaseUrl === undefined ? null : httpsUrl(publicBaseUrl);
  if (publicUrl && publicUrl.pathname !== '/') throw new Error('VIDEO_PREFLIGHT_INVALID_PUBLIC_ORIGIN');
  const endpoints = [];
  const request = async (url, path, method, authenticated = false) => {
    try {
      const response = await fetchImpl(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Accept: 'application/json', 'User-Agent': 'SEP-video-preflight/1',
          ...(authenticated ? { Authorization: `Bearer ${apiKey}` } : {}) },
      });
      const value = await readJson(response);
      endpoints.push({ path, method, authenticated, httpStatus: response.status, validJson: value !== null });
      return response.ok ? value : null;
    } catch {
      // Do not persist exceptions or supplier error bodies: either can contain credentials.
      endpoints.push({ path, method, authenticated, httpStatus: null, validJson: false, errorCode: 'READ_UNAVAILABLE' });
      return null;
    }
  };

  const catalog = await request(`${root}/models`, '/v1/models', 'GET', true);
  const catalogValid = Array.isArray(catalog?.data) && catalog.data.length <= 2000;
  const modelListed = catalogValid && catalog.data.some(entry => entry?.id === model);
  let advertisedVideo = false;
  let advertisedPricing = null;
  if (publicUrl) {
    const prices = await request(`${publicUrl.origin}/api/pricing`, '/api/pricing', 'GET');
    const rows = Array.isArray(prices?.data) && prices.data.length <= 5000
      ? prices.data.filter(entry => entry?.model_name === model) : [];
    // Conflicting/duplicate public rows cannot establish a unique model contract.
    if (rows.length === 1) {
      const row = rows[0];
      advertisedVideo = Array.isArray(row.supported_endpoint_types)
        && row.supported_endpoint_types.some(type => VIDEO_ENDPOINTS.has(type));
      const validPrice = typeof row.model_price === 'number' && Number.isFinite(row.model_price) && row.model_price >= 0;
      if (advertisedVideo && validPrice && row.quota_type === 1) {
        const specPrices = {};
        if (row.video_spec_prices && typeof row.video_spec_prices === 'object' && !Array.isArray(row.video_spec_prices)) {
          for (const [spec, price] of Object.entries(row.video_spec_prices)) {
            if (/^(480p|720p|1080p|2k|4k)\|(any|\d{1,3})\|(yes|no)$/.test(spec)
              && typeof price === 'number' && Number.isFinite(price) && price >= 0) {
              specPrices[spec] = price;
            }
          }
        }
        advertisedPricing = { modelPrice: row.model_price, quotaType: row.quota_type, specPrices, unitVerified: false };
      }
    }
  }
  for (const path of ['/videos', '/video/generations']) {
    await request(`${root}${path}`, `/v1${path}`, 'OPTIONS', true);
  }
  return {
    checkedAt: new Date().toISOString(), mode: 'read-only', model, endpoints,
    catalogValid, modelListed, advertisedVideo, advertisedPricing,
    // Neither OPTIONS nor public list prices prove POST support or a key-scoped customer quote.
    createProtocolVerified: false, referenceProtocolVerified: false, queryProtocolVerified: false,
    customerQuoteVerified: false, requestBillingVerified: false, readyForPaidExecution: false,
    executionPosts: 0, configurationWrites: 0,
    blockers: [...(!catalogValid ? ['MODEL_CATALOG_UNAVAILABLE'] : !modelListed ? ['MODEL_NOT_LISTED'] : []),
      'VIDEO_PROTOCOL_EVIDENCE_MISSING', 'SUB2API_CUSTOMER_QUOTE_MISSING', 'REQUEST_BILLING_EVIDENCE_MISSING'],
  };
}

async function main() {
  if (!process.argv[2]) throw new Error('VIDEO_PREFLIGHT_OUTPUT_REQUIRED');
  const evidence = await inspectVideoUpstream({
    baseUrl: process.env.VIDEO_PREFLIGHT_BASE_URL, apiKey: process.env.VIDEO_PREFLIGHT_API_KEY,
    model: process.env.VIDEO_PREFLIGHT_MODEL, publicBaseUrl: process.env.VIDEO_PREFLIGHT_PUBLIC_BASE_URL,
  });
  const target = resolve(process.argv[2]);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(evidence));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('VIDEO_PREFLIGHT_FAILED'); process.exitCode = 1; });
}
