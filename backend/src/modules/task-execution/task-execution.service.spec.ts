import { ConflictException } from '@nestjs/common';
import { TaskExecutionService } from './task-execution.service';

describe('TaskExecutionService closure protection', () => {
  let prisma: any;
  let queue: any;
  let service: TaskExecutionService;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn((query: TemplateStringsArray) => Promise.resolve([
        { status: query.join('').includes('FROM enterprises') ? 'CLOSED' : 'ACTIVE' },
      ])),
      $transaction: jest.fn(),
      taskRun: { findUnique: jest.fn().mockResolvedValue({ id: 'task-1', userId: 'user-1', enterpriseId: 'ent-1' }), update: jest.fn() },
      taskRunStep: { update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    queue = { enqueue: jest.fn() };
    service = new TaskExecutionService(prisma, queue, { publish: jest.fn() } as any, { record: jest.fn() } as any);
  });

  it.each(['run', 'resumeStep'] as const)('rejects %s after enterprise closure without scheduling work', async (method) => {
    await expect(service[method]('task-1', 'user-1', 'step-1')).rejects.toThrow(ConflictException);
    expect(prisma.$queryRaw.mock.calls[0][0].join('')).toContain('FROM users');
    expect(prisma.$queryRaw.mock.calls[1][0].join('')).toContain('FROM enterprises');
    expect(prisma.taskRun.update).not.toHaveBeenCalled();
    expect(prisma.taskRunStep.update).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
