import { createHash } from 'node:crypto';
import * as files from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import {
  mediaRealAcceptanceCli, runMediaRealAcceptance,
  type MediaRealAcceptanceOptions,
} from './media-real-acceptance';
import type { MediaRealReceipt } from '../src/shared/media-real.dto';

jest.mock('node:fs/promises', () => ({ mkdir: jest.fn(), open: jest.fn() }));

const time = Date.parse('2026-10-15T00:00:00Z');
const iso = (offset = 30_000) => new Date(time + offset).toISOString();
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
type Operation = 'generate' | 'edit';

function chunk(type: string, data: Buffer): Buffer {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, payload, checksum]);
}

function makePng(width = 1024, height = 1024): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(height * (width * 4 + 1)))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const png = makePng();
const output = {
  outputId: 'output1', kind: 'image' as const, mimeType: 'image/png' as const,
  byteLength: png.length, width: 1024, height: 1024, sha256: digest(png), expiresAt: iso(600_000),
};
const profile = {
  profileId: 'image-profile', configVersion: 'version1', kind: 'image', displayName: 'Image',
  operations: ['generate', 'edit'], executionMode: 'sync-response',
  capabilities: { supportsReferenceImage: true, maxOutputs: 1, sizes: ['1024x1024'], maxWidth: 1024, maxHeight: 1024 },
};
function receipt(operation: Operation, overrides: Partial<MediaRealReceipt> = {}): MediaRealReceipt {
  return {
    mock: false, receiptId: `receipt-${operation}`, clientRequestId: `run1-${operation}`,
    profileId: profile.profileId, configVersion: profile.configVersion, executionMode: 'sync-response',
    status: 'SUCCEEDED', pollAfterMs: null, outputs: [{ ...output }], billingStatus: 'SETTLED',
    errorCode: null, outputErrors: [], recovery: { canQuery: true, canCancel: false, canDownload: true },
    ...overrides,
  };
}
function quote(amountCny = '0.120000') {
  return {
    mock: false, quoteId: 'quote1', expiresAt: iso(), semanticSha256: digest('semantic'), pricingStatus: 'quoted',
    amountCny, pricingVersion: 'price1', billingStatus: 'NOT_RESERVED',
    funding: { creditCny: amountCny, memberWalletCny: '0.000000', personalCny: '0.000000' },
  };
}
function price(operation: Operation) {
  return {
    object: 'sub2api.image_pricing', schema_version: 1, currency: 'USD', model: 'gpt-image-2',
    operation, size: '1024x1024', n: 1, quality: 'medium', billing_mode: 'image', pricing_status: 'quoted',
    pricing_source: 'upstream', amount_usd: '0.01', pricing_version: 'price1', effective_rate_multiplier: 1,
    observed_at: iso(-1000), expires_at: iso(60_000),
  };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
function content(bytes: Buffer = png, headers: Record<string, string> = {}) {
  return new Response(new Uint8Array(bytes), { headers: {
    'Content-Type': 'image/png', 'Content-Length': String(bytes.length),
    'X-SHA256': digest(bytes), 'X-SEP-Media-Mock': 'false', ...headers,
  } });
}

interface Call { url: URL; init: RequestInit; body?: Record<string, any> }
type Override = (call: Call) => Response | undefined | Promise<Response | undefined>;
function harness(override?: Override) {
  const calls: Call[] = [];
  const saved = new Map<Operation, MediaRealReceipt>();
  const claims = new Set<string>();
  const fetcher = jest.fn(async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    const call: Call = { url: new URL(String(input)), init,
      ...(typeof init.body === 'string' ? { body: JSON.parse(init.body) } : {}) };
    calls.push(call);
    const intercepted = await override?.(call);
    if (intercepted) return intercepted;
    const path = call.url.pathname;
    if (path.endsWith('/profiles')) return json({ mock: false, protocolVersion: 1, persistence: 'database', profiles: [profile] });
    if (path.endsWith('/quotes')) return json(quote(), 201);
    if (path === '/v1/sub2api/images/pricing') return json(price(call.body!.operation));
    if (path === '/v1/sub2api/usage') return json({
      object: 'sub2api.request_usage', schema_version: 1, currency: 'USD',
      request_id: call.url.searchParams.get('request_id'), status: 'pending', actual_cost_usd: null,
    });
    if (path.endsWith('/references')) return json({
      mock: false, referenceId: 'reference1', expiresAt: iso(600_000), mimeType: 'image/png',
      byteLength: png.length, sha256: digest(png), width: 1024, height: 1024,
    }, 201);
    if (path.endsWith('/requests') && init.method === 'POST') {
      const operation = call.body!.operation as Operation;
      const result = receipt(operation);
      saved.set(operation, result);
      return json(result);
    }
    if (path.endsWith('/content')) return content();
    const operation = path.endsWith('-edit') ? 'edit' : 'generate';
    const original = saved.get(operation);
    return original ? json(original) : json({ error: 'not found' }, 404);
  });
  const dependencies = {
    fetch: fetcher, clock: jest.fn(() => time), sleep: jest.fn(async (_ms: number) => {}),
    claimSubmission: jest.fn(async (_operation: Operation, id: string) => {
      if (claims.has(id)) return false;
      claims.add(id); return true;
    }),
  };
  return { calls, saved, claims, dependencies };
}
const options: MediaRealAcceptanceOptions = {
  baseUrl: 'http://127.0.0.1:3001', employmentToken: 'synthetic-employment-token',
  upstreamBaseUrl: 'https://upstream.invalid', upstreamApiKey: 'synthetic-upstream-key',
};
const executing = (patch: Partial<MediaRealAcceptanceOptions> = {}): MediaRealAcceptanceOptions => ({
  ...options, execute: true, runId: 'run1', budgetCny: '0.240000', maxPolls: 3, ...patch,
});
const paid = (calls: Call[]) => calls.filter(c => c.url.pathname.endsWith('/requests') && c.init.method === 'POST');

