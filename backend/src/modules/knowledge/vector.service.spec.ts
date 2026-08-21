import { VectorService } from './vector.service';

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
