import { VectorService } from './vector.service';
import { ServiceUnavailableException } from '@nestjs/common';

function bytes(values: number[]) {
  return Buffer.from(new Float32Array(values).buffer);
}

describe('VectorService authorization scopes', () => {
  it('does not reuse one knowledge-base scope for another scope in the same enterprise', async () => {
    const prisma = {
      textChunk: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: 'chunk-a', knowledgeBaseId: 'kb-a', embedding: bytes([1, 0]) }])
          .mockResolvedValueOnce([{ id: 'chunk-b', knowledgeBaseId: 'kb-b', embedding: bytes([0, 1]) }]),
      },
    } as any;
    const service = new VectorService(prisma);

    await expect(service.search(new Float32Array([1, 0]), 'ent-a', ['kb-a'], 1))
      .resolves.toEqual([{ chunkId: 'chunk-a', score: 1 }]);
    await expect(service.search(new Float32Array([0, 1]), 'ent-a', ['kb-b'], 1))
      .resolves.toEqual([{ chunkId: 'chunk-b', score: 1 }]);

    expect(prisma.textChunk.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('VectorService pgvector fallback policy', () => {
  it('only falls back for pgvector migration compatibility errors and exposes diagnostics', async () => {
    const unitVector = new Float32Array(1024);
    unitVector[0] = 1;
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue({ code: 'P2010', meta: { code: '42703' } }),
      textChunk: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'chunk-a', knowledgeBaseId: 'kb-a', embedding: Buffer.from(unitVector.buffer) },
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
