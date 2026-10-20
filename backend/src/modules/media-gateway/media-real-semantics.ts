import { createHash } from 'node:crypto';
import type { MediaRealQuoteRequest } from 'shared';

/** Keep ordered UTF-8 serialization aligned with Electron's real-media fixture. */
export function mediaRealSemanticHash(dto: MediaRealQuoteRequest, referenceHashes: string[]): string {
  return createHash('sha256').update(JSON.stringify({
    profileId: dto.profileId, configVersion: dto.configVersion, operation: dto.operation,
    referenceHashes, briefSha256: createHash('sha256').update(dto.creativeBrief.trim()).digest('hex'),
    parameters: { size: dto.parameters.size, count: dto.parameters.count, quality: dto.parameters.quality },
  })).digest('hex');
}
