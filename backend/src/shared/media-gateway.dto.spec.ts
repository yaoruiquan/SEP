import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  MediaGatewayMockAdapter,
  MEDIA_MOCK_CONFIG_VERSION,
  MEDIA_MOCK_PNG,
  MEDIA_MOCK_PNG_SHA256,
  MEDIA_MOCK_PROFILE_IDS,
} from '../modules/media-gateway/media-gateway-mock.adapter';
import {
  MediaGatewayErrorCodeSchema,
  MediaGatewayIdSchema,
  MediaGatewayOutputSchema,
  MediaGatewayParametersSchema,
  MediaGatewayQuoteRequestSchema,
  MediaGatewayQuoteSchema,
  MediaGatewayReceiptSchema,
  MediaGatewayReferenceSchema,
  MediaGatewayRequestSchema,
} from './media-gateway.dto';

const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/media-gateway-v1.json'), 'utf8'));
const quoteRequest = MediaGatewayQuoteRequestSchema.parse(fixture.quoteRequests[0]);
const request = MediaGatewayRequestSchema.parse(fixture.requests[0]);
const reference = MediaGatewayReferenceSchema.parse(fixture.references[0]);
const quote = MediaGatewayQuoteSchema.parse(fixture.quotes[0]);
const receipt = MediaGatewayReceiptSchema.parse(fixture.receipts[0]);
const output = receipt.outputs[0];

