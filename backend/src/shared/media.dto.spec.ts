import {
  CreateMediaProfileDtoSchema,
  MediaRuntimeQuerySchema,
  MediaRuntimeSchema,
  UpdateMediaConnectionDtoSchema,
  UpdateMediaProfileDtoSchema,
} from './media.dto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const profile = {
  profileId: 'product-image', kind: 'image', displayName: '商品图片',
  modelId: 'test-image-model', operations: ['generate'], executionMode: 'sync-response',
  capabilities: { sizes: ['1024x1024'] },
};

describe('media configuration schemas', () => {
  it('keeps client fixtures synchronized with the runtime schema', () => {
    const fixtures = JSON.parse(readFileSync(join(__dirname, 'fixtures/media-runtime-v1.json'), 'utf8'));
    for (const fixture of fixtures) {
      const parsed = MediaRuntimeSchema.parse(fixture.media);
      expect(parsed).toEqual(fixture.media);
      expect(parsed.executionAvailable).toBe(false);
      expect(parsed.tools).toEqual([]);
      for (const profile of parsed.profiles) expect(profile).not.toHaveProperty('modelId');
    }
  });
  it('requires at least one explicit size and defaults only known capabilities', () => {
    expect(CreateMediaProfileDtoSchema.parse(profile).capabilities).toEqual({
      sizes: ['1024x1024'], supportsReferenceImage: false, maxOutputs: 1,
    });
    for (const capabilities of [{}, { sizes: [] }, { sizes: ['auto'] }, { sizes: ['0x1024'] }]) {
      expect(CreateMediaProfileDtoSchema.safeParse({ ...profile, capabilities }).success).toBe(false);
    }
  });

  it('forbids video, arbitrary parameters and client-supplied verification/version', () => {
    for (const extra of [{ kind: 'video' }, { verified: true }, { configVersion: 'fake' }, { apiKey: 'fake' }]) {
      expect(CreateMediaProfileDtoSchema.safeParse({ ...profile, ...extra }).success).toBe(false);
    }
  });

  it('requires reference-image capability for editing', () => {
    expect(CreateMediaProfileDtoSchema.safeParse({ ...profile, operations: ['edit'] }).success).toBe(false);
    expect(CreateMediaProfileDtoSchema.safeParse({
      ...profile, operations: ['edit'], capabilities: { sizes: ['1024x1024'], supportsReferenceImage: true },
    }).success).toBe(true);
  });

  it('requires an expected version and at least one changed field', () => {
    expect(UpdateMediaProfileDtoSchema.safeParse({ enabled: true }).success).toBe(false);
    expect(UpdateMediaProfileDtoSchema.safeParse({ expectedConfigVersion: 'cfg_1' }).success).toBe(false);
    expect(UpdateMediaProfileDtoSchema.safeParse({ expectedConfigVersion: 'cfg_1', enabled: true }).success).toBe(true);
    expect(UpdateMediaProfileDtoSchema.safeParse({ expectedConfigVersion: 'cfg_1', verified: true }).success).toBe(false);
  });

  it('accepts only credential-free HTTP(S) connection addresses', () => {
    expect(UpdateMediaConnectionDtoSchema.safeParse({ baseUrl: 'https://relay.example/v1', apiKey: '' }).success).toBe(true);
    for (const baseUrl of ['not-a-url', 'file:///tmp/image', 'https://user:password@relay.example/v1', 'https://relay.example/?key=fake', 'https://relay.example/#key']) {
      expect(UpdateMediaConnectionDtoSchema.safeParse({ baseUrl }).success).toBe(false);
    }
  });

  it('parses optional protocol negotiation without accepting malformed query values', () => {
    expect(MediaRuntimeQuerySchema.parse({})).toEqual({});
    expect(MediaRuntimeQuerySchema.parse({ mediaProtocolVersion: '1' })).toEqual({ mediaProtocolVersion: 1 });
    for (const mediaProtocolVersion of ['bad', '', '0', '1.5', ['1', '2']]) {
      expect(MediaRuntimeQuerySchema.safeParse({ mediaProtocolVersion }).success).toBe(false);
    }
  });
});
