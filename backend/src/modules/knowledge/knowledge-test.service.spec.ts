import { KnowledgeTestService } from './knowledge-test.service';

describe('KnowledgeTestService search telemetry', () => {
  it('redacts persisted queries and does not fail a successful retrieval when logging fails', async () => {
    const prisma: any = { knowledgeBase: { findFirst: jest.fn().mockResolvedValue({ id: 'kb-1' }) },
      knowledgeSearchLog: { create: jest.fn().mockRejectedValue(new Error('sensitive database detail')) } };
    const search: any = { searchByKnowledgeBase: jest.fn().mockResolvedValue([]) };
    const service = new KnowledgeTestService(prisma, search, {} as any);
    const log = jest.spyOn((service as any).logger, 'warn').mockImplementation();
    const response = await service.testSearch('kb-1', 'ent-1', {
      query: 'confidential question', topK: 3, scoreThreshold: 0.7, strategy: 'lexical',
    }, 'user-1');
    expect(response.hitCount).toBe(0);
    expect(prisma.knowledgeSearchLog.create.mock.calls[0][0].data.query).toBe('[REDACTED]');
    expect(log.mock.calls.flat().join(' ')).not.toMatch(/confidential|sensitive/);
  });
});