describe('mock media gateway v1 fixtures', () => {
  it('marks the fixture as simulation-only with no real price or wallet charge', () => {
    expect(fixture.mock).toBe(true);
    expect(fixture.simulationOnly).toBe(true);
    expect(fixture.realPrice).toBe(false);
    expect(fixture.walletCharged).toBe(false);
    expect(fixture.endpoint).toBe('/gateway/v1/media');
  });

  it.each<[string, z.ZodTypeAny]>([
    ['quoteRequests', MediaGatewayQuoteRequestSchema],
    ['requests', MediaGatewayRequestSchema],
    ['references', MediaGatewayReferenceSchema],
    ['quotes', MediaGatewayQuoteSchema],
    ['receipts', MediaGatewayReceiptSchema],
  ])('parses every %s fixture without stripping or changing fields', (key, schema) => {
    expect(fixture[key].length).toBeGreaterThan(0);
    for (const value of fixture[key]) expect(schema.parse(value)).toEqual(value);
  });

  it('uses only the exact static 1x1 RGB PNG and matching metadata', () => {
    const png = Buffer.from(fixture.staticPng.base64, 'base64');
    expect(png).toEqual(MEDIA_MOCK_PNG);
    expect(fixture.staticPng.sha256).toBe(MEDIA_MOCK_PNG_SHA256);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(1);
    expect(png.readUInt32BE(20)).toBe(1);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(2);
    expect(png.length).toBe(69);
    const metadata = {
      mimeType: 'image/png',
      byteLength: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
      width: 1,
      height: 1,
    };
    expect(fixture.staticPng).toMatchObject(metadata);
    for (const value of fixture.references) {
      expect(value).toMatchObject(metadata);
      expect(value).not.toHaveProperty('base64');
      expect(value).not.toHaveProperty('bytes');
    }
    for (const value of fixture.receipts) {
      for (const image of value.outputs) expect(image).toMatchObject(metadata);
    }
  });

  it('uses supported profiles and recovery flags for currently executable adapter actions', () => {
    const adapter = new MediaGatewayMockAdapter();
    for (const value of [...fixture.quoteRequests, ...fixture.requests, ...fixture.receipts]) {
      expect(MEDIA_MOCK_PROFILE_IDS).toContain(value.profileId);
      expect(value.configVersion).toBe(MEDIA_MOCK_CONFIG_VERSION);
    }
    for (const value of fixture.receipts) {
      const mode = adapter.mode(value.profileId);
      const canQuery = mode === 'async-query' && ['QUEUED', 'RUNNING'].includes(value.status);
      expect(value.executionMode).toBe(mode);
      expect(value.recovery.canQuery).toBe(canQuery);
      expect(value.recovery.canCancel).toBe(canQuery && value.profileId !== 'mock-no-cancel');
      expect(value.pollAfterMs).toBe(canQuery ? 1000 : null);
      expect(value.recovery.canDownload).toBe(value.outputs.length > 0);
    }
  });

  it('hashes each quoted payload using the service canonical JSON and ordered reference hashes', () => {
    expect(fixture.quotes).toHaveLength(fixture.quoteRequests.length);
    for (const [index, value] of fixture.quoteRequests.entries()) {
      const dto = MediaGatewayQuoteRequestSchema.parse(value);
      const references = dto.referenceIds.map((id) => {
        const referenceFixture = fixture.references.find((item) => item.referenceId === id);
        expect(referenceFixture).toBeDefined();
        return referenceFixture.sha256;
      });
      const semanticSha256 = createHash('sha256').update(JSON.stringify({
        profileId: dto.profileId,
        configVersion: dto.configVersion,
        operation: dto.operation,
        creativeBrief: dto.creativeBrief,
        parameters: { size: dto.parameters.size, count: dto.parameters.count },
        references,
      })).digest('hex');
      expect(fixture.quotes[index].semanticSha256).toBe(semanticSha256);
      expect(fixture.quotes[index].pricingStatus).toBe(dto.profileId === 'mock-no-price' ? 'unavailable' : 'quoted');
    }
  });

  it('pairs each executable quote, request and receipt without reusing a client request ID', () => {
    expect(new Set(fixture.requests.map((value) => value.clientRequestId)).size).toBe(fixture.requests.length);
    expect(fixture.receipts).toHaveLength(fixture.requests.length);
    expect(fixture.requests).toHaveLength(fixture.quotes.filter((value) => value.pricingStatus === 'quoted').length);
    for (const value of fixture.requests) {
      const quoteIndex = fixture.quotes.findIndex((item) => item.quoteId === value.quoteId);
      expect(quoteIndex).toBeGreaterThanOrEqual(0);
      expect(fixture.quotes[quoteIndex].pricingStatus).toBe('quoted');
      const { clientRequestId, quoteId: _quoteId, ...quotedPayload } = value;
      expect(quotedPayload).toEqual(fixture.quoteRequests[quoteIndex]);
      const matchingReceipts = fixture.receipts.filter((item) => item.clientRequestId === clientRequestId);
      expect(matchingReceipts).toHaveLength(1);
      const result = matchingReceipts[0];
      expect(result.profileId).toBe(value.profileId);
      expect(result.configVersion).toBe(value.configVersion);
      expect(result.errorCode).toBeNull();
      if (result.status === 'QUEUED') {
        expect(result.outputs).toEqual([]);
        expect(result.outputErrors).toEqual([]);
        expect(result.pollAfterMs).toBe(1000);
      } else {
        const partial = result.status === 'PARTIAL_SUCCEEDED';
        expect(result.outputs).toHaveLength(value.parameters.count - (partial ? 1 : 0));
        expect(result.outputErrors).toEqual(partial ? [{ index: value.parameters.count - 1, code: 'OUTPUT_FAILED' }] : []);
        expect(result.pollAfterMs).toBeNull();
      }
      for (const [index, image] of result.outputs.entries()) {
        expect(image.outputId).toBe(`${result.receiptId}_${index}`);
      }
    }
  });

  it('uses simulated TTLs and the fixed mock quote amount', () => {
    expect(fixture.ttlSeconds).toEqual({ reference: 900, quote: 60, output: 300 });
    const issuedAt = Date.parse(fixture.issuedAt);
    for (const value of fixture.references) {
      expect(Date.parse(value.expiresAt) - issuedAt).toBe(900_000);
    }
    for (const value of fixture.quotes) {
      expect(Date.parse(value.expiresAt) - issuedAt).toBe(60_000);
      expect(value.amountCny).toBe(value.pricingStatus === 'quoted' ? '0.010000' : null);
      expect(value.billingStatus).toBe('MOCK_NOT_CHARGED');
    }
    for (const value of fixture.receipts) {
      expect(value.mock).toBe(true);
      expect(value.billingStatus).toBe('MOCK_NOT_CHARGED');
      for (const image of value.outputs) {
        expect(Date.parse(image.expiresAt) - issuedAt).toBe(300_000);
      }
    }
  });
});