describe('real-image acceptance HTTP runner', () => {
  it('defaults to read-only real profiles, quote, two pricing checks and usage, without submission/upload', async () => {
    const h = harness();
    const result = await runMediaRealAcceptance(options, h.dependencies);
    expect(result.outcome).toBe('read-only');
    expect(result.blockers).toEqual([]);
    expect(result.readiness).toEqual({ profiles: true, generateQuote: true, editQuote: false,
      generatePrice: true, editPrice: true, usageContract: true });
    expect(result.usageProbeProvesSettlement).toBe(false);
    expect(result.electronAccepted).toBe(false);
    expect(h.calls).toHaveLength(5);
    expect(h.calls.every(c => !/references|\/requests/.test(c.url.pathname))).toBe(true);
    expect(h.dependencies.claimSubmission).not.toHaveBeenCalled();
  });

  it('checks an edit quote read-only only with an existing reference, without uploading', async () => {
    const h = harness();
    const result = await runMediaRealAcceptance({ ...options, referenceId: 'reference-existing' }, h.dependencies);
    expect(result.readiness.editQuote).toBe(true);
    expect(h.calls.find(c => c.url.pathname.endsWith('/quotes') && c.body?.operation === 'edit')?.body?.referenceIds)
      .toEqual(['reference-existing']);
    expect(paid(h.calls)).toHaveLength(0);
  });

  it.each(['http://localhost:3001/api/', 'http://127.0.0.1:3001', 'http://[::1]:3001/api'])('accepts loopback %s', async baseUrl => {
    const h = harness();
    expect((await runMediaRealAcceptance({ ...options, baseUrl }, h.dependencies)).readiness.profiles).toBe(true);
    expect(h.calls[0].url.pathname).toBe('/api/gateway/v1/media/real/profiles');
  });

  it.each([
    'https://sep.example', 'http://localhost.example', 'http://192.168.1.2:3001', 'http://0.0.0.0:3001',
    'http://127.0.0.1:3001/other', 'http://127.0.0.1:3001/api?token=secret',
    'http://user:secret@localhost:3001', 'file:///tmp/sep', 'http://localhost:3001/#fragment',
  ])('rejects unsafe SEP URL %s before HTTP', async baseUrl => {
    const h = harness();
    const result = await runMediaRealAcceptance({ ...options, baseUrl }, h.dependencies);
    expect(result.outcome).toBe('blocked'); expect(result.blockers).not.toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it.each([
    [{ budgetCny: undefined }, 'EXPLICIT_BUDGET_REQUIRED'], [{ budgetCny: '0' }, 'EXPLICIT_BUDGET_REQUIRED'],
    [{ budgetCny: '-1' }, 'INVALID_BUDGET'], [{ budgetCny: '0.0000001' }, 'INVALID_BUDGET'],
    [{ budgetCny: '1e2' }, 'INVALID_BUDGET'], [{ runId: undefined }, 'RUN_ID_REQUIRED'],
    [{ runId: '../escape' }, 'RUN_ID_REQUIRED'], [{ resume: true }, 'CONFLICTING_MODE'],
    [{ maxPolls: 121 }, 'INVALID_POLL_LIMIT'], [{ employmentToken: 'header\ninjection' }, 'INVALID_CREDENTIAL'],
    [{ receiptIds: { generate: 'receipt-generate' } }, 'RESUME_MODE_REQUIRED'],
  ] as [Partial<MediaRealAcceptanceOptions>, string][])('requires explicit safe execution options %j', async (patch, code) => {
    const h = harness();
    const result = await runMediaRealAcceptance(executing(patch), h.dependencies);
    expect(result.blockers).toContain(code); expect(h.calls).toHaveLength(0);
  });

  it('requires durable claim injection for execution, not merely opt-in and budget', async () => {
    const h = harness();
    const result = await runMediaRealAcceptance(executing(), { ...h.dependencies, claimSubmission: undefined });
    expect(result.blockers).toContain('DURABLE_SUBMISSION_CLAIM_REQUIRED'); expect(h.calls).toHaveLength(0);
  });

  it('uses real routes and auth, uploads generated PNG, submits exactly once each, and proves downloads/settlement', async () => {
    const h = harness();
    const result = await runMediaRealAcceptance(executing(), h.dependencies);
    expect(result.outcome).toBe('passed'); expect(result.blockers).toEqual([]);
    expect(paid(h.calls).map(c => c.body?.clientRequestId)).toEqual(['run1-generate', 'run1-edit']);
    for (const call of paid(h.calls)) {
      expect(call.body?.parameters).toEqual({ size: '1024x1024', count: 1, quality: 'medium' });
      expect(call.body?.referenceIds).toEqual(call.body?.operation === 'edit' ? ['reference1'] : []);
    }
    const upload = h.calls.find(c => c.url.pathname.endsWith('/references'))!;
    expect(upload.init.body).toBeInstanceOf(FormData);
    const file = (upload.init.body as FormData).get('file') as Blob;
    expect(Buffer.from(await file.arrayBuffer())).toEqual(png);
    expect(new Headers(upload.init.headers).has('Content-Type')).toBe(false);
    for (const call of h.calls) {
      expect(call.init.redirect).toBe('error'); expect(call.init.credentials).toBe('omit');
      expect(new Headers(call.init.headers).get('authorization')).toBe(`Bearer ${
        call.url.hostname === 'upstream.invalid' ? options.upstreamApiKey : options.employmentToken}`);
      expect(call.init.signal).toBeDefined();
      expect(call.url.pathname).toMatch(/^\/(api\/gateway\/v1\/media\/real|v1\/sub2api)\//);
    }
    expect(result.operations.every(op => op.billingStatus === 'SETTLED' && op.submissionPosts === 1)).toBe(true);
    expect(result.operations[0].download).toEqual({ sha256: digest(png), byteLength: png.length, width: 1024, height: 1024 });
    expect(h.dependencies.claimSubmission.mock.calls).toEqual([['generate', 'run1-generate'], ['edit', 'run1-edit']]);
    const serialized = JSON.stringify(result);
    for (const sensitive of [options.employmentToken, options.upstreamApiKey, 'run1-generate', 'receipt-generate', 'ceramic mug', 'creativeBrief', 'rawbody']) {
      expect(serialized).not.toContain(sensitive);
    }
  });

  it.each([['0.119999', 0], ['0.239999', 1], ['0.240000', 2]] as const)(
    'enforces exact total micro-CNY budget %s without rounding', async (budgetCny, count) => {
      const h = harness();
      const result = await runMediaRealAcceptance(executing({ budgetCny }), h.dependencies);
      expect(paid(h.calls)).toHaveLength(count);
      expect(result.blockers).toEqual(count === 2 ? [] : ['BUDGET_EXCEEDED']);
      expect(h.dependencies.claimSubmission).toHaveBeenCalledTimes(count);
    },
  );

  it.each([
    { billing_mode: 'token' }, { pricing_status: 'unavailable' }, { amount_usd: null }, { amount_usd: '000.00' },
    { pricing_source: 'fallback-v1' }, { pricing_source: 'default' }, { expires_at: iso(-1) },
    { expires_at: iso(120_001) }, { observed_at: iso(5001) }, { model: 'other' }, { n: 2 },
    { size: '1x1' }, { quality: 'high' }, { operation: 'other' },
  ])('blocks all submissions on unsupported/unready upstream pricing %j', async patch => {
    const h = harness(c => c.url.pathname.endsWith('/images/pricing') ? json({ ...price(c.body!.operation), ...patch }) : undefined);
    const result = await runMediaRealAcceptance(executing(), h.dependencies);
    expect(result.blockers.length).toBeGreaterThan(0); expect(paid(h.calls)).toHaveLength(0);
  });

  it('does not substitute legacy pricing, missing readiness credentials, or fake settled probe usage', async () => {
    const h = harness(c => c.url.pathname.endsWith('/sub2api/usage') ? json({
      object: 'sub2api.request_usage', schema_version: 1, currency: 'USD',
      request_id: 'sep-media-acceptance-readiness', status: 'settled', actual_cost_usd: '0.01',
    }) : undefined);
    const result = await runMediaRealAcceptance(executing(), h.dependencies);
    expect(result.readiness.usageContract).toBe(false); expect(paid(h.calls)).toHaveLength(0);
    const missing = harness();
    expect((await runMediaRealAcceptance(executing({ upstreamApiKey: undefined }), missing.dependencies)).blockers)
      .toContain('UPSTREAM_READINESS_CONFIG_REQUIRED');
    expect(paid(missing.calls)).toHaveLength(0);
  });

  it.each([200, 202])('accepts request status %i including async settlement polling', async status => {
    const h = harness(c => {
      if (c.url.pathname.endsWith('/requests') && c.init.method === 'POST') {
        const operation = c.body!.operation as Operation;
        h.saved.set(operation, receipt(operation));
        return json(receipt(operation, { status: 'RUNNING', outputs: [], billingStatus: 'RESERVED', pollAfterMs: 2000 }), status);
      }
      return undefined;
    });
    const result = await runMediaRealAcceptance(executing(), h.dependencies);
    expect(result.outcome).toBe('passed'); expect(paid(h.calls)).toHaveLength(2);
    expect(h.calls.filter(c => /\/requests\/receipt-/.test(c.url.pathname) && !c.url.pathname.endsWith('/content'))).toHaveLength(2);
  });

  it.each(['timeout', '503', '201', 'invalid-json', 'unknown'])(
    'recovers uncertain %s submission via by-client-id, never repeating the chargeable POST', async kind => {
      const h = harness(c => {
        if (!c.url.pathname.endsWith('/requests') || c.init.method !== 'POST') return undefined;
        const operation = c.body!.operation as Operation;
        h.saved.set(operation, receipt(operation));
        if (kind === 'timeout') throw new Error('synthetic-employment-token raw response prompt');
        if (kind === 'unknown') return json(receipt(operation, {
          status: 'SUBMISSION_UNKNOWN', errorCode: 'SUBMISSION_UNKNOWN', outputs: [], billingStatus: 'RECONCILING',
        }), 202);
        if (kind === 'invalid-json') return new Response('bad synthetic-upstream-key', { headers: { 'Content-Type': 'application/json' } });
        return json(receipt(operation), Number(kind));
      });
      const result = await runMediaRealAcceptance(executing(), h.dependencies);
      expect(result.outcome).toBe('passed'); expect(paid(h.calls)).toHaveLength(2);
      expect(h.calls.filter(c => c.url.pathname.includes('/by-client-id/'))).toHaveLength(4);
      expect(JSON.stringify(result)).not.toContain('synthetic-');
    },
  );

  it('does not resubmit after an unknown POST, even when recovery stays 404', async () => {
    const h = harness(c => c.url.pathname.endsWith('/requests') && c.init.method === 'POST' ? json({}, 503) : undefined);
    const result = await runMediaRealAcceptance(executing(), h.dependencies);
    expect(result.outcome).toBe('incomplete'); expect(result.blockers).toContain('RECOVERY_OR_SETTLEMENT_PENDING');
    expect(paid(h.calls)).toHaveLength(1);
    expect(h.calls.filter(c => c.url.pathname.includes('/by-client-id/'))).toHaveLength(4);
    expect(h.calls.some(c => c.url.pathname.endsWith('/references'))).toBe(false);
  });

  it.each(['existing', 'claimed'])('makes repeated IDs query-only (%s), with no reference upload or new edit', async kind => {
    const h = harness();
    h.saved.set('edit', receipt('edit'));
    if (kind === 'existing') h.saved.set('generate', receipt('generate'));
    else h.claims.add('run1-generate');
    const result = await runMediaRealAcceptance(executing(), h.dependencies);
    expect(paid(h.calls)).toHaveLength(0);
    expect(h.calls.some(c => c.url.pathname.endsWith('/references'))).toBe(false);
    expect(result.outcome).toBe(kind === 'existing' ? 'passed' : 'incomplete');
  });

  it('a second invocation with the same IDs never resubmits', async () => {
    const h = harness();
    expect((await runMediaRealAcceptance(executing(), h.dependencies)).outcome).toBe('passed');
    expect((await runMediaRealAcceptance(executing(), h.dependencies)).outcome).toBe('passed');
    expect(paid(h.calls)).toHaveLength(2);
    expect(h.calls.filter(c => c.url.pathname.endsWith('/references'))).toHaveLength(1);
  });

  it('claim failure never permits a paid request', async () => {
    const h = harness();
    h.dependencies.claimSubmission.mockRejectedValue(new Error('private filesystem error'));
    const result = await runMediaRealAcceptance(executing(), h.dependencies);
    expect(paid(h.calls)).toHaveLength(0); expect(result.blockers).toEqual(['ACCEPTANCE_UNAVAILABLE']);
  });

  it('checks quote expiry again after durable claim', async () => {
    const h = harness();
    h.dependencies.claimSubmission.mockImplementation(async () => {
      h.dependencies.clock.mockReturnValue(time + 31_000); return true;
    });
    const result = await runMediaRealAcceptance(executing(), h.dependencies);
    expect(result.blockers).toContain('QUOTE_EXPIRED'); expect(paid(h.calls)).toHaveLength(0);
  });

  it.each([
    [{ expiresAt: iso(-1) }, 201], [{ expiresAt: iso(60_001) }, 201],
    [{ amountCny: '0.000000' }, 201], [{ amountCny: '0.120001' }, 201],
    [{ mock: true }, 201], [{ billingStatus: 'RESERVED' }, 201], [{}, 200],
  ] as [Record<string, unknown>, number][])('rejects invalid quote data/status %j / %i before charging', async (patch, status) => {
    const h = harness(c => c.url.pathname.endsWith('/quotes') ? json({ ...quote(), ...patch }, status) : undefined);
    const result = await runMediaRealAcceptance(executing(), h.dependencies);
    expect(result.blockers.length).toBeGreaterThan(0); expect(paid(h.calls)).toHaveLength(0);
  });

  it.each([
    [{ sha256: '0'.repeat(64) }, 201], [{ byteLength: 1 }, 201], [{ width: 1 }, 201],
    [{ expiresAt: iso(-1) }, 201], [{ mock: true }, 201], [{}, 200],
  ] as [Record<string, unknown>, number][])('rejects invalid reference data/status %j / %i before edit', async (patch, status) => {
    const h = harness(c => c.url.pathname.endsWith('/references') ? json({
      mock: false, referenceId: 'reference1', expiresAt: iso(), mimeType: 'image/png',
      byteLength: png.length, sha256: digest(png), width: 1024, height: 1024, ...patch,
    }, status) : undefined);
    const result = await runMediaRealAcceptance(executing(), h.dependencies);
    expect(result.outcome).toBe('incomplete'); expect(paid(h.calls)).toHaveLength(1);
    expect(result.operations[1].submissionPosts).toBe(0);
  });

  it('resume only queries/downloads original receipts without budget, profiles, quote, readiness or auth bypass', async () => {
    const h = harness();
    h.saved.set('generate', receipt('generate')); h.saved.set('edit', receipt('edit'));
    const result = await runMediaRealAcceptance({
      baseUrl: options.baseUrl, employmentToken: options.employmentToken, resume: true, runId: 'run1',
      receiptIds: { generate: 'receipt-generate', edit: 'receipt-edit' }, maxPolls: 2,
    }, h.dependencies);
    expect(result.outcome).toBe('passed');
    expect(h.calls).toHaveLength(4); expect(h.calls.every(c => c.init.method === 'GET')).toBe(true);
    expect(h.calls.every(c => c.url.pathname.includes('/requests/receipt-'))).toBe(true);
    expect(h.dependencies.claimSubmission).not.toHaveBeenCalled();
  });

  it('resume by client ID tolerates initial 404 and independently recovers edit if generate fails', async () => {
    const h = harness();
    h.saved.set('edit', receipt('edit'));
    const result = await runMediaRealAcceptance({ ...options, resume: true, runId: 'run1', maxPolls: 2 }, h.dependencies);
    expect(result.outcome).toBe('incomplete'); expect(result.operations[1].billingStatus).toBe('SETTLED');
    expect(h.calls.filter(c => c.url.pathname.endsWith('/by-client-id/run1-generate'))).toHaveLength(2);
    expect(paid(h.calls)).toHaveLength(0);
  });

  it.each(['SUBMISSION_UNKNOWN', 'BILLING_PENDING'] as const)('keeps by-client-id recovery for unknown status/error %s', async errorCode => {
    let queries = 0;
    const h = harness(c => {
      if (c.url.pathname.endsWith('/by-client-id/run1-generate') && ++queries <= 2) {
        return json(receipt('generate', { status: 'SUBMISSION_UNKNOWN', errorCode, outputs: [], billingStatus: 'RECONCILING', pollAfterMs: 4000 }));
      }
      return undefined;
    });
    h.saved.set('generate', receipt('generate')); h.saved.set('edit', receipt('edit'));
    const result = await runMediaRealAcceptance({ ...options, resume: true, runId: 'run1', maxPolls: 3 }, h.dependencies);
    expect(result.outcome).toBe('passed'); expect(queries).toBe(3);
    expect(h.dependencies.sleep).toHaveBeenCalledWith(4000);
    expect(h.calls.some(c => c.url.pathname.endsWith('/requests/receipt-generate'))).toBe(false);
  });

  it('waits for SETTLED and downloads an unchanged output only once', async () => {
    const h = harness(c => {
      if (c.url.pathname.endsWith('/requests') && c.init.method === 'POST') {
        const operation = c.body!.operation as Operation;
        h.saved.set(operation, receipt(operation));
        return json(receipt(operation, { billingStatus: 'RECONCILING' }));
      }
      return undefined;
    });
    const result = await runMediaRealAcceptance(executing(), h.dependencies);
    expect(result.outcome).toBe('passed'); expect(h.dependencies.sleep).toHaveBeenCalledTimes(2);
    expect(h.calls.filter(c => c.url.pathname.endsWith('/content'))).toHaveLength(2);
  });

  it('does not claim acceptance if billing remains RESERVED', async () => {
    const h = harness();
    h.saved.set('generate', receipt('generate', { billingStatus: 'RESERVED' }));
    h.saved.set('edit', receipt('edit'));
    const result = await runMediaRealAcceptance({ ...options, resume: true, runId: 'run1', maxPolls: 2 }, h.dependencies);
    expect(result.outcome).toBe('incomplete'); expect(result.blockers).toContain('RECOVERY_OR_SETTLEMENT_PENDING');
    expect(h.calls.filter(c => c.url.pathname.includes('/receipt-generate/outputs/'))).toHaveLength(1);
  });

  it('rejects a changed output descriptor after downloading before settlement', async () => {
    const h = harness(c => {
      if (c.url.pathname.endsWith('/requests') && c.init.method === 'POST') {
        h.saved.set('generate', receipt('generate', { outputs: [{ ...output, outputId: 'changed' }] }));
        return json(receipt('generate', { billingStatus: 'RESERVED' }));
      }
      return undefined;
    });
    const result = await runMediaRealAcceptance(executing(), h.dependencies);
    expect(result.blockers).toContain('OUTPUT_CHANGED_DURING_SETTLEMENT'); expect(paid(h.calls)).toHaveLength(1);
  });

  it('rejects recovered profile/config mismatch even after an uncertain response', async () => {
    const h = harness(c => {
      if (c.url.pathname.endsWith('/requests') && c.init.method === 'POST') {
        h.saved.set('generate', receipt('generate', { configVersion: 'unexpected' }));
        return json({}, 503);
      }
      return undefined;
    });
    const result = await runMediaRealAcceptance(executing(), h.dependencies);
    expect(result.blockers).toContain('RECEIPT_IDENTITY_MISMATCH'); expect(paid(h.calls)).toHaveLength(1);
    expect(h.calls.some(c => c.url.pathname.endsWith('/content'))).toBe(false);
  });

  it.each(['FAILED', 'CANCELLED', 'RESULT_EXPIRED', 'PARTIAL_SUCCEEDED'] as const)('rejects terminal status %s without replay', async status => {
    const h = harness(); h.saved.set('generate', receipt('generate', { status })); h.saved.set('edit', receipt('edit'));
    const result = await runMediaRealAcceptance({ ...options, resume: true, runId: 'run1', maxPolls: 1 }, h.dependencies);
    expect(result.blockers).toContain('EXECUTION_NOT_SUCCESSFUL'); expect(paid(h.calls)).toHaveLength(0);
  });

  it.each([
    { clientRequestId: 'other-id' }, { receiptId: 'other-receipt' }, { mock: true },
    { outputs: [output, output] }, { outputs: [{ ...output, width: 1 }] },
  ])('rejects invalid original receipt identity/output %j', async patch => {
    const h = harness(c => c.url.pathname.endsWith('/requests/receipt-generate') ? json({ ...receipt('generate'), ...patch }) : undefined);
    h.saved.set('edit', receipt('edit'));
    const result = await runMediaRealAcceptance({ ...options, resume: true, runId: 'run1',
      receiptIds: { generate: 'receipt-generate' }, maxPolls: 1 }, h.dependencies);
    expect(result.outcome).toBe('incomplete'); expect(result.blockers.length).toBeGreaterThan(0);
  });

  it.each([
    ['mime', () => content(png, { 'Content-Type': 'application/octet-stream' }), 'INVALID_DOWNLOAD_HEADERS'],
    ['length', () => content(png, { 'Content-Length': '1' }), 'INVALID_DOWNLOAD_HEADERS'],
    ['hash', () => content(png, { 'X-SHA256': '0'.repeat(64) }), 'INVALID_DOWNLOAD_HEADERS'],
    ['mock', () => content(png, { 'X-SEP-Media-Mock': 'true' }), 'INVALID_DOWNLOAD_HEADERS'],
    ['truncated', () => content(png.subarray(0, -1), { 'Content-Length': String(png.length), 'X-SHA256': digest(png) }), 'DOWNLOAD_INTEGRITY_FAILED'],
    ['corrupt', () => content(Buffer.alloc(png.length), { 'X-SHA256': digest(png) }), 'DOWNLOAD_INTEGRITY_FAILED'],
    ['oversize', () => content(Buffer.alloc(png.length + 1), { 'Content-Length': String(png.length), 'X-SHA256': digest(png) }), 'RESPONSE_TOO_LARGE'],
  ] as [string, () => Response, string][])('rejects %s PNG download', async (_label, response, code) => {
    const h = harness(c => c.url.pathname.endsWith('/content') ? response() : undefined);
    const result = await runMediaRealAcceptance(executing(), h.dependencies);
    expect(result.blockers).toContain(code); expect(paid(h.calls)).toHaveLength(1);
  });

  it.each(['not-png', 'wrong-dimensions'])('validates decoded PNG, not just matching hash (%s)', async kind => {
    const bytes = kind === 'not-png' ? Buffer.from('invalid PNG') : makePng(1, 1);
    const h = harness(c => {
      if (c.url.pathname.endsWith('/content')) return content(bytes);
      if (c.url.pathname.endsWith('/requests') && c.init.method === 'POST') return json(receipt('generate', {
        outputs: [{ ...output, sha256: digest(bytes), byteLength: bytes.length }],
      }));
      return undefined;
    });
    const result = await runMediaRealAcceptance(executing(), h.dependencies);
    expect(result.blockers).toContain(kind === 'not-png' ? 'INVALID_PNG' : 'INVALID_OUTPUT');
    expect(paid(h.calls)).toHaveLength(1);
  });

  it.each([
    () => new Response('private body', { status: 302, headers: { Location: 'https://elsewhere.invalid' } }),
    () => new Response('synthetic-employment-token', { headers: { 'Content-Type': 'text/plain' } }),
    () => new Response('x'.repeat(65 * 1024), { headers: { 'Content-Type': 'application/json' } }),
  ])('bounds JSON and never exposes untrusted response bodies', async response => {
    const h = harness(c => c.url.pathname.endsWith('/profiles') ? response() : undefined);
    const result = await runMediaRealAcceptance(executing(), h.dependencies);
    expect(result.blockers.length).toBeGreaterThan(0); expect(paid(h.calls)).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain('synthetic-employment-token');
    expect(JSON.stringify(result)).not.toContain('private body');
  });
});

describe('CLI safety boundary (filesystem and HTTP injected by Jest)', () => {
  const openMock = jest.mocked(files.open);
  const mkdirMock = jest.mocked(files.mkdir);
  const environment: NodeJS.ProcessEnv = {
    SEP_BASE_URL: options.baseUrl, SEP_EMPLOYMENT_TOKEN: options.employmentToken,
    MEDIA_BASE_URL: options.upstreamBaseUrl, MEDIA_API_KEY: options.upstreamApiKey,
    MEDIA_REAL_ACCEPTANCE_RUN_ID: 'run1', MEDIA_REAL_ACCEPTANCE_OUTPUT: '/synthetic/evidence.json',
  };
  const handle = () => ({ writeFile: jest.fn(async (_text: string) => {}), sync: jest.fn(async () => {}), close: jest.fn(async () => {}) });
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;
  let oldExitCode: typeof process.exitCode;
  beforeEach(() => {
    oldExitCode = process.exitCode; process.exitCode = 0;
    stdout = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    openMock.mockReset(); mkdirMock.mockReset(); mkdirMock.mockResolvedValue(undefined);
  });
  afterEach(() => { jest.restoreAllMocks(); process.exitCode = oldExitCode; });

  it('defaults to no paid execution and writes only sanitized evidence with wx/0600', async () => {
    const h = harness(); const evidence = handle();
    jest.spyOn(globalThis, 'fetch').mockImplementation(h.dependencies.fetch);
    jest.spyOn(Date, 'now').mockReturnValue(time);
    openMock.mockResolvedValue(evidence as unknown as Awaited<ReturnType<typeof files.open>>);
    await mediaRealAcceptanceCli(environment);
    expect(paid(h.calls)).toHaveLength(0);
    expect(openMock).toHaveBeenCalledWith('/synthetic/evidence.json', 'wx', 0o600);
    expect(openMock).toHaveBeenCalledTimes(1);
    const text = evidence.writeFile.mock.calls[0][0];
    expect(JSON.parse(text).mode).toBe('read-only');
    expect(text).not.toContain(environment.SEP_EMPLOYMENT_TOKEN);
    expect(text).not.toContain(environment.MEDIA_API_KEY);
    expect(evidence.sync).toHaveBeenCalled(); expect(evidence.close).toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledWith(text); expect(stderr).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it('syncs durable marker file and directory before either paid POST', async () => {
    const h = harness(c => {
      if (c.url.pathname.endsWith('/requests') && c.init.method === 'POST') {
        expect(markers).toHaveLength(c.body!.operation === 'generate' ? 1 : 2);
        for (const marker of markers) expect(marker.sync).toHaveBeenCalled();
        for (const directory of directories) expect(directory.sync).toHaveBeenCalled();
        expect(directories).toHaveLength(markers.length * 2);
      }
      return undefined;
    });
    const markers: ReturnType<typeof handle>[] = [];
    const directories: ReturnType<typeof handle>[] = [];
    const evidence = handle();
    jest.spyOn(globalThis, 'fetch').mockImplementation(h.dependencies.fetch);
    jest.spyOn(Date, 'now').mockReturnValue(time);
    openMock.mockImplementation(async (path, flags, mode) => {
      if (String(path) === environment.MEDIA_REAL_ACCEPTANCE_OUTPUT) return evidence as any;
      const current = handle();
      if (flags === 'r') directories.push(current);
      else {
        markers.push(current); expect(mode).toBe(0o600); expect(flags).toBe('wx');
        expect(String(path)).toMatch(/media-real-acceptance-attempts\/[a-f0-9]{64}\.json$/);
      }
      return current as any;
    });
    await mediaRealAcceptanceCli({ ...environment, MEDIA_REAL_ACCEPTANCE_EXECUTE: 'true', MEDIA_REAL_ACCEPTANCE_BUDGET_CNY: '0.24' });
    expect(paid(h.calls)).toHaveLength(2);
    for (const marker of markers) expect(marker.writeFile).toHaveBeenCalledWith('{"submissionAttempted":true}\n');
    expect(process.exitCode).toBe(0);
  });

  it('an existing marker makes the ID query-only even with a different evidence output', async () => {
    const h = harness();
    jest.spyOn(globalThis, 'fetch').mockImplementation(h.dependencies.fetch);
    jest.spyOn(Date, 'now').mockReturnValue(time);
    jest.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void) => {
      callback(); return {};
    }) as unknown as typeof setTimeout);
    openMock.mockImplementation(async (path, flags) => {
      if (String(path).endsWith('other-evidence.json')) return handle() as any;
      if (flags === 'r') return handle() as any;
      expect(String(path)).toMatch(/media-real-acceptance-attempts\/[a-f0-9]{64}\.json$/);
      throw Object.assign(new Error('synthetic-upstream-key'), { code: 'EEXIST' });
    });
    await mediaRealAcceptanceCli({ ...environment, MEDIA_REAL_ACCEPTANCE_OUTPUT: '/synthetic/other-evidence.json',
      MEDIA_REAL_ACCEPTANCE_EXECUTE: 'true', MEDIA_REAL_ACCEPTANCE_BUDGET_CNY: '0.24' });
    expect(paid(h.calls)).toHaveLength(0); expect(process.exitCode).toBe(1);
    expect(String(stdout.mock.calls[0][0])).not.toContain('synthetic-');
  });

  it('requires evidence output, never overwrites it, and suppresses filesystem errors/credentials', async () => {
    const h = harness(); jest.spyOn(globalThis, 'fetch').mockImplementation(h.dependencies.fetch);
    await mediaRealAcceptanceCli({ ...environment, MEDIA_REAL_ACCEPTANCE_OUTPUT: undefined });
    expect(openMock).not.toHaveBeenCalled(); expect(h.calls).toHaveLength(0);
    openMock.mockRejectedValue(new Error('synthetic-upstream-key private path'));
    await mediaRealAcceptanceCli(environment);
    expect(stderr.mock.calls).toEqual([['MEDIA_REAL_ACCEPTANCE_CLI_FAILED\n'], ['MEDIA_REAL_ACCEPTANCE_CLI_FAILED\n']]);
    expect(stdout).not.toHaveBeenCalled(); expect(process.exitCode).toBe(1);
  });
});
