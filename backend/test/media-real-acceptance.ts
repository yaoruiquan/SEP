import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { MediaRuntimeProfileSchema } from '../src/shared/media.dto';
import { MediaGatewayIdSchema } from '../src/shared/media-gateway.dto';
import {
  MediaRealQuoteSchema, MediaRealReceiptSchema, MediaRealReferenceSchema,
  type MediaRealQuoteRequest, type MediaRealReceipt,
} from '../src/shared/media-real.dto';
import { inspectMediaPng } from '../src/modules/media-gateway/media-png';

/**
 * From the repository root: pnpm --dir backend exec tsx test/media-real-acceptance.ts
 * Existing process environment only; never loads dotenv or accepts credentials as CLI arguments.
 * Required: SEP_BASE_URL (loopback), SEP_EMPLOYMENT_TOKEN, MEDIA_REAL_ACCEPTANCE_OUTPUT (new file).
 * Readiness also requires MEDIA_BASE_URL and MEDIA_API_KEY (read-only pricing/usage endpoints).
 * Optional read-only edit quote: MEDIA_REAL_ACCEPTANCE_REFERENCE_ID (existing scoped reference).
 * Execute: MEDIA_REAL_ACCEPTANCE_EXECUTE=true, MEDIA_REAL_ACCEPTANCE_RUN_ID (stable),
 * MEDIA_REAL_ACCEPTANCE_BUDGET_CNY (explicit total cap for generate + edit, six decimals maximum).
 * Recover: MEDIA_REAL_ACCEPTANCE_RESUME=true, same RUN_ID, no EXECUTE or budget needed.
 * Optional original IDs: MEDIA_REAL_ACCEPTANCE_GENERATE_RECEIPT_ID / _EDIT_RECEIPT_ID.
 * Each invocation needs a new evidence filename. Never delete attempt markers to retry an ID.
 * No SEP startup, login, fixtures, DB access, direct upstream image calls, or Electron acceptance.
 */
type Operation = 'generate' | 'edit';
const operations: Operation[] = ['generate', 'edit'];
const parameters = { size: '1024x1024', count: 1, quality: 'medium' } as const;
const briefs: Record<Operation, string> = {
  generate: 'Create a studio product photograph of a plain red ceramic mug on a white background, without text.',
  edit: 'Change the mug color to blue while preserving composition and the white background.',
};
const root = '/gateway/v1/media/real';
const probeId = 'sep-media-acceptance-readiness';
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const profilesSchema = z.object({
  mock: z.literal(false), protocolVersion: z.literal(1), persistence: z.literal('database'),
  profiles: z.array(MediaRuntimeProfileSchema).max(100),
}).strict();
const priceSchema = z.object({
  object: z.literal('sub2api.image_pricing'), schema_version: z.literal(1), currency: z.literal('USD'),
  model: z.literal('gpt-image-2'), operation: z.enum(['generate', 'edit']), size: z.literal('1024x1024'),
  n: z.literal(1), quality: z.literal('medium'), billing_mode: z.enum(['image', 'per_request']),
  pricing_status: z.literal('quoted'), pricing_source: z.string().trim().min(1),
  amount_usd: z.string().regex(/^\d+(?:\.\d{1,12})?$/), pricing_version: z.string().trim().min(1).max(128),
  effective_rate_multiplier: z.number().finite().nonnegative(),
  observed_at: z.string().datetime({ offset: true }), expires_at: z.string().datetime({ offset: true }),
});
const usageProbeSchema = z.object({
  object: z.literal('sub2api.request_usage'), schema_version: z.literal(1), currency: z.literal('USD'),
  request_id: z.literal(probeId), status: z.literal('pending'), actual_cost_usd: z.null(),
});

