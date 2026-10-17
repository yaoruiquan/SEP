import { VectorService } from './vector.service';
import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const profile = { model: 'model', dimension: 1024, tokenizer: 'tokenizer-v1', distance: 'cosine' as const };
const adoptedProfile = { kind: 'legacy-adopted', compatibility: 'model-only' };

function bytes(values: number[]) {
  return Buffer.from(new Float32Array(values).buffer);
}

function versioned(row: any) {
  return { ...row, documentId: 'doc', versionId: 'v-active', indexGeneration: 2,
    knowledgeBase: { deletedAt: null }, embeddingModel: profile.model,
    version: { id: 'v-active', documentId: 'doc', published: true, status: 'READY', generation: 2, profile: { ...profile } },
    document: { id: 'doc', knowledgeBaseId: row.knowledgeBaseId, deletedAt: null, status: 'FAILED', activeVersionId: 'v-active' } };
}

function published(row: any) {
  const active = versioned(row);
  return { ...active, versionId: null, version: null,
    document: { ...active.document, activeVersionId: null, status: 'READY' } };
}

describe('VectorService authorization scopes', () => {
  it('does not reuse one knowledge-base scope for another scope in the same enterprise', async () => {
    const prisma = {
      textChunk: {
        findMany: jest.fn()
          .mockResolvedValueOnce([published({ id: 'chunk-a', knowledgeBaseId: 'kb-a', embedding: bytes([1, 0]) })])
          .mockResolvedValueOnce([published({ id: 'chunk-a', knowledgeBaseId: 'kb-a' })])
          .mockResolvedValueOnce([published({ id: 'chunk-b', knowledgeBaseId: 'kb-b', embedding: bytes([0, 1]) })])
          .mockResolvedValueOnce([published({ id: 'chunk-b', knowledgeBaseId: 'kb-b' })]),
      },
    } as any;
    const service = new VectorService(prisma);

    await expect(service.search(new Float32Array([1, 0]), 'ent-a', ['kb-a'], 1))
      .resolves.toEqual([{ chunkId: 'chunk-a', score: 1 }]);
    await expect(service.search(new Float32Array([0, 1]), 'ent-a', ['kb-b'], 1))
      .resolves.toEqual([{ chunkId: 'chunk-b', score: 1 }]);

    expect(prisma.textChunk.findMany).toHaveBeenCalledTimes(4);
    expect(prisma.textChunk.findMany.mock.calls[0][0].where.knowledgeBase).toEqual({
      AND: [{ enterpriseId: 'ent-a', id: { in: ['kb-a'] } }, { deletedAt: null }],
    });
    expect(prisma.textChunk.findMany.mock.calls[2][0].where.knowledgeBase).toEqual({
      AND: [{ enterpriseId: 'ent-a', id: { in: ['kb-b'] } }, { deletedAt: null }],
    });
  });
});

