import { createHash } from 'node:crypto';
import type { MediaRealAnyQuoteRequest, MediaRealQuoteRequestV3 } from 'shared';

function stableRecord(value: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!value) return null;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

/** Keep ordered UTF-8 serialization aligned with Electron's real-media fixture. */
export function mediaRealSemanticHash(dto: MediaRealAnyQuoteRequest, referenceHashes: string[], context?: { scope: string; adapter: string }): string {
  if (!('parameters' in dto)) {
    const v3 = dto as MediaRealQuoteRequestV3;
    return createHash('sha256').update(JSON.stringify({
      semanticHashVersion: 3, protocolVersion: 3, scope: context?.scope, adapter: context?.adapter,
      profileId: dto.profileId, configVersion: dto.configVersion,
      operation: dto.operation, specRevision: v3.specRevision, referenceIds: dto.referenceIds, referenceHashes,
      briefSha256: createHash('sha256').update(dto.creativeBrief.trim()).digest('hex'),
      requestedSpec: v3.requestedSpec, parameterSources: stableRecord(v3.parameterSources),
    })).digest('hex');
  }
  return createHash('sha256').update(JSON.stringify({
    profileId: dto.profileId, configVersion: dto.configVersion, operation: dto.operation,
    referenceHashes, briefSha256: createHash('sha256').update(dto.creativeBrief.trim()).digest('hex'),
    parameters: { size: dto.parameters.size, count: dto.parameters.count, quality: dto.parameters.quality },
  })).digest('hex');
}
