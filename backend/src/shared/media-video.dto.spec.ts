import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  MediaVideoCapabilitiesSchema,
  MediaVideoGatewayOutputSchema,
  MediaVideoGatewayReferenceSchema,
  MediaVideoGatewayQuoteRequestSchema,
  MediaVideoGatewayQuoteSchema,
  MediaVideoGatewayReceiptSchema,
  MediaVideoGatewayRequestSchema,
  MediaVideoProfileSchema,
  MediaVideoRuntimeSchema,
} from './media-video.dto';

const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/media-video-v1.json'), 'utf8')) as Record<string, any>;

describe('media video v1 contract', () => {
  it('parses the mock profile, runtime and task fixtures without changing them', () => {
    expect(MediaVideoProfileSchema.parse(fixture.profile)).toEqual(fixture.profile);
    expect(MediaVideoRuntimeSchema.parse(fixture.runtime)).toEqual(fixture.runtime);
    expect(MediaVideoCapabilitiesSchema.parse(fixture.profile.capabilities)).toEqual(fixture.profile.capabilities);
  });

  it('requires image-to-video requests to carry exactly one approved reference', () => {
    expect(MediaVideoGatewayQuoteRequestSchema.parse(fixture.quoteRequest)).toEqual(fixture.quoteRequest);
    expect(MediaVideoGatewayRequestSchema.parse(fixture.request)).toEqual(fixture.request);
    for (const referenceIds of [[], ['ref-a', 'ref-b']]) {
      expect(MediaVideoGatewayQuoteRequestSchema.safeParse({ ...fixture.quoteRequest, referenceIds }).success).toBe(false);
    }
  });

  it('binds duration and output metadata to the receipt contract', () => {
    expect(MediaVideoGatewayReceiptSchema.parse(fixture.receipt)).toEqual(fixture.receipt);
    expect(MediaVideoGatewayOutputSchema.parse(fixture.output)).toEqual(fixture.output);
    for (const parameters of [
      { durationSeconds: 0, resolution: '720p', aspectRatio: '9:16', frameRate: 24, audio: false, outputFormat: 'video/mp4' },
      { durationSeconds: 5, resolution: '720p', aspectRatio: '9:16', frameRate: 24, audio: false, outputFormat: 'image/png' },
    ]) {
      expect(MediaVideoGatewayQuoteRequestSchema.safeParse({ ...fixture.quoteRequest, parameters }).success).toBe(false);
    }
  });

  it('parses a scoped reference descriptor without accepting bytes in JSON', () => {
    const reference = MediaVideoGatewayReferenceSchema.parse({
      mock: true, referenceId: 'video-reference-1', expiresAt: '2026-10-20T00:00:00.000Z', mimeType: 'image/png',
      byteLength: 69, sha256: 'a'.repeat(64), width: 1, height: 1,
    });
    expect(reference).not.toHaveProperty('bytes');
    expect(MediaVideoGatewayReferenceSchema.safeParse({ ...reference, bytes: 'secret' }).success).toBe(false);
  });

  it('rejects image operations, arbitrary vendor fields and non-async video profiles', () => {
    expect(MediaVideoProfileSchema.safeParse({ ...fixture.profile, operations: ['generate'] }).success).toBe(false);
    expect(MediaVideoProfileSchema.safeParse({ ...fixture.profile, executionMode: 'sync-response' }).success).toBe(false);
    expect(MediaVideoGatewayQuoteRequestSchema.safeParse({ ...fixture.quoteRequest, operation: 'generate' }).success).toBe(false);
    expect(MediaVideoGatewayRequestSchema.safeParse({ ...fixture.request, apiKey: 'secret' }).success).toBe(false);
  });

  it('parses all shared async states and verifies the playable fixture hash', () => {
    expect(MediaVideoGatewayQuoteSchema.parse(fixture.quote)).toEqual(fixture.quote);
    for (const receipt of Object.values(fixture.receipts)) expect(MediaVideoGatewayReceiptSchema.parse(receipt)).toEqual(receipt);
    const bytes = Buffer.from(fixture.mediaFixture.base64, 'base64');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.output.sha256);
    expect(bytes.length).toBe(fixture.output.byteLength);
    expect(bytes.toString('ascii', 4, 8)).toBe('ftyp');
  });

  it('rejects contradictory receipt states and unsupported runtime tools', () => {
    expect(MediaVideoGatewayReceiptSchema.safeParse({ ...fixture.receipts.succeeded, outputs: [] }).success).toBe(false);
    expect(MediaVideoGatewayReceiptSchema.safeParse({ ...fixture.receipts.failed, recovery: { canQuery: false, canCancel: false, canDownload: true } }).success).toBe(false);
    expect(MediaVideoGatewayReceiptSchema.safeParse({ ...fixture.receipts.succeeded, pollAfterMs: 1000 }).success).toBe(false);
    expect(MediaVideoRuntimeSchema.safeParse({ ...fixture.runtime, defaultProfileId: 'missing' }).success).toBe(false);
    expect(MediaVideoRuntimeSchema.safeParse({ ...fixture.runtime, tools: ['video_generate'] }).success).toBe(false);
  });
});
