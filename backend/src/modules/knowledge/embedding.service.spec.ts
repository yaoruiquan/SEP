import { EmbeddingService } from './embedding.service';

describe('EmbeddingService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('does not duplicate /v1 for OpenAI-compatible origins', async () => {
    const config = {
      get: jest.fn((key: string) => ({
        EMBEDDING_PROVIDER: 'openai',
        EMBEDDING_BASE_URL: 'https://embedding.example/v1',
        EMBEDDING_MODEL: 'text-embedding-3-small',
        EMBEDDING_DIMENSION: '2',
        EMBEDDING_API_KEY: 'key',
      }[key])),
    } as any;
    const service = new EmbeddingService(config);
    service.onModuleInit();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1, 0] }] }),
    }) as any;

    await service.embed('测试');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://embedding.example/v1/embeddings',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects responses whose dimension differs from configured model dimension', async () => {
    const config = {
      get: jest.fn((key: string) => ({
        EMBEDDING_PROVIDER: 'tei',
        EMBEDDING_BASE_URL: 'http://embedding:8080',
        EMBEDDING_MODEL: 'BAAI/bge-small-zh-v1.5',
        EMBEDDING_DIMENSION: '2',
      }[key])),
    } as any;
    const service = new EmbeddingService(config);
    service.onModuleInit();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [[1, 0, 0]],
    }) as any;

    await expect(service.embed('测试')).rejects.toThrow('Embedding dimension mismatch');
  });
});