export interface MediaRealAcceptanceOptions {
  /** SEP origin, optionally ending in /api. Never an upstream URL. */
  baseUrl: string;
  employmentToken: string;
  upstreamBaseUrl?: string;
  upstreamApiKey?: string;
  execute?: boolean;
  resume?: boolean;
  /** Required for execute/resume; identifies the same two client IDs across restarts. */
  runId?: string;
  /** Total maximum quoted CNY for both operations, not a per-image allowance. */
  budgetCny?: string;
  /** An already-uploaded reference for an optional read-only edit quote. */
  referenceId?: string;
  receiptIds?: Partial<Record<Operation, string>>;
  maxPolls?: number;
}

export interface MediaRealAcceptanceDependencies {
  fetch?: typeof fetch;
  clock?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Must durably claim an ID before returning true. False means query-only forever. */
  claimSubmission?: (operation: Operation, clientRequestId: string) => Promise<boolean>;
}

interface OperationEvidence {
  operation: Operation;
  clientRequestIdSha256?: string;
  receiptIdSha256?: string;
  quoteAmountCny?: string;
  submissionPosts: number;
  status?: MediaRealReceipt['status'];
  billingStatus?: MediaRealReceipt['billingStatus'];
  download?: { sha256: string; byteLength: number; width: number; height: number };
}

export interface MediaRealAcceptanceEvidence {
  schemaVersion: 1;
  mode: 'read-only' | 'execute' | 'resume';
  outcome: 'read-only' | 'passed' | 'blocked' | 'incomplete';
  budgetCny: string | null;
  readiness: { profiles: boolean; generateQuote: boolean; editQuote: boolean;
    generatePrice: boolean; editPrice: boolean; usageContract: boolean };
  /** A pending diagnostic usage response does not prove any real request was billed. */
  usageProbeProvesSettlement: false;
  electronAccepted: false;
  operations: OperationEvidence[];
  checks: { route: string; method: string; status: number | null }[];
  blockers: string[];
}

class AcceptanceFailure extends Error {
  constructor(readonly code: string) { super(code); }
}
function fail(code: string): never { throw new AcceptanceFailure(code); }
function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) fail('INVALID_CONTRACT');
  return result.data;
}
function money(value: string): bigint {
  if (typeof value !== 'string' || !/^\d{1,12}(?:\.\d{1,6})?$/.test(value)) fail('INVALID_BUDGET');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}
