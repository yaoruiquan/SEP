import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TASK_EVENT_TYPE, TASK_RUN_STATUS, TASK_STEP_STATUS } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TaskEventBus } from './task-event-bus';
import { TaskEventRecorder } from './task-event-recorder';
import { TaskQueueService } from './task-queue.service';

/**
 * 失联判定阈值。worker 每 10s 心跳一次，60s 没动静就认为它没了。
 * 单步执行可能跑几分钟，但心跳是独立的 setInterval，不受单步耗时影响。
 */
const STALE_AFTER_MS = 60_000;

/**
 * 孤儿运行回收。
 *
 * 旧实现只有 `POST /tasks/:id/reconcile`，要用户自己打开那个任务才会触发，
 * 而用户看到的恰恰是「一直转圈」，不会想到去点它。改成定时扫描后，失联运行
 * 60 秒内自动收口。
 *
 * 判定依据是 heartbeatAt 而不是 updatedAt：updatedAt 会被任何无关写入刷新
 * （比如用户拖了下画布布局），拿它当心跳会让真的挂掉的运行看起来很健康。
 */
@Injectable()
export class TaskReconcileService implements OnModuleInit {
  private readonly logger = new Logger(TaskReconcileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: TaskQueueService,
    private readonly bus: TaskEventBus,
    private readonly events: TaskEventRecorder,
  ) {}

  /**
   * 进程启动时先扫一遍。
   *
   * 重启前正在跑的运行，它们的 worker 已经随进程消失了，但库里还是 RUNNING。
   * 不在启动时处理的话，要等到第一个 cron 周期，用户在这段时间里看到的是
   * 「还在跑」——而其实没有任何东西在跑。
   */
  onModuleInit() {
    void this.sweep().catch((error: Error) =>
      this.logger.error(`Startup sweep failed: ${error.message}`),
    );
  }

  @Cron('*/1 * * * *')
  async sweep(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_AFTER_MS);

    const stale = await this.prisma.taskRun.findMany({
      where: {
        status: TASK_RUN_STATUS.RUNNING,
        OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: cutoff } }],
      },
      select: { id: true, heartbeatAt: true, stopRequestedAt: true },
    });

    if (stale.length === 0) return;

    for (const run of stale) {
      const steps = await this.prisma.taskRunStep.findMany({
        where: { taskRunId: run.id },
        select: { id: true, stepKey: true, status: true, title: true, employeeName: true },
      });

      // 还有排队中的步骤且没人要求停止 —— 说明只是 worker 掉了，重新入队接着跑，
      // 而不是把任务判死。这是「关掉浏览器不断」之外的另一半：进程重启也不断。
      const resumable =
        !run.stopRequestedAt &&
        steps.some((step) => step.status === TASK_STEP_STATUS.QUEUED) &&
        !steps.some((step) => step.status === TASK_STEP_STATUS.FAILED);

      if (resumable) {
        const running = steps.filter((step) => step.status === TASK_STEP_STATUS.RUNNING);
        // 失联时正在跑的步骤无法判断它跑到哪了，退回排队让它重跑整步。
        // 重跑会重新计费，但半个产出比重复计费更糟 —— 后者可对账，前者不可用。
        if (running.length > 0) {
          await this.prisma.taskRunStep.updateMany({
            where: { id: { in: running.map((step) => step.id) } },
            data: { status: TASK_STEP_STATUS.QUEUED, startedAt: null, error: null },
          });
          for (const step of running) {
            this.bus.publish(run.id, { type: 'step_status', stepKey: step.stepKey, status: 'queued' });
          }
        }

        await this.prisma.taskRun.updateMany({
          where: { id: run.id },
          data: { claimedBy: null, heartbeatAt: new Date() },
        });
        await this.events.record({
          taskRunId: run.id,
          type: TASK_EVENT_TYPE.STEP_RESUMED,
          message: '执行进程曾中断，已自动接回并继续',
        });
        await this.queue.enqueue(run.id);
        this.logger.warn(`Re-enqueued stale run ${run.id}`);
        continue;
      }

      // 无处可续（步骤已失败，或用户要求过停止）：收口成 STOPPED，
      // 别让它永远挂在 RUNNING。
      const completedAt = new Date();
      await this.prisma.taskRunStep.updateMany({
        where: { taskRunId: run.id, status: TASK_STEP_STATUS.RUNNING },
        data: { status: TASK_STEP_STATUS.FAILED, error: '执行中断', completedAt },
      });
      await this.prisma.taskRun.updateMany({
        where: { id: run.id },
        data: {
          status: TASK_RUN_STATUS.STOPPED,
          completedAt,
          claimedBy: null,
          stopRequestedAt: null,
        },
      });

      this.bus.publish(run.id, {
        type: 'run_status',
        status: 'stopped',
        startedAt: null,
        completedAt: completedAt.toISOString(),
      });
      await this.events.record({
        taskRunId: run.id,
        type: TASK_EVENT_TYPE.RUN_STOPPED,
        message: '执行进程失联，已自动收口为已停止',
      });
      this.logger.warn(`Reconciled orphan run ${run.id} to STOPPED`);
    }
  }
}
