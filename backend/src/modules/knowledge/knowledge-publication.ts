import { Prisma } from '@prisma/client';
import type { EmbeddingProfile } from './embedding.service';

// Provenance only: adopted vectors have no verified complete embedding profile.
const legacyAdoptedProfile = { kind: 'legacy-adopted', compatibility: 'model-only' } as const;

/** SQL callers join knowledge_bases kb, documents d and document_versions dv. */
export const publishedChunkSql = Prisma.sql`
  kb."deletedAt" IS NULL AND d."deletedAt" IS NULL
  AND d."knowledgeBaseId" = kb.id
  AND (
    (tc."versionId" IS NULL AND d."activeVersionId" IS NULL AND d.status = 'READY')
    OR (tc."versionId" = d."activeVersionId" AND dv."documentId" = d.id
      AND dv.published = true AND dv.status = 'READY' AND dv.generation = tc."indexGeneration")
  )
`;

/** Prisma cannot compare related columns; isPublishedChunk must check the returned rows. */
export function publishedChunkWhere(knowledgeBase: Prisma.KnowledgeBaseWhereInput): Prisma.TextChunkWhereInput {
  return {
    knowledgeBase: { AND: [knowledgeBase, { deletedAt: null }] },
    document: { deletedAt: null },
    OR: [
      { versionId: null, document: { deletedAt: null, activeVersionId: null, status: 'READY' } },
      { versionId: { not: null }, document: { deletedAt: null, activeVersionId: { not: null } },
        version: { published: true, status: 'READY' } },
    ],
  };
}

export function vectorProfileSql(profile?: EmbeddingProfile): Prisma.Sql {
  if (!profile) return Prisma.sql`tc."versionId" IS NULL`;
  return Prisma.sql`tc."embeddingModel" = ${profile.model} AND (tc."versionId" IS NULL OR (
    dv.profile->'model' = ${JSON.stringify(profile.model)}::jsonb
    AND dv.profile->'dimension' = ${JSON.stringify(profile.dimension)}::jsonb
    AND dv.profile->'tokenizer' = ${JSON.stringify(profile.tokenizer)}::jsonb
    AND dv.profile->'distance' = ${JSON.stringify(profile.distance)}::jsonb
  ) OR dv.profile = ${JSON.stringify(legacyAdoptedProfile)}::jsonb)`;
}

export function vectorChunkWhere(knowledgeBase: Prisma.KnowledgeBaseWhereInput, profile?: EmbeddingProfile): Prisma.TextChunkWhereInput {
  return { ...publishedChunkWhere(knowledgeBase), ...(profile ? {
    embeddingModel: profile.model,
    AND: [{ OR: [{ versionId: null }, { version: { AND: [
      { profile: { path: ['model'], equals: profile.model } },
      { profile: { path: ['dimension'], equals: profile.dimension } },
      { profile: { path: ['tokenizer'], equals: profile.tokenizer } },
      { profile: { path: ['distance'], equals: profile.distance } },
    ] } }, { version: { profile: { equals: legacyAdoptedProfile } } }] }],
  } : { versionId: null }) };
}

export function sameEmbeddingProfile(stored: Prisma.JsonValue | undefined, profile: EmbeddingProfile): boolean {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return false;
  return stored.model === profile.model && stored.dimension === profile.dimension
    && stored.tokenizer === profile.tokenizer && stored.distance === profile.distance;
}

function isLegacyAdoptedProfile(stored: Prisma.JsonValue | undefined): boolean {
  return !!stored && typeof stored === 'object' && !Array.isArray(stored)
    && Object.keys(stored).length === 2 && stored.kind === legacyAdoptedProfile.kind
    && stored.compatibility === legacyAdoptedProfile.compatibility;
}

export const publicationSelect = {
  documentId: true, versionId: true, indexGeneration: true, embeddingModel: true,
  pageStart: true, pageEnd: true, sectionPath: true, blockStart: true, blockEnd: true,
  tokenCount: true,
  knowledgeBase: { select: { name: true, deletedAt: true } },
  document: { select: { id: true, originalName: true, knowledgeBaseId: true,
    deletedAt: true, activeVersionId: true, status: true } },
  version: { select: { id: true, documentId: true, published: true, publishedAt: true, retiredAt: true,
    status: true, generation: true, profile: true } },
} satisfies Prisma.TextChunkSelect;

type PublicationChunk = {
  knowledgeBaseId: string;
  documentId: string | null;
  versionId: string | null;
  indexGeneration: number;
  embeddingModel: string | null;
  tokenCount?: number | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  sectionPath?: string[];
  blockStart?: number;
  blockEnd?: number;
  knowledgeBase?: { name?: string | null; deletedAt: Date | null } | null;
  document?: { id: string; originalName: string; knowledgeBaseId: string; deletedAt: Date | null;
    activeVersionId: string | null; status: string } | null;
  version?: { id: string; documentId: string; published: boolean; publishedAt?: Date | null;
    retiredAt?: Date | null; status: string; generation: number; profile?: Prisma.JsonValue | null } | null;
};

export function isPublishedChunk(chunk: PublicationChunk): boolean {
  const { document, version } = chunk;
  if (!document || chunk.knowledgeBase?.deletedAt !== null || document.deletedAt !== null
    || document.id !== chunk.documentId || document.knowledgeBaseId !== chunk.knowledgeBaseId) return false;
  if (chunk.versionId === null) return document.activeVersionId === null && document.status === 'READY';
  return chunk.versionId === document.activeVersionId && version?.id === chunk.versionId
    && version.documentId === document.id && version.published === true && version.status === 'READY'
    && version.generation === chunk.indexGeneration;
}

export function isVectorCompatibleChunk(chunk: PublicationChunk, profile?: EmbeddingProfile): boolean {
  if (!isPublishedChunk(chunk)) return false;
  // Legacy rows have no profile. Keep their model-only path without inventing provenance.
  if (!profile) return chunk.versionId === null;
  return chunk.embeddingModel === profile.model && (chunk.versionId === null
    || isLegacyAdoptedProfile(chunk.version?.profile) || sameEmbeddingProfile(chunk.version?.profile, profile));
}