function formatMoney(value: bigint): string {
  return `${value / 1_000_000n}.${String(value % 1_000_000n).padStart(6, '0')}`;
}
function apiUrl(input: string, sep: boolean): string {
  let url: URL;
  try { url = new URL(input); } catch { fail('INVALID_BASE_URL'); }
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) fail('INVALID_BASE_URL');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const path = url.pathname.replace(/\/+$/, '');
  if (sep && (!loopback || !['', '/api'].includes(path))) fail('SEP_LOOPBACK_REQUIRED');
  if (!sep && (url.protocol !== 'https:' && !loopback)) fail('UPSTREAM_HTTPS_REQUIRED');
  if (!sep && !['', '/v1'].includes(path)) fail('INVALID_BASE_URL');
  return `${url.origin}${sep ? '/api' : '/v1'}`;
}
function credential(value: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 8192 || /[\s\x00-\x1f\x7f]/.test(value)) fail('INVALID_CREDENTIAL');
  return value;
}
async function boundedBytes(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) fail('INVALID_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) fail('RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(part.value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** No login, DB, mock routes, environment loading, or upstream image dispatch. */
export async function runMediaRealAcceptance(
  options: MediaRealAcceptanceOptions,
  dependencies: MediaRealAcceptanceDependencies = {},
): Promise<MediaRealAcceptanceEvidence> {
  const evidence: MediaRealAcceptanceEvidence = {
    schemaVersion: 1, mode: options.resume ? 'resume' : options.execute ? 'execute' : 'read-only',
    outcome: 'blocked', budgetCny: null,
    readiness: { profiles: false, generateQuote: false, editQuote: false,
      generatePrice: false, editPrice: false, usageContract: false },
    usageProbeProvesSettlement: false, electronAccepted: false,
    operations: operations.map(operation => ({ operation, submissionPosts: 0 })), checks: [], blockers: [],
  };
  const fetchImpl = dependencies.fetch ?? fetch;
  const now = dependencies.clock ?? Date.now;
  const sleep = dependencies.sleep ?? (ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms)));
  let recoveryStarted = false;
  const addBlocker = (error: unknown) => {
    const code = error instanceof AcceptanceFailure ? error.code : 'ACCEPTANCE_UNAVAILABLE';
    if (!evidence.blockers.includes(code)) evidence.blockers.push(code);
  };
  try {
    const sep = apiUrl(options.baseUrl, true);
    const token = credential(options.employmentToken);
    if (options.execute && options.resume) fail('CONFLICTING_MODE');
    const maxPolls = options.maxPolls ?? 60;
    if (!Number.isInteger(maxPolls) || maxPolls < 1 || maxPolls > 120) fail('INVALID_POLL_LIMIT');
    if (options.execute || options.resume) {
      if (!options.runId || !/^[a-zA-Z0-9_-]{1,100}$/.test(options.runId)) fail('RUN_ID_REQUIRED');
      for (const op of evidence.operations) op.clientRequestIdSha256 = sha256(`${options.runId}-${op.operation}`);
    }
    const budget = options.budgetCny === undefined ? null : money(options.budgetCny);
    evidence.budgetCny = budget === null ? null : formatMoney(budget);
    if (options.execute && (budget === null || budget <= 0n)) fail('EXPLICIT_BUDGET_REQUIRED');
    if (options.execute && !dependencies.claimSubmission) fail('DURABLE_SUBMISSION_CLAIM_REQUIRED');
    if (options.receiptIds && !options.resume) fail('RESUME_MODE_REQUIRED');
    if (options.referenceId) parsed(MediaGatewayIdSchema, options.referenceId);
    for (const id of Object.values(options.receiptIds ?? {})) parsed(MediaGatewayIdSchema, id);

    const http = async (route: string, url: string, auth: string, method = 'GET', body?: BodyInit, multipart = false) => {
      const check = { route, method, status: null as number | null };
      evidence.checks.push(check);
      try {
        const response = await fetchImpl(url, {
          method, redirect: 'error', credentials: 'omit',
          headers: { Authorization: `Bearer ${auth}`, Accept: route.endsWith('content') ? 'image/png' : 'application/json',
            ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}) },
          body, signal: AbortSignal.timeout(route.endsWith('request') ? 200_000 : 15_000),
        });
        check.status = response.status;
        return response;
      } catch { fail('HTTP_UNAVAILABLE'); }
    };
    const json = async (route: string, url: string, auth: string, statuses: number[], method = 'GET', body?: BodyInit, multipart = false) => {
      const response = await http(route, url, auth, method, body, multipart);
      if (!statuses.includes(response.status) || response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
        await response.body?.cancel().catch(() => {});
        fail('HTTP_CONTRACT_UNAVAILABLE');
      }
      try { return JSON.parse((await boundedBytes(response, 64 * 1024)).toString('utf8')) as unknown; }
      catch (error) { if (error instanceof AcceptanceFailure) throw error; fail('INVALID_RESPONSE'); }
    };
    const readReceipt = (value: unknown, clientId: string, expectedId?: string) => {
      const receipt = parsed(MediaRealReceiptSchema, value);
      if (receipt.clientRequestId !== clientId || (expectedId && receipt.receiptId !== expectedId)) fail('RECEIPT_IDENTITY_MISMATCH');
      if (receipt.outputs.length > 1) fail('UNEXPECTED_OUTPUT_COUNT');
      return receipt;
    };
    const download = async (op: OperationEvidence, receipt: MediaRealReceipt): Promise<Buffer> => {
      const output = receipt.outputs[0];
      if (!output || output.width !== 1024 || output.height !== 1024 || output.byteLength > 25 * 1024 * 1024) fail('INVALID_OUTPUT');
      const response = await http(`${op.operation}_content`, `${sep}${root}/requests/${receipt.receiptId}/outputs/${output.outputId}/content`, token);
      if (response.status !== 200 || response.headers.get('content-type') !== 'image/png' ||
        response.headers.get('x-sep-media-mock') !== 'false' || response.headers.get('x-sha256') !== output.sha256 ||
        response.headers.get('content-length') !== String(output.byteLength)) {
        await response.body?.cancel().catch(() => {});
        fail('INVALID_DOWNLOAD_HEADERS');
      }
      const bytes = await boundedBytes(response, output.byteLength);
      if (bytes.length !== output.byteLength || sha256(bytes) !== output.sha256.toLowerCase()) fail('DOWNLOAD_INTEGRITY_FAILED');
      let dimensions: { width: number; height: number };
      try { dimensions = inspectMediaPng(bytes); } catch { fail('INVALID_PNG'); }
      if (dimensions.width !== 1024 || dimensions.height !== 1024) fail('INVALID_OUTPUT');
      op.download = { sha256: sha256(bytes), byteLength: bytes.length, ...dimensions };
      return bytes;
    };
    const recover = async (
      op: OperationEvidence, initial?: MediaRealReceipt,
      expected?: Pick<MediaRealQuoteRequest, 'profileId' | 'configVersion'>,
    ): Promise<Buffer> => {
      recoveryStarted = true;
      const clientId = `${options.runId}-${op.operation}`;
      const explicitId = options.receiptIds?.[op.operation];
      let receipt = initial;
      let originalId = initial?.receiptId ?? explicitId;
      let unknownSubmission = initial?.status === 'SUBMISSION_UNKNOWN';
      let bytes: Buffer | undefined;
      let downloadedOutput: string | undefined;
      for (let attempt = 0; attempt < maxPolls; attempt++) {
        if (!receipt) {
          // Unknown submission always uses by-client-id. A 404 never authorizes resubmission.
          const byClient = !originalId || unknownSubmission;
          const response = await http(`${op.operation}_${byClient ? 'by_client_id' : 'receipt'}`,
            `${sep}${root}/requests/${byClient ? `by-client-id/${clientId}` : originalId}`, token);
          if (byClient && response.status === 404) {
            await response.body?.cancel().catch(() => {});
            if (attempt + 1 < maxPolls) await sleep(2000);
            continue;
          }
          if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
            await response.body?.cancel().catch(() => {}); fail('RECOVERY_UNAVAILABLE');
          }
          let value: unknown;
          try { value = JSON.parse((await boundedBytes(response, 64 * 1024)).toString('utf8')); }
          catch (error) { if (error instanceof AcceptanceFailure) throw error; fail('INVALID_RESPONSE'); }
          receipt = readReceipt(value, clientId, originalId);
        }
        if (expected && (receipt.profileId !== expected.profileId || receipt.configVersion !== expected.configVersion)) {
          fail('RECEIPT_IDENTITY_MISMATCH');
        }
        originalId = receipt.receiptId;
        unknownSubmission = receipt.status === 'SUBMISSION_UNKNOWN';
        op.receiptIdSha256 = sha256(originalId);
        op.status = receipt.status; op.billingStatus = receipt.billingStatus;
        if (['FAILED', 'CANCELLED', 'RESULT_EXPIRED', 'PARTIAL_SUCCEEDED'].includes(receipt.status)) fail('EXECUTION_NOT_SUCCESSFUL');
        const outputIdentity = JSON.stringify(receipt.outputs[0]);
        if (downloadedOutput && downloadedOutput !== outputIdentity) fail('OUTPUT_CHANGED_DURING_SETTLEMENT');
        if (receipt.status === 'SUCCEEDED') {
          if (receipt.errorCode !== null || receipt.outputErrors.length) fail('EXECUTION_NOT_SUCCESSFUL');
          if (receipt.outputs.length !== 1) fail('UNEXPECTED_OUTPUT_COUNT');
          if (!bytes) { bytes = await download(op, receipt); downloadedOutput = outputIdentity; }
          if (receipt.billingStatus === 'SETTLED') return bytes;
          if (receipt.billingStatus === 'RELEASED') fail('UNEXPECTED_BILLING_STATE');
        }
        const delay = Math.min(10_000, Math.max(250, receipt.pollAfterMs ?? 2000));
        receipt = undefined;
        if (attempt + 1 < maxPolls) await sleep(delay);
      }
      fail('RECOVERY_OR_SETTLEMENT_PENDING');
    };

    if (options.resume) {
      for (const op of evidence.operations) {
        try { await recover(op); } catch (error) { addBlocker(error); }
      }
      evidence.outcome = evidence.blockers.length ? 'incomplete' : 'passed';
      return evidence;
    }

    let profile: z.infer<typeof MediaRuntimeProfileSchema> | undefined;
    try {
      const result = parsed(profilesSchema, await json('profiles', `${sep}${root}/profiles`, token, [200]));
      profile = result.profiles.find(item => item.executionMode === 'sync-response' && item.kind === 'image' &&
        operations.every(operation => item.operations.includes(operation)) && item.capabilities.supportsReferenceImage &&
        item.capabilities.sizes.includes(parameters.size) && item.capabilities.maxOutputs >= 1 &&
        item.capabilities.maxWidth >= 1024 && item.capabilities.maxHeight >= 1024);
      if (!profile) fail('COMPATIBLE_PROFILE_REQUIRED');
      parsed(MediaGatewayIdSchema, profile.profileId); parsed(MediaGatewayIdSchema, profile.configVersion);
      evidence.readiness.profiles = true;
    } catch (error) { addBlocker(error); }

    const input = (operation: Operation, referenceIds: string[]): MediaRealQuoteRequest => ({
      profileId: profile!.profileId, configVersion: profile!.configVersion,
      operation, referenceIds, creativeBrief: briefs[operation], parameters: { ...parameters },
    });
    const quote = async (operation: Operation, referenceIds: string[]) => {
      const dto = input(operation, referenceIds);
      const value = parsed(MediaRealQuoteSchema, await json(`${operation}_quote`, `${sep}${root}/quotes`, token, [201], 'POST', JSON.stringify(dto)));
      const expires = Date.parse(value.expiresAt);
      const amount = money(value.amountCny);
      if (expires <= now() || expires > now() + 60_000 || amount <= 0n ||
        money(value.funding.creditCny) + money(value.funding.memberWalletCny) + money(value.funding.personalCny) !== amount) fail('INVALID_QUOTE');
      evidence.readiness[operation === 'generate' ? 'generateQuote' : 'editQuote'] = true;
      evidence.operations.find(op => op.operation === operation)!.quoteAmountCny = formatMoney(amount);
      return { dto, value, amount };
    };
    let generationQuote: Awaited<ReturnType<typeof quote>> | undefined;
    if (profile) {
      try { generationQuote = await quote('generate', []); } catch (error) { addBlocker(error); }
      if (!options.execute && options.referenceId) {
        try { await quote('edit', [options.referenceId]); } catch (error) { addBlocker(error); }
      }
    }
    if (!options.upstreamBaseUrl || !options.upstreamApiKey) {
      addBlocker(new AcceptanceFailure('UPSTREAM_READINESS_CONFIG_REQUIRED'));
    } else {
      const upstream = apiUrl(options.upstreamBaseUrl, false);
      const key = credential(options.upstreamApiKey);
      for (const operation of operations) {
        try {
          const value = parsed(priceSchema, await json(`upstream_${operation}_pricing`, `${upstream}/sub2api/images/pricing`, key, [200], 'POST',
            JSON.stringify({ model: 'gpt-image-2', operation, size: parameters.size, n: 1, quality: parameters.quality })));
          if (value.operation !== operation || /^0+(?:\.0+)?$/.test(value.amount_usd) ||
            /fallback|default|unknown/i.test(value.pricing_source) || Date.parse(value.expires_at) <= now() ||
            Date.parse(value.expires_at) > now() + 120_000 || Date.parse(value.observed_at) > now() + 5000) fail('INVALID_UPSTREAM_PRICE');
          evidence.readiness[operation === 'generate' ? 'generatePrice' : 'editPrice'] = true;
        } catch (error) { addBlocker(error); }
      }
      try {
        parsed(usageProbeSchema, await json('upstream_usage', `${upstream}/sub2api/usage?request_id=${probeId}`, key, [200]));
        evidence.readiness.usageContract = true;
      } catch (error) { addBlocker(error); }
    }
    if (!options.execute) { evidence.outcome = 'read-only'; return evidence; }
    if (evidence.blockers.length || !generationQuote) return evidence;

    let quotedSpend = 0n;
    let recoveryOnly = false;
    const submitOnce = async (op: OperationEvidence, current: NonNullable<typeof generationQuote>) => {
      const clientId = `${options.runId}-${op.operation}`;
      // Check for an existing original before claiming a new submission attempt.
      const previous = await http(`${op.operation}_by_client_id`, `${sep}${root}/requests/by-client-id/${clientId}`, token);
      if (previous.status === 200) {
        if (previous.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
          await previous.body?.cancel().catch(() => {}); fail('INVALID_RESPONSE');
        }
        let value: unknown;
        try { value = JSON.parse((await boundedBytes(previous, 64 * 1024)).toString('utf8')); }
        catch { fail('INVALID_RESPONSE'); }
        const original = readReceipt(value, clientId);
        recoveryOnly = true;
        return recover(op, original);
      }
      await previous.body?.cancel().catch(() => {});
      if (previous.status !== 404) fail('RECOVERY_UNAVAILABLE');
      failIfBudgetExceeded(current.amount);
      if (Date.parse(current.value.expiresAt) <= now()) fail('QUOTE_EXPIRED');
      if (!await dependencies.claimSubmission!(op.operation, clientId)) {
        recoveryOnly = true;
        return recover(op);
      }
      if (Date.parse(current.value.expiresAt) <= now()) fail('QUOTE_EXPIRED');
      quotedSpend += current.amount;
      op.submissionPosts = 1;
      let receipt: MediaRealReceipt | undefined;
      try {
        receipt = readReceipt(await json(`${op.operation}_request`, `${sep}${root}/requests`, token, [200, 202], 'POST',
          JSON.stringify({ ...current.dto, quoteId: current.value.quoteId, clientRequestId: clientId })), clientId);
        if (receipt.profileId !== current.dto.profileId || receipt.configVersion !== current.dto.configVersion) fail('RECEIPT_IDENTITY_MISMATCH');
      } catch {
        // Even HTTP errors, invalid JSON and timeouts may hide a committed submission.
        return recover(op, undefined, current.dto);
      }
      return recover(op, receipt, current.dto);
    };
    const failIfBudgetExceeded = (amount: bigint) => {
      if (budget === null || quotedSpend + amount > budget) fail('BUDGET_EXCEEDED');
    };
    const generated = await submitOnce(evidence.operations[0], generationQuote);
    if (recoveryOnly) {
      await recover(evidence.operations[1]);
      evidence.outcome = 'passed';
      return evidence;
    }
    if (generated.length > 5 * 1024 * 1024) fail('REFERENCE_TOO_LARGE');
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(generated)], { type: 'image/png' }), 'reference.png');
    const reference = parsed(MediaRealReferenceSchema, await json('reference', `${sep}${root}/references`, token, [201], 'POST', form, true));
    if (reference.sha256 !== sha256(generated) || reference.byteLength !== generated.length ||
      reference.width !== 1024 || reference.height !== 1024 || Date.parse(reference.expiresAt) <= now()) fail('INVALID_REFERENCE');
    const editingQuote = await quote('edit', [reference.referenceId]);
    await submitOnce(evidence.operations[1], editingQuote);
    evidence.outcome = 'passed';
  } catch (error) {
    addBlocker(error);
    if (recoveryStarted || evidence.operations.some(op => op.submissionPosts || op.receiptIdSha256)) evidence.outcome = 'incomplete';
  }
  return evidence;
}

