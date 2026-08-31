import { Injectable, Logger } from '@nestjs/common';
import {
  TASK_EVENT_TYPE,
  TASK_RUN_STATUS,
  TASK_STEP_STATUS,
  type TaskRun,
  type TaskRunStep,
} from '@prisma/client';
import { hostname } from 'node:os';
import { PrismaService } from '../../prisma/prisma.service';
import { TaskDeliverableService } from './task-deliverable.service';
import { TaskEventBus } from './task-event-bus';
import { TaskEventRecorder } from './task-event-recorder';
import { TaskStepExecutor } from './task-step-executor.service';
import { pickNextRunnable } from './task-dependency';
import { RUN_STATUS_FROM_DB } from './task-step-mapper';

/** worker 心跳间隔。孤儿判定阈值是它的 6 倍，见 TaskReconcileService。 */
const HEARTBEAT_INTERVAL_MS = 10_000;

const TERMINAL_STEP_STATUSES: TASK_STEP_STATUS[] = [
  TASK_STEP_STATUS.COMPLETED,
  TASK_STEP_STATUS.SKIPPED,
];

/**
 * 运行推进器。
 *
 * 这是从浏览器搬过来的那个 for 循环 —— 区别在于状态每一步都落库、心跳可被
 * 外部观测、停止是数据库里的一个标志位而不是内存里的 ref。因此关掉标签页、
 * 刷新页面、甚至 API 进程重启，都不会让任务消失。
 *
 * 步骤按拓扑序**串行**执行。依赖图允许并行，但串行有两个现实好处：计费与
 * 余额闸门的行为可预测，且演示时「谁交给谁」的顺序肉眼可辨。真要并行是
 * 后续优化，不是闭环的前提。
 */