describe('mock media gateway request schemas', () => {
  it('accepts exactly the ID alphabet and length bounds', () => {
    for (const id of ['a', 'A_0-z', 'a'.repeat(128)]) {
      expect(MediaGatewayIdSchema.parse(id)).toBe(id);
    }
    for (const id of ['', 'a'.repeat(129), 'a.b', 'a/b', 'a b', ' a', 'a\n', 1, null]) {
      expect(MediaGatewayIdSchema.safeParse(id).success).toBe(false);
    }
  });

  it('defaults only supported parameters and allows one through four outputs', () => {
    expect(MediaGatewayParametersSchema.parse({})).toEqual({ size: '1x1', count: 1 });
    for (const count of [1, 2, 3, 4]) {
      expect(MediaGatewayParametersSchema.parse({ count })).toEqual({ size: '1x1', count });
    }
    for (const value of [
      { size: '1024x1024' }, { count: 0 }, { count: 5 }, { count: 1.5 },
      { count: '1' }, { count: null }, { quality: 'high' }, null,
    ]) {
      expect(MediaGatewayParametersSchema.safeParse(value).success).toBe(false);
    }
  });

  it.each<[string, z.ZodTypeAny, object]>([
    ['quote', MediaGatewayQuoteRequestSchema, quoteRequest],
    ['execution', MediaGatewayRequestSchema, request],
  ])('applies defaults, strictness and reference refinements to %s requests', (_, schema, valid) => {
    const minimal = { ...valid, creativeBrief: '  Static PNG.  ' };
    delete minimal['referenceIds'];
    delete minimal['parameters'];
    expect(schema.parse(minimal)).toEqual({
      ...valid, creativeBrief: 'Static PNG.', referenceIds: [], parameters: { size: '1x1', count: 1 },
    });
    for (const extra of [
      { employmentId: 'emp_1' }, { employmentToken: 'token' }, { scope: 'employment' },
      { token: 'token' }, { apiKey: 'secret' }, { modelId: 'upstream' }, { unknown: true },
    ]) {
      expect(schema.safeParse({ ...valid, ...extra }).success).toBe(false);
    }
    for (const change of [
      { profileId: '../profile' }, { configVersion: '' }, { operation: 'video' },
      { creativeBrief: ' \n ' }, { creativeBrief: 'a'.repeat(4001) },
      { creativeBrief: null }, { parameters: { seed: 1 } }, { referenceIds: null },
      { referenceIds: ['bad/id'] }, { referenceIds: ['a', 'b', 'c', 'd', 'e'] },
    ]) {
      expect(schema.safeParse({ ...valid, ...change }).success).toBe(false);
    }
    expect(schema.safeParse({ ...valid, creativeBrief: 'a'.repeat(4000) }).success).toBe(true);
    expect(schema.safeParse({ ...valid, referenceIds: ['a', 'b', 'c', 'd'] }).success).toBe(true);
    for (const operation of ['generate', 'edit']) {
      const duplicates = schema.safeParse({ ...valid, operation, referenceIds: ['ref_1', 'ref_1'] });
      expect(duplicates.success).toBe(false);
      if (!duplicates.success) expect(duplicates.error.issues[0].path).toEqual(['referenceIds']);
    }
    for (const value of [
      { ...minimal, operation: 'edit' }, { ...valid, operation: 'edit', referenceIds: [] },
    ]) {
      const missing = schema.safeParse(value);
      expect(missing.success).toBe(false);
      if (!missing.success) expect(missing.error.issues[0].path).toEqual(['referenceIds']);
    }
    expect(schema.safeParse({ ...valid, operation: 'edit', referenceIds: ['ref_1'] }).success).toBe(true);
    for (const field of ['profileId', 'configVersion', 'operation', 'creativeBrief']) {
      const missing = { ...valid };
      delete missing[field];
      expect(schema.safeParse(missing).success).toBe(false);
    }
  });

  it('requires valid clientRequestId and quoteId only on execution requests', () => {
    for (const field of ['clientRequestId', 'quoteId']) {
      for (const value of [undefined, null, '', 'bad/id']) {
        expect(MediaGatewayRequestSchema.safeParse({ ...request, [field]: value }).success).toBe(false);
      }
      expect(MediaGatewayQuoteRequestSchema.safeParse({ ...quoteRequest, [field]: 'id_1' }).success).toBe(false);
    }
  });
});

