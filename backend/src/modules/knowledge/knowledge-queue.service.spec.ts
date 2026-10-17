import { KnowledgeQueueService } from './knowledge-queue.service';

describe('durable knowledge delivery maintenance', () => {
  it('still delivers durable jobs when optional orphan maintenance fails', async () => {
    const prisma = { knowledgeProcessingJob: { findMany: jest.fn()
      .mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'waiting-job' }]) } };
    const service = new KnowledgeQueueService({} as any, prisma as any, {} as any);
    jest.spyOn(service as any, 'maintain').mockRejectedValue(new Error('Private volume unavailable'));
    const add = jest.fn().mockResolvedValue({});
    (service as any).queue = { add };
    await expect(service.deliver()).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledWith('process-version', { jobId: 'waiting-job' }, expect.any(Object));
    expect(service.isReady()).toBe(true);
  });

  it('keeps the database outbox intact if Redis delivery fails, then redelivers after recovery', async () => {
    const job = { id: 'durable-job' };
    const findMany = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([job])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([job]);
    const prisma = { knowledgeProcessingJob: { findMany } };
    const service = new KnowledgeQueueService({} as any, prisma as any, {} as any);
    jest.spyOn(service as any, 'maintain').mockResolvedValue(undefined);
    const add = jest.fn().mockRejectedValueOnce(new Error('Redis unavailable')).mockResolvedValueOnce({});
    (service as any).queue = { add };
    await expect(service.deliver()).rejects.toThrow('Redis unavailable');
    expect(service.isReady()).toBe(false);
    await service.deliver();
    expect(add).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenLastCalledWith('process-version', { jobId: 'durable-job' }, expect.any(Object));
    expect(service.isReady()).toBe(true);
  });

  it('exposes stranded legacy jobs as failed and safely checks both original reference tables', async () => {
    const prisma = { document: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findFirst: jest.fn().mockResolvedValue(null) },
      documentVersion: { findFirst: jest.fn().mockResolvedValue({ id: 'referenced' }) } };
    const service = new KnowledgeQueueService({} as any, prisma as any, {} as any);
    const sweep = jest.spyOn((service as any).storage, 'sweepUnreferenced').mockImplementation(async (...args: any[]) => {
      expect(await args[0]('/private/original')).toBe(true);
      return 0;
    });
    await (service as any).maintain();
    await (service as any).maintain();
    expect(prisma.document.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      latestVersionId: null, deletedAt: null, status: { in: ['PENDING', 'PROCESSING'] },
    }), data: expect.objectContaining({ status: 'FAILED' }) }));
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(prisma.document.findFirst).toHaveBeenCalled();
    expect(prisma.documentVersion.findFirst).toHaveBeenCalled();
  });
});