@Injectable()
export class TaskRunnerService {
  private readonly logger = new Logger(TaskRunnerService.name);
  private readonly workerId = `${hostname()}:${process.pid}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: TaskStepExecutor,
    private readonly deliverables: TaskDeliverableService,
    private readonly bus: TaskEventBus,
    private readonly events: TaskEventRecorder,
  ) {}

  /**
   * 推进一个运行直到它进入终态、或停在等人的位置（暂停）。
   *
   * 幂等：抢占失败（别的 worker 正在跑）直接返回，不会出现两个 worker 同时推进。
   */
  async advance(taskRunId: string): Promise<void> {
    const claimed = await this.claim(taskRunId);
    if (!claimed) {
      this.logger.debug(`Run ${taskRunId} is already claimed by another worker; skipping`);
      return;
    }

    const heartbeat = setInterval(() => {
      void this.prisma.taskRun
        .updateMany({ where: { id: taskRunId }, data: { heartbeatAt: new Date() } })
        .catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);

    try {
      await this.loop(taskRunId);
    } finally {
      clearInterval(heartbeat);
      await this.prisma.taskRun
        .updateMany({ where: { id: taskRunId, claimedBy: this.workerId }, data: { claimedBy: null } })
        .catch(() => undefined);
    }
  }

  /**
   * 抢占：只有 RUNNING 且当前没有活着的 worker 的运行才能被接手。
   * 用 updateMany 的 count 判定成功，避免「先查再写」的竞态。
   */
  private async claim(taskRunId: string): Promise<boolean> {
    const staleBefore = new Date(Date.now() - HEARTBEAT_INTERVAL_MS * 6);
    const result = await this.prisma.taskRun.updateMany({
      where: {
        id: taskRunId,
        status: TASK_RUN_STATUS.RUNNING,
        OR: [
          { claimedBy: null },
          { claimedBy: this.workerId },
          { heartbeatAt: null },
          { heartbeatAt: { lt: staleBefore } },
        ],
      },
      data: { claimedBy: this.workerId, heartbeatAt: new Date() },
    });
    return result.count === 1;
  }

  private async loop(taskRunId: string): Promise<void> {
    // 上限防呆：正常情况下每轮至少推进一个步骤，步骤数上限 50（StepsSchema）。
    // 加这个计数是为了万一出现「选中的步骤没被推进」的逻辑 bug 时不空转到天荒地老。
    for (let guard = 0; guard <= 200; guard += 1) {
      const run = await this.prisma.taskRun.findUnique({ where: { id: taskRunId } });
      if (!run || run.status !== TASK_RUN_STATUS.RUNNING) return;

      const steps = await this.prisma.taskRunStep.findMany({
        where: { taskRunId },
        orderBy: { order: 'asc' },
      });

      if (run.stopRequestedAt) {
        await this.finish(run, steps, TASK_RUN_STATUS.STOPPED);
        return;
      }

      if (steps.some((step) => step.status === TASK_STEP_STATUS.FAILED)) {
        await this.finish(run, steps, TASK_RUN_STATUS.FAILED);
        return;
      }

      const next = this.nextRunnable(steps);
      if (!next) {
        const allTerminal = steps.every((step) => TERMINAL_STEP_STATUSES.includes(step.status));
        if (allTerminal) {
          await this.finish(run, steps, TASK_RUN_STATUS.COMPLETED);
          return;
        }
        // 剩下的都在等人（暂停），或依赖链被暂停挡住。保持 RUNNING 并交出 worker，
        // 恢复接口会重新入队 —— 不要在这里忙等，那会白占一个 worker 槽位。
        this.logger.log(`Run ${taskRunId} is waiting on paused steps; releasing worker`);
        return;
      }

      const result = await this.executor.execute(run, next, steps);
      if (result.outcome === 'failed') {
        const refreshed = await this.prisma.taskRunStep.findMany({ where: { taskRunId } });
        const current = await this.prisma.taskRun.findUnique({ where: { id: taskRunId } });
        if (current) await this.finish(current, refreshed, TASK_RUN_STATUS.FAILED);
        return;
      }
    }

    this.logger.error(`Run ${taskRunId} exceeded the advance guard; releasing worker`);
  }

  /** 下一个可执行步骤：自己在排队，且所有依赖都已完成或跳过。判断逻辑见 task-dependency.ts。 */
  private nextRunnable(steps: TaskRunStep[]): TaskRunStep | undefined {
    const nodes = steps.map((step) => ({
      stepKey: step.stepKey,
      order: step.order,
      dependsOn: step.dependsOn,
      settled: TERMINAL_STEP_STATUSES.includes(step.status),
      queued: step.status === TASK_STEP_STATUS.QUEUED,
      step,
    }));
    return pickNextRunnable(nodes)?.step;
  }

  private async finish(
    run: TaskRun,
    steps: TaskRunStep[],
    status: TASK_RUN_STATUS,
  ): Promise<void> {
    const completedAt = new Date();

    // 停止时把还在排队/运行的步骤收口，否则界面上会留下永远「候场中」的步骤
    if (status === TASK_RUN_STATUS.STOPPED) {
      await this.prisma.taskRunStep.updateMany({
        where: { taskRunId: run.id, status: { in: [TASK_STEP_STATUS.RUNNING] } },
        data: { status: TASK_STEP_STATUS.FAILED, error: '执行已停止', completedAt },
      });
    }

    const updated = await this.prisma.taskRun.update({
      where: { id: run.id },
      data: {
        status,
        completedAt,
        claimedBy: null,
        stopRequestedAt: null,
      },
    });

    this.bus.publish(run.id, {
      type: 'run_status',
      status: RUN_STATUS_FROM_DB[status],
      startedAt: updated.startedAt?.toISOString() ?? null,
      completedAt: completedAt.toISOString(),
    });

    const eventType =
      status === TASK_RUN_STATUS.COMPLETED
        ? TASK_EVENT_TYPE.RUN_COMPLETED
        : status === TASK_RUN_STATUS.FAILED
          ? TASK_EVENT_TYPE.RUN_FAILED
          : TASK_EVENT_TYPE.RUN_STOPPED;

    const doneCount = steps.filter((step) => step.status === TASK_STEP_STATUS.COMPLETED).length;
    await this.events.record({
      taskRunId: run.id,
      type: eventType,
      message:
        status === TASK_RUN_STATUS.COMPLETED
          ? `全部 ${steps.length} 步已完成`
          : status === TASK_RUN_STATUS.FAILED
            ? `执行中断，已完成 ${doneCount}/${steps.length} 步`
            : `已停止，已完成 ${doneCount}/${steps.length} 步`,
    });

    if (status === TASK_RUN_STATUS.COMPLETED) {
      await this.deliverables.generate(updated, steps);
    }
  }
}