describe('mock media gateway response schemas', () => {
  it.each<[string, z.ZodTypeAny, object]>([
    ['reference', MediaGatewayReferenceSchema, reference],
    ['quote', MediaGatewayQuoteSchema, quote],
    ['output', MediaGatewayOutputSchema, output],
    ['receipt', MediaGatewayReceiptSchema, receipt],
  ])('rejects unknown and missing fields on %s responses', (_, schema, valid) => {
    expect(schema.safeParse({ ...valid, unknown: true }).success).toBe(false);
    for (const field of Object.keys(valid)) {
      const missing = { ...valid };
      delete missing[field];
      expect(schema.safeParse(missing).success).toBe(false);
    }
  });

  it.each<[string, z.ZodTypeAny, object]>([
    ['reference', MediaGatewayReferenceSchema, reference],
    ['quote', MediaGatewayQuoteSchema, quote],
    ['receipt', MediaGatewayReceiptSchema, receipt],
  ])('requires explicit mock markers on %s responses', (_, schema, valid) => {
    for (const mock of [false, 'true', null]) {
      expect(schema.safeParse({ ...valid, mock }).success).toBe(false);
    }
  });

  it.each<[string, z.ZodTypeAny, object]>([
    ['reference', MediaGatewayReferenceSchema, reference],
    ['output', MediaGatewayOutputSchema, output],
  ])('requires PNG metadata and positive integral dimensions/length on %s', (_, schema, valid) => {
    for (const field of ['byteLength', 'width', 'height']) {
      for (const value of [0, -1, 1.5, '1', null, Infinity, NaN]) {
        expect(schema.safeParse({ ...valid, [field]: value }).success).toBe(false);
      }
    }
    for (const change of [{ mimeType: 'image/jpeg' }, { sha256: 'a'.repeat(63) }, { sha256: 'g'.repeat(64) }]) {
      expect(schema.safeParse({ ...valid, ...change }).success).toBe(false);
    }
    expect(schema.safeParse({ ...valid, sha256: 'AB'.repeat(32) }).success).toBe(true);
  });

  it('enforces reference byte and dimension limits', () => {
    expect(MediaGatewayReferenceSchema.safeParse({
      ...reference, byteLength: 5 * 1024 * 1024, width: 4096, height: 4096,
    }).success).toBe(true);
    for (const change of [{ byteLength: 5 * 1024 * 1024 + 1 }, { width: 4097 }, { height: 4097 }]) {
      expect(MediaGatewayReferenceSchema.safeParse({ ...reference, ...change }).success).toBe(false);
    }
  });

  it.each<[string, z.ZodTypeAny, object]>([
    ['reference', MediaGatewayReferenceSchema, reference],
    ['quote', MediaGatewayQuoteSchema, quote],
    ['output', MediaGatewayOutputSchema, output],
  ])('requires ISO timestamps on %s expiry fields', (_, schema, valid) => {
    for (const expiresAt of ['tomorrow', '2026-10-13', '2026-02-30T00:00:00Z', 1]) {
      expect(schema.safeParse({ ...valid, expiresAt }).success).toBe(false);
    }
    expect(schema.safeParse({ ...valid, expiresAt: '2026-10-13T08:00:00+08:00' }).success).toBe(true);
    expect(schema.safeParse({ ...valid, expiresAt: null }).success).toBe(schema === MediaGatewayOutputSchema);
  });

  it('permits only six-decimal nonnegative amount strings', () => {
    for (const amountCny of ['0.000000', '0.010000', '123.456789']) {
      expect(MediaGatewayQuoteSchema.safeParse({ ...quote, amountCny }).success).toBe(true);
    }
    for (const amountCny of [0.01, '', '0', '0.01', '0.0100000', '-0.010000', '+0.010000', '1e-2', ' 0.010000', 'NaN']) {
      expect(MediaGatewayQuoteSchema.safeParse({ ...quote, amountCny }).success).toBe(false);
    }
  });

  it('links pricing availability to nullable amounts and prevents real billing', () => {
    expect(MediaGatewayQuoteSchema.safeParse({ ...quote, pricingStatus: 'unavailable', amountCny: null }).success).toBe(true);
    for (const change of [
      { amountCny: null }, { pricingStatus: 'unavailable' }, { pricingStatus: 'estimated' },
      { semanticSha256: 'not-a-hash' }, { pricingVersion: 'real-v1' }, { billingStatus: 'CHARGED' },
    ]) {
      const parsed = MediaGatewayQuoteSchema.safeParse({ ...quote, ...change });
      expect(parsed.success).toBe(false);
      if (!parsed.success && ('amountCny' in change || change.pricingStatus === 'unavailable')) {
        expect(parsed.error.issues[0].path).toEqual(['amountCny']);
      }
    }
    expect(MediaGatewayReceiptSchema.safeParse({ ...receipt, billingStatus: 'CHARGED' }).success).toBe(false);
  });

  it('accepts all and only the known error codes in receipts and output errors', () => {
    expect(MediaGatewayErrorCodeSchema.options).toEqual([
      'MEDIA_MOCK_DISABLED', 'MEDIA_FORBIDDEN', 'MEDIA_NOT_FOUND', 'UNSUPPORTED_MEDIA_PARAMETERS',
      'INVALID_REFERENCE', 'REFERENCE_EXPIRED', 'QUOTE_EXPIRED', 'CONFIG_CHANGED', 'IDEMPOTENCY_CONFLICT',
      'PRICE_UNAVAILABLE', 'BUDGET_EXCEEDED', 'RESULT_EXPIRED', 'CANCEL_UNSUPPORTED', 'MEDIA_RATE_LIMITED',
      'UPSTREAM_FAILED', 'SUBMISSION_UNKNOWN', 'OUTPUT_FAILED', 'INVALID_PARAMETER',
    ]);
    for (const code of MediaGatewayErrorCodeSchema.options) {
      expect(MediaGatewayReceiptSchema.safeParse({
        ...receipt, errorCode: code, outputErrors: [{ index: 0, code }],
      }).success).toBe(true);
    }
    expect(MediaGatewayErrorCodeSchema.safeParse('UNKNOWN').success).toBe(false);
    expect(MediaGatewayReceiptSchema.safeParse({ ...receipt, errorCode: 'UNKNOWN' }).success).toBe(false);
    expect(MediaGatewayReceiptSchema.safeParse({
      ...receipt, outputErrors: [{ index: 0, code: 'UNKNOWN' }],
    }).success).toBe(false);
  });

  it('accepts every receipt status and both execution modes', () => {
    for (const status of [
      'SUBMITTING', 'QUEUED', 'RUNNING', 'SUBMISSION_UNKNOWN', 'SUCCEEDED',
      'PARTIAL_SUCCEEDED', 'FAILED', 'CANCELLED', 'RESULT_EXPIRED',
    ]) {
      for (const executionMode of ['sync-response', 'async-query']) {
        expect(MediaGatewayReceiptSchema.safeParse({ ...receipt, status, executionMode }).success).toBe(true);
      }
    }
    for (const change of [{ status: 'SUCCESS' }, { executionMode: 'stream' }]) {
      expect(MediaGatewayReceiptSchema.safeParse({ ...receipt, ...change }).success).toBe(false);
    }
  });

  it('bounds output count, poll delays and per-output error indexes', () => {
    for (const pollAfterMs of [null, 0, 1000]) {
      expect(MediaGatewayReceiptSchema.safeParse({ ...receipt, pollAfterMs }).success).toBe(true);
    }
    for (const pollAfterMs of [-1, 1.5, '1000', Infinity]) {
      expect(MediaGatewayReceiptSchema.safeParse({ ...receipt, pollAfterMs }).success).toBe(false);
    }
    expect(MediaGatewayReceiptSchema.safeParse({ ...receipt, outputs: [] }).success).toBe(true);
    expect(MediaGatewayReceiptSchema.safeParse({ ...receipt, outputs: Array(4).fill(output) }).success).toBe(true);
    expect(MediaGatewayReceiptSchema.safeParse({ ...receipt, outputs: Array(5).fill(output) }).success).toBe(false);
    for (const index of [0, 1, 2, 3]) {
      expect(MediaGatewayReceiptSchema.safeParse({
        ...receipt, outputErrors: [{ index, code: 'OUTPUT_FAILED' }],
      }).success).toBe(true);
    }
    for (const index of [-1, 4, 0.5, '0', null]) {
      expect(MediaGatewayReceiptSchema.safeParse({
        ...receipt, outputErrors: [{ index, code: 'OUTPUT_FAILED' }],
      }).success).toBe(false);
    }
  });

  it('rejects unknown nested fields and nonboolean recovery flags', () => {
    for (const change of [
      { outputs: [{ ...output, url: 'https://example.test/image.png' }] },
      { outputs: [{ ...output, kind: 'video' }] },
      { outputErrors: [{ index: 0, code: 'OUTPUT_FAILED', message: 'extra' }] },
      { recovery: { ...receipt.recovery, retry: true } },
      { recovery: { ...receipt.recovery, canDownload: 'true' } },
      { recovery: { canQuery: true, canCancel: false } },
    ]) {
      expect(MediaGatewayReceiptSchema.safeParse({ ...receipt, ...change }).success).toBe(false);
    }
  });
});
