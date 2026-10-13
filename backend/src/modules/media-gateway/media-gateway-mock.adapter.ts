import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

// A locally constructed, valid 1x1 RGB PNG; no user image or upstream response.
export const MEDIA_MOCK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQ2FIBAAJEAU2Vdyv6AAAAAElFTkSuQmCC',
  'base64',
);
export const MEDIA_MOCK_PNG_SHA256 = createHash('sha256').update(MEDIA_MOCK_PNG).digest('hex');
export const MEDIA_MOCK_CONFIG_VERSION = 'mock-v1';
export const MEDIA_MOCK_PROFILE_IDS = [
  'mock-sync', 'mock-async', 'mock-partial', 'mock-failed', 'mock-unknown',
  'mock-expired', 'mock-no-price', 'mock-budget', 'mock-no-cancel',
] as const;
export type MediaMockProfileId = typeof MEDIA_MOCK_PROFILE_IDS[number];

@Injectable()
export class MediaGatewayMockAdapter {
  profiles() {
    return MEDIA_MOCK_PROFILE_IDS.map((profileId) => ({
      profileId, configVersion: MEDIA_MOCK_CONFIG_VERSION,
      executionMode: this.mode(profileId), operations: ['generate', 'edit'],
      capabilities: { supportsReferenceImage: true, sizes: ['1x1'], maxOutputs: 4 },
    }));
  }

  mode(profileId: string): 'sync-response' | 'async-query' {
    return ['mock-sync', 'mock-unknown', 'mock-expired'].includes(profileId) ? 'sync-response' : 'async-query';
  }

  // A distinct invocation boundary so tests can prove replays never resubmit.
  async submit(profileId: MediaMockProfileId): Promise<'SUCCEEDED' | 'SUBMISSION_UNKNOWN' | 'QUEUED'> {
    if (profileId === 'mock-unknown') return 'SUBMISSION_UNKNOWN';
    return this.mode(profileId) === 'sync-response' ? 'SUCCEEDED' : 'QUEUED';
  }

  async query(profileId: MediaMockProfileId, status: string) {
    if (status === 'QUEUED') return 'RUNNING' as const;
    if (profileId === 'mock-failed') return 'FAILED' as const;
    if (profileId === 'mock-partial') return 'PARTIAL_SUCCEEDED' as const;
    return 'SUCCEEDED' as const;
  }
}