/** Only this boundary reads environment variables or writes sanitized evidence/attempt markers. */
export async function mediaRealAcceptanceCli(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const secrets = [environment.SEP_EMPLOYMENT_TOKEN, environment.MEDIA_API_KEY].filter((value): value is string => !!value);
  const serialize = (value: unknown) => {
    let text = JSON.stringify(value, null, 2);
    for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
    return `${text}\n`;
  };
  let output: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const runId = environment.MEDIA_REAL_ACCEPTANCE_RUN_ID;
    const options: MediaRealAcceptanceOptions = {
      baseUrl: environment.SEP_BASE_URL, employmentToken: environment.SEP_EMPLOYMENT_TOKEN,
      upstreamBaseUrl: environment.MEDIA_BASE_URL, upstreamApiKey: environment.MEDIA_API_KEY,
      execute: environment.MEDIA_REAL_ACCEPTANCE_EXECUTE === 'true',
      resume: environment.MEDIA_REAL_ACCEPTANCE_RESUME === 'true', runId,
      budgetCny: environment.MEDIA_REAL_ACCEPTANCE_BUDGET_CNY,
      referenceId: environment.MEDIA_REAL_ACCEPTANCE_REFERENCE_ID,
    };
    if (environment.MEDIA_REAL_ACCEPTANCE_GENERATE_RECEIPT_ID || environment.MEDIA_REAL_ACCEPTANCE_EDIT_RECEIPT_ID) {
      options.receiptIds = {
        ...(environment.MEDIA_REAL_ACCEPTANCE_GENERATE_RECEIPT_ID ? { generate: environment.MEDIA_REAL_ACCEPTANCE_GENERATE_RECEIPT_ID } : {}),
        ...(environment.MEDIA_REAL_ACCEPTANCE_EDIT_RECEIPT_ID ? { edit: environment.MEDIA_REAL_ACCEPTANCE_EDIT_RECEIPT_ID } : {}),
      };
    }
    // A fixed, credential-free namespace prevents changing evidence filenames from replaying an ID.
    const attemptDirectory = resolve(__dirname, '../../outputs/media-real-acceptance-attempts');
    const target = environment.MEDIA_REAL_ACCEPTANCE_OUTPUT;
    if (!target) fail('EVIDENCE_OUTPUT_REQUIRED');
    await mkdir(dirname(resolve(target)), { recursive: true });
    output = await open(resolve(target), 'wx', 0o600);
    const evidence = await runMediaRealAcceptance(options, {
      claimSubmission: async (_operation, clientId) => {
        await mkdir(attemptDirectory, { recursive: true });
        const parent = await open(dirname(attemptDirectory), 'r');
        try { await parent.sync(); } finally { await parent.close(); }
        const marker = resolve(attemptDirectory, `${sha256(clientId)}.json`);
        let handle: Awaited<ReturnType<typeof open>>;
        try { handle = await open(marker, 'wx', 0o600); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
        try { await handle.writeFile('{"submissionAttempted":true}\n'); await handle.sync(); }
        finally { await handle.close(); }
        const directory = await open(attemptDirectory, 'r');
        try { await directory.sync(); } finally { await directory.close(); }
        return true;
      },
    });
    const text = serialize(evidence);
    await output.writeFile(text); await output.sync();
    process.stdout.write(text);
    if (evidence.blockers.length || evidence.outcome === 'incomplete') process.exitCode = 1;
  } catch {
    process.stderr.write('MEDIA_REAL_ACCEPTANCE_CLI_FAILED\n');
    process.exitCode = 1;
  } finally { await output?.close().catch(() => {}); }
}

if (require.main === module) void mediaRealAcceptanceCli();
