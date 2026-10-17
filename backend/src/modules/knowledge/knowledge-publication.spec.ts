import { Prisma } from '@prisma/client';
import { isPublishedChunk, isVectorCompatibleChunk, publishedChunkSql, publishedChunkWhere, vectorChunkWhere, vectorProfileSql } from './knowledge-publication';

const profile = { model: 'model', dimension: 1024, tokenizer: 'tokenizer-v1', distance: 'cosine' as const };
const adoptedProfile = { kind: 'legacy-adopted', compatibility: 'model-only' };

const chunk = () => ({
  knowledgeBaseId: 'kb', documentId: 'doc', versionId: 'v1', indexGeneration: 2, embeddingModel: profile.model,
  knowledgeBase: { deletedAt: null },
  document: { id: 'doc', originalName: 'file.txt', knowledgeBaseId: 'kb', deletedAt: null,
    activeVersionId: 'v1', status: 'FAILED' as const },
  version: { id: 'v1', documentId: 'doc', published: true, status: 'READY' as const, generation: 2, profile: { ...profile } },
});

describe('knowledge publication boundary', () => {
  it('keeps the active READY version searchable when a newer version fails', () => {
    expect(isPublishedChunk(chunk())).toBe(true);
    expect(isVectorCompatibleChunk(chunk(), profile)).toBe(true);
  });

  it.each([null, {}, { ...profile, model: 'other' }, { ...profile, dimension: 768 },
    { ...profile, dimension: '1024' }, { ...profile, tokenizer: 'other' }, { ...profile, distance: 'dot' },
  ])('rejects incomplete or mismatched vector profiles while retaining lexical publication: %j', stored => {
    const row = { ...chunk(), version: { ...chunk().version, profile: stored } };
    expect(isPublishedChunk(row)).toBe(true);
    expect(isVectorCompatibleChunk(row, profile)).toBe(false);
  });

  it('never treats missing query or version profiles as a match for versioned data', () => {
    expect(isVectorCompatibleChunk(chunk())).toBe(false);
    expect(isVectorCompatibleChunk({ ...chunk(), embeddingModel: 'other' }, profile)).toBe(false);
  });

  it('accepts explicitly adopted old active vectors without fabricating a complete profile', () => {
    const row = { ...chunk(), version: { ...chunk().version, profile: { ...adoptedProfile } } };
    expect(isPublishedChunk(row)).toBe(true);
    expect(isVectorCompatibleChunk(row, profile)).toBe(true);
    expect(isVectorCompatibleChunk(row, { ...profile, tokenizer: 'different-tokenizer' })).toBe(true);
    expect(isVectorCompatibleChunk(row)).toBe(false);
    expect(isVectorCompatibleChunk({ ...row, embeddingModel: 'other' }, profile)).toBe(false);
    expect(row.version.profile).toEqual(adoptedProfile);
    expect(row.version.profile).not.toHaveProperty('model');
    expect(row.version.profile).not.toHaveProperty('dimension');
  });

  it.each([
    { kind: 'legacy-adopted' }, { compatibility: 'model-only' },
    { ...adoptedProfile, kind: 'new-version' }, { ...adoptedProfile, compatibility: 'full' },
    { ...adoptedProfile, dimension: 768 }, { ...adoptedProfile, ...profile, tokenizer: 'other' },
    [adoptedProfile], 'legacy-adopted',
  ])('does not widen model-only compatibility to a partial or extended marker: %j', stored => {
    const row = { ...chunk(), version: { ...chunk().version, profile: stored } };
    expect(isPublishedChunk(row)).toBe(true);
    expect(isVectorCompatibleChunk(row, profile)).toBe(false);
  });

  it.each([
    ['unpublished', { version: { ...chunk().version, profile: adoptedProfile, published: false } }],
    ['failed', { version: { ...chunk().version, profile: adoptedProfile, status: 'FAILED' } }],
    ['old generation', { indexGeneration: 1 }],
    ['inactive', { document: { ...chunk().document, activeVersionId: 'v2' } }],
    ['deleted KB', { knowledgeBase: { deletedAt: new Date() } }],
    ['deleted document', { document: { ...chunk().document, deletedAt: new Date() } }],
  ])('still rejects adopted vectors that are %s', (_name, overrides) => {
    const row = { ...chunk(), version: { ...chunk().version, profile: adoptedProfile }, ...overrides };
    expect(isVectorCompatibleChunk(row as any, profile)).toBe(false);
  });

  it('retains model-only legacy compatibility without fabricating a version profile', () => {
    const legacy = { ...chunk(), versionId: null, version: null,
      document: { ...chunk().document, activeVersionId: null, status: 'READY' as const } };
    expect(isVectorCompatibleChunk(legacy, profile)).toBe(true);
    expect(isVectorCompatibleChunk(legacy)).toBe(true);
    expect(isVectorCompatibleChunk({ ...legacy, embeddingModel: 'other' }, profile)).toBe(false);
    expect(legacy.version).toBeNull();
  });

  it('applies all four typed profile fields in SQL and Prisma before recall', () => {
    const sql = vectorProfileSql(profile);
    for (const field of ['model', 'dimension', 'tokenizer', 'distance']) expect(sql.sql).toContain(`dv.profile->'${field}'`);
    expect(sql.values).toEqual([profile.model, JSON.stringify(profile.model), '1024',
      JSON.stringify(profile.tokenizer), JSON.stringify(profile.distance), JSON.stringify(adoptedProfile)]);
    expect(sql.sql).toContain('OR dv.profile =');
    expect(sql.sql).toContain('::jsonb');
    const where = vectorChunkWhere({ enterpriseId: 'ent' }, profile);
    expect(where.embeddingModel).toBe(profile.model);
    expect(where.AND).toEqual([{ OR: [{ versionId: null }, { version: { AND: [
      { profile: { path: ['model'], equals: profile.model } },
      { profile: { path: ['dimension'], equals: profile.dimension } },
      { profile: { path: ['tokenizer'], equals: profile.tokenizer } },
      { profile: { path: ['distance'], equals: profile.distance } },
    ] } }, { version: { profile: { equals: adoptedProfile } } }] }]);
    expect(vectorChunkWhere({}, undefined).versionId).toBeNull();
  });

  it.each([
    ['deleted KB', { knowledgeBase: { deletedAt: new Date() } }],
    ['deleted document', { document: { ...chunk().document, deletedAt: new Date() } }],
    ['missing document', { document: null }],
    ['unpublished version', { version: { ...chunk().version, published: false } }],
    ['failed version', { version: { ...chunk().version, status: 'FAILED' } }],
    ['outdated generation', { indexGeneration: 1 }],
    ['non-active version', { document: { ...chunk().document, activeVersionId: 'v2' } }],
    ['legacy chunk after adoption', { versionId: null }],
    ['missing version relation', { version: null }],
    ['foreign version document', { version: { ...chunk().version, documentId: 'other' } }],
    ['foreign document KB', { document: { ...chunk().document, knowledgeBaseId: 'other' } }],
  ])('rejects %s', (_name, overrides) => {
    expect(isPublishedChunk({ ...chunk(), ...overrides } as any)).toBe(false);
  });

  it('accepts only READY legacy documents without an active version', () => {
    const legacy = { ...chunk(), versionId: null, version: null,
      document: { ...chunk().document, activeVersionId: null, status: 'READY' as const } };
    expect(isPublishedChunk(legacy)).toBe(true);
    expect(isPublishedChunk({ ...legacy, document: { ...legacy.document, status: 'FAILED' } })).toBe(false);
  });

  it('prefilters both publication branches without imposing document READY on versioned chunks', () => {
    expect(publishedChunkWhere({ enterpriseId: 'ent' })).toMatchObject({
      knowledgeBase: { AND: [{ enterpriseId: 'ent' }, { deletedAt: null }] },
      document: { deletedAt: null },
      OR: [
        { versionId: null, document: { activeVersionId: null, status: 'READY' } },
        { versionId: { not: null }, version: { published: true, status: 'READY' } },
      ],
    });
  });

  it('uses the same exact column comparisons for native retrieval', () => {
    const sql = Prisma.sql`WHERE ${publishedChunkSql}`.sql;
    for (const predicate of ['kb."deletedAt" IS NULL', 'd."deletedAt" IS NULL',
      'tc."versionId" IS NULL AND d."activeVersionId" IS NULL AND d.status = \'READY\'',
      'tc."versionId" = d."activeVersionId"', 'dv.published = true', "dv.status = 'READY'",
      'dv.generation = tc."indexGeneration"']) expect(sql).toContain(predicate);
  });
});
