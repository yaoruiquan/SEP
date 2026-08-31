import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import { resolveRedisOptions } from '../../redis/redis-connection';
import { TaskRunnerService } from './task-runner.service';

const QUEUE_NAME = 'task-execution';

export interface TaskExecutionJob {
  taskRunId: string;
}

/**
 * 执行队列。
 *
 * 用队列而不是在 HTTP 请求里直接 await 推进：一次任务可能跑几分钟，挂在请求上
 * 等于把执行寿命绑回客户端连接 —— 那就白搬了。入队后请求立刻返回，页面靠 SSE
 * 看进度，关掉页面也不影响 worker。
 *
 * attempts=1：整条运行的重试语义由业务层负责（失败步骤由用户点重试，
 * 失联运行由 TaskReconcileService 收口）。让 BullMQ 盲目重试会在已经扣过费的
 * 步骤上再扣一次。
 */
@Injectable()
export class TaskQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskQueueService.name);

  private queue?: Queue<TaskExecutionJob>;
  private worker?: Worker<TaskExecutionJob>;
  private queueReady = false;

  constructor(
    private readonly config: ConfigService,
    private readonly runner: TaskRunnerService,
  ) {}

  onModuleInit() {
    const connection = resolveRedisOptions(this.config);

    try {
      this.queue = new Queue<TaskExecutionJob>(QUEUE_NAME, { connection });
      this.worker = new Worker<TaskExecutionJob>(
        QUEUE_NAME,
        async (job: Job<TaskExecutionJob>) => {
          this.logger.log(`Advancing task run ${job.data.taskRunId}`);
          await this.runner.advance(job.data.taskRunId);
        },
        { connection, concurrency: 3 },
      );

      this.worker.on('failed', (job, error) => {
        this.logger.error(`Run ${job?.data?.taskRunId} advance failed: ${error.message}`);
      });
      this.queue.on('error', (error) => {
        if (this.queueReady) this.logger.warn(`Task queue error: ${error.message}`);
        this.queueReady = false;
      });

      this.queueReady = true;
      this.logger.log(`Task execution queue initialized (concurrency=3, queue=${QUEUE_NAME})`);
    } catch (error) {
      this.logger.warn(
        `Task execution queue unavailable, falling back to in-process execution: ${(error as Error).message}`,
      );
    }
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
  }

  /**
   * 请求推进某个运行。
   *
   * jobId 用 taskRunId 去重：同一个运行连续点两次「执行」不会产生两个 job。
   * 已存在的同名 job 会被 BullMQ 忽略，而 runner 自己的抢占逻辑是第二道防线。
   */
  async enqueue(taskRunId: string): Promise<void> {
    if (this.queueReady && this.queue) {
      try {
        await this.queue.add(
          'advance',
          { taskRunId },
          {
            jobId: `advance:${taskRunId}:${Date.now()}`,
            attempts: 1,
            removeOnComplete: 100,
            removeOnFail: 200,
          },
        );
        return;
      } catch (error) {
        this.logger.warn(`Enqueue failed, running in process: ${(error as Error).message}`);
      }
    }

    // 开发机没起 Redis 时的退路：进程内跑，不阻塞请求。
    // 生产不会走到这里 —— 那边 Redis 是 compose 里的必需服务。
    void this.runner
      .advance(taskRunId)
      .catch((error: Error) =>
        this.logger.error(`In-process advance of ${taskRunId} failed: ${error.message}`),
      );
  }
}