describe('VectorService pgvector fallback policy', () => {
  it.each([
    { ...profile, dimension: 768 }, { ...profile, distance: 'dot' },
    { ...profile, model: '' }, { ...profile, tokenizer: '' },
  ])('rejects an invalid query profile before native or BYTEA access: %j', async queryProfile => {
    const prisma = { $queryRaw: jest.fn(), textChunk: { findMany: jest.fn() } } as any;
    await expect(new VectorService(prisma).search(new Float32Array(1024), 'ent-a', ['kb-a'], 1,
      queryProfile as typeof profile)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.textChunk.findMany).not.toHaveBeenCalled();
  });

  it('only falls back for pgvector migration compatibility errors and exposes diagnostics', async () => {
    const unitVector = new Float32Array(1024);
    unitVector[0] = 1;
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue({ code: 'P2010', meta: { code: '42703' } }),
      textChunk: {
        findMany: jest.fn().mockResolvedValue([
          published({ id: 'chunk-a', knowledgeBaseId: 'kb-a', embedding: Buffer.from(unitVector.buffer) }),
        ]),
      },
    } as any;
    const service = new VectorService(prisma);

    await expect(service.search(unitVector, 'ent-a', ['kb-a'], 1))
      .resolves.toEqual([{ chunkId: 'chunk-a', score: 1 }]);
    expect(service.getCacheStats().pgvector).toMatchObject({
      mode: 'compatibility-fallback',
      fallbackCount: 1,
      failureCount: 1,
    });
  });

  it.each([undefined, profile])('guards the native SQL and rechecks active publication (profile=%j)', async queryProfile => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ id: 'old', score: 1 }]),
      textChunk: { findMany: jest.fn().mockResolvedValue([{
        ...published({ id: 'old', knowledgeBaseId: 'kb-a' }),
        document: { ...published({ knowledgeBaseId: 'kb-a' }).document, activeVersionId: 'new' },
      }]) } } as any;
    const service = new VectorService(prisma);
    await expect(service.search(new Float32Array(1024), 'ent-a', ['kb-a'], 1, queryProfile)).resolves.toEqual([]);
    const call = prisma.$queryRaw.mock.calls[0];
    const sql = Prisma.sql(call[0], ...call.slice(1)).sql;
    expect(sql).toContain('LEFT JOIN document_versions dv');
    expect(sql).toContain('tc."versionId" = d."activeVersionId"');
    expect(sql).toContain('dv.generation = tc."indexGeneration"');
    expect(sql).toContain('kb."deletedAt" IS NULL');
    if (queryProfile) for (const field of ['model', 'dimension', 'tokenizer', 'distance']) {
      expect(sql).toContain(`dv.profile->'${field}'`);
    }
    if (queryProfile) {
      expect(sql).toContain('OR dv.profile =');
      expect(Prisma.sql(call[0], ...call.slice(1)).values).toContain(JSON.stringify(adoptedProfile));
    }
  });

  it.each(['native', 'BYTEA', 'compatibility-fallback'])('%s preserves explicitly adopted active vectors when latest fails', async path => {
    const query = new Float32Array(1024); query[0] = 1;
    const base = versioned({ id: 'adopted', knowledgeBaseId: 'kb-a', embedding: Buffer.from(query.buffer) });
    const row = { ...base, version: { ...base.version, profile: { ...adoptedProfile } } };
    const prisma = { ...(path === 'native' ? { $queryRaw: jest.fn().mockResolvedValue([{ id: row.id, score: 1 }]) }
      : path === 'compatibility-fallback' ? { $queryRaw: jest.fn().mockRejectedValue({ code: '42703' }) } : {}),
      textChunk: { findMany: jest.fn().mockResolvedValue([row]) } } as any;
    await expect(new VectorService(prisma).search(query, 'ent-a', ['kb-a'], 1, profile))
      .resolves.toEqual([{ chunkId: row.id, score: 1 }]);
    for (const [args] of prisma.textChunk.findMany.mock.calls) {
      expect(args.where.embeddingModel).toBe(profile.model);
      expect(args.where.knowledgeBase).toEqual({ AND: [{ enterpriseId: 'ent-a', id: { in: ['kb-a'] } }, { deletedAt: null }] });
      expect(args.where.AND[0].OR).toContainEqual({ version: { profile: { equals: adoptedProfile } } });
    }
  });

  it.each(['model', 'active', 'generation', 'published', 'marker', 'null-profile'])('rejects adopted %s changes at recall and final recheck', async change => {
    const base = versioned({ id: 'adopted', knowledgeBaseId: 'kb-a', embedding: bytes(Array(1024).fill(1)) });
    const row = { ...base, version: { ...base.version, profile: { ...adoptedProfile } } };
    const changed = change === 'model' ? { ...row, embeddingModel: 'other' }
      : change === 'active' ? { ...row, document: { ...row.document, activeVersionId: 'new' } }
      : change === 'generation' ? { ...row, indexGeneration: 1 }
      : change === 'published' ? { ...row, version: { ...row.version, published: false } }
      : { ...row, version: { ...row.version, profile: change === 'null-profile' ? null : { ...adoptedProfile, dimension: 768 } } };
    for (const path of ['native', 'load', 'recheck', 'fallback']) {
      const prisma = { ...(path === 'native' ? { $queryRaw: jest.fn().mockResolvedValue([{ id: row.id, score: 1 }]) }
        : path === 'fallback' ? { $queryRaw: jest.fn().mockRejectedValue({ code: '42703' }) } : {}),
        textChunk: { findMany: path === 'recheck' ? jest.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([changed])
          : jest.fn().mockResolvedValue([changed]) } } as any;
      await expect(new VectorService(prisma).search(new Float32Array(1024).fill(1), 'ent-a', ['kb-a'], 1, profile)).resolves.toEqual([]);
    }
  });

  it.each(['native', 'BYTEA', 'compatibility-fallback'])('%s requires a query profile for adopted vectors', async path => {
    const base = versioned({ id: 'adopted', knowledgeBaseId: 'kb-a', embedding: bytes(Array(1024).fill(1)) });
    const row = { ...base, version: { ...base.version, profile: adoptedProfile } };
    const prisma = { ...(path === 'native' ? { $queryRaw: jest.fn().mockResolvedValue([{ id: row.id, score: 1 }]) }
      : path === 'compatibility-fallback' ? { $queryRaw: jest.fn().mockRejectedValue({ code: '42703' }) } : {}),
      textChunk: { findMany: jest.fn().mockResolvedValue([row]) } } as any;
    await expect(new VectorService(prisma).search(new Float32Array(1024).fill(1), 'ent-a', ['kb-a'], 1)).resolves.toEqual([]);
  });

  it('still rejects adopted BYTEA vectors with a different actual dimension', async () => {
    const base = versioned({ id: 'adopted', knowledgeBaseId: 'kb-a', embedding: bytes([1, 0]) });
    const row = { ...base, version: { ...base.version, profile: adoptedProfile } };
    const prisma = { textChunk: { findMany: jest.fn().mockResolvedValue([row]) } } as any;
    await expect(new VectorService(prisma).search(new Float32Array(1024).fill(1), 'ent-a', ['kb-a'], 1, profile)).resolves.toEqual([]);
  });

  it.each(['native', 'BYTEA', 'compatibility-fallback'])('%s accepts a complete matching version profile', async path => {
    const row = versioned({ id: 'chunk', knowledgeBaseId: 'kb-a', embedding: bytes(Array(1024).fill(0).map((_, i) => i === 0 ? 1 : 0)) });
    const prisma = { ...(path === 'native' ? { $queryRaw: jest.fn().mockResolvedValue([{ id: 'chunk', score: 1 }]) }
      : path === 'compatibility-fallback' ? { $queryRaw: jest.fn().mockRejectedValue({ code: '42703' }) } : {}),
      textChunk: { findMany: jest.fn().mockResolvedValue([row]) } } as any;
    const query = new Float32Array(1024); query[0] = 1;
    await expect(new VectorService(prisma).search(query, 'ent-a', ['kb-a'], 1, profile))
      .resolves.toEqual([{ chunkId: 'chunk', score: 1 }]);
  });

  it.each([null, {}, { ...profile, model: 'other' }, { ...profile, dimension: 768 },
    { ...profile, tokenizer: 'other' }, { ...profile, distance: 'dot' },
  ])('rejects profile mismatch in native and BYTEA recall/final recheck: %j', async stored => {
    const row = versioned({ id: 'chunk', knowledgeBaseId: 'kb-a', embedding: bytes(Array(1024).fill(0)) });
    const mismatch = { ...row, version: { ...row.version, profile: stored } };
    for (const path of ['native', 'load', 'recheck', 'fallback']) {
      const prisma = { ...(path === 'native' ? { $queryRaw: jest.fn().mockResolvedValue([{ id: 'chunk', score: 1 }]) }
        : path === 'fallback' ? { $queryRaw: jest.fn().mockRejectedValue({ code: '42703' }) } : {}),
        textChunk: { findMany: path === 'recheck' ? jest.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([mismatch])
          : jest.fn().mockResolvedValue([mismatch]) } } as any;
      await expect(new VectorService(prisma).search(new Float32Array(1024), 'ent-a', ['kb-a'], 1, profile)).resolves.toEqual([]);
    }
  });

  it('fails closed for versioned BYTEA without a query profile but preserves legacy model-only rows', async () => {
    const row = versioned({ id: 'chunk', knowledgeBaseId: 'kb-a', embedding: bytes([1, 0]) });
    const prisma = { textChunk: { findMany: jest.fn().mockResolvedValue([row]) } } as any;
    await expect(new VectorService(prisma).search(new Float32Array([1, 0]), 'ent-a', ['kb-a'], 1)).resolves.toEqual([]);
    prisma.textChunk.findMany.mockResolvedValue([published({ id: 'legacy', knowledgeBaseId: 'kb-a', embedding: bytes([1, 0]) })]);
    await expect(new VectorService(prisma).search(new Float32Array([1, 0]), 'ent-a', ['kb-a'], 1, { ...profile, dimension: 2 }))
      .resolves.toEqual([{ chunkId: 'legacy', score: 1 }]);
  });

  it('does not reuse a publication snapshot after another process deletes or publishes', async () => {
    const row = published({ id: 'old', knowledgeBaseId: 'kb-a', embedding: bytes([1, 0]) });
    const prisma = { textChunk: { findMany: jest.fn().mockResolvedValueOnce([row])
      .mockResolvedValueOnce([row]).mockResolvedValueOnce([]) } } as any;
    const service = new VectorService(prisma);
    expect(await service.search(new Float32Array([1, 0]), 'ent-a', ['kb-a'], 1)).toHaveLength(1);
    expect(await service.search(new Float32Array([1, 0]), 'ent-a', ['kb-a'], 1)).toEqual([]);
    expect(service.getCacheStats()).toMatchObject({ cacheEnabled: false, cachedEnterprises: 0 });
  });

  it('rejects BYTEA results when the active version changes after loading vectors', async () => {
    const row = published({ id: 'old', knowledgeBaseId: 'kb-a', embedding: bytes([1, 0]) });
    const prisma = { textChunk: { findMany: jest.fn().mockResolvedValueOnce([row])
      .mockResolvedValueOnce([{ ...row, document: { ...row.document, activeVersionId: 'v-new' } }]) } } as any;
    await expect(new VectorService(prisma).search(new Float32Array([1, 0]), 'ent-a', ['kb-a'], 1)).resolves.toEqual([]);
  });

  it('propagates native vector write errors inside an existing transaction', async () => {
    const failure = { code: '42703' };
    const tx = { $executeRaw: jest.fn().mockRejectedValue(failure) };
    const service = new VectorService({} as any);
    await expect(service.upsertVector('chunk', new Float32Array(1024), tx as any)).rejects.toBe(failure);
  });

  it('does not hide unexpected pgvector failures behind an O(N) scan', async () => {
    const failure = new Error('database connection lost');
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(failure),
      textChunk: { findMany: jest.fn() },
    } as any;
    const service = new VectorService(prisma);

    await expect(service.search(new Float32Array(1024), 'ent-a', ['kb-a'], 1))
      .rejects.toBe(failure);
    expect(prisma.textChunk.findMany).not.toHaveBeenCalled();
    expect(service.getCacheStats().pgvector).toMatchObject({
      mode: 'unknown',
      fallbackCount: 0,
      failureCount: 1,
      lastError: 'database connection lost',
    });
  });

  it('rejects legacy fallback when the candidate set exceeds the bounded limit', async () => {
    const prisma = {
      textChunk: {
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: 10_001 }, (_, i) => ({
            id: `chunk-${i}`,
            knowledgeBaseId: 'kb-a',
            embedding: bytes([1, 0]),
          })),
        ),
      },
    } as any;
    const service = new VectorService(prisma);

    await expect(service.search(new Float32Array([1, 0]), 'ent-a', ['kb-a'], 1))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.textChunk.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10_001 }),
    );
  });
});
