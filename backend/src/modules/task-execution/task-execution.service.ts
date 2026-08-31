import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  TASK_EVENT_TYPE,
  TASK_RUN_STATUS,
  TASK_STEP_STATUS,
  type TaskRun,
  type TaskRunStep,
} from '@prisma/client';
import type { TaskExecutionSnapshot, TaskRunStepView } from 'shared';
import { PrismaService } from '../../prisma/prisma.service';
import { collectDownstream } from './task-dependency';
import { TaskEventBus } from './task-event-bus';
import { TaskEventRecorder } from './task-event-recorder';
import { TaskQueueService } from './task-queue.service';
import {
  seedsFromPlanJson,
  serializeSnapshot,
  serializeStep,
  type PlanStepSeed,
} from './task-step-mapper';

/** 「继续执行」时应该被复活的步骤状态：失败的重跑，暂停的放行。已完成的不动。 */
const REVIVABLE_STEP_STATUSES: TASK_STEP_STATUS[] = [
  TASK_STEP_STATUS.FAILED,
  TASK_STEP_STATUS.PAUSED,
];

@Injectable()
export class TaskExecutionService {
  private readonly logger = new Logger(TaskExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: TaskQueueService,
    private readonly bus: TaskEventBus,
    private readonly events: TaskEventRecorder,
  ) {}

  // ── 读 ────────────────────────────────────────────────────────────────────

  async snapshot(taskRunId: string, userId: string): Promise<TaskExecutionSnapshot> {
    const run = await this.owned(taskRunId, userId);
    const steps = await this.materialize(run);
    return serializeSnapshot(run, steps);
  }

  async deliverable(taskRunId: string, userId: string) {
    const run = await this.owned(taskRunId, userId);
    return {
      deliverable: run.deliverable,
      generatedAt: run.deliverableGeneratedAt?.toISOString() ?? null,
      degraded: run.deliverableDegraded,
    };
  }

  /** 步骤的完整对话（会议：「每一步结果均可查看」不止是看最后那段文本） */
  async stepMessages(taskRunId: string, userId: string, stepKey: string) {
    await this.owned(taskRunId, userId);
    const step = await this.prisma.taskRunStep.findUnique({
      where: { taskRunId_stepKey: { taskRunId, stepKey } },
    });
    if (!step) throw new NotFoundException('Step not found');
    if (!step.sessionId) return { step: serializeStep(step), messages: [] };

    const messages = await this.prisma.message.findMany({
      where: { sessionId: step.sessionId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        toolCalls: true,
        modelId: true,
        createdAt: true,
      },
    });

    return {
      step: serializeStep(step),
      messages: messages.map((message) => ({
        ...message,
        createdAt: message.createdAt.toISOString(),
      })),
    };
  }

  // ── 写 ────────────────────────────────────────────────────────────────────

  /**
   * 确认计划并开始执行。
   *
   * 幂等：已经 RUNNING 时返回 409 而不是再排一次 —— 双击「确认并执行」是最常见的
   * 误操作，静默重排会导致同一步被跑两次（各扣一次费）。
   */
  async run(taskRunId: string, userId: string, fromStepKey?: string): Promise<TaskExecutionSnapshot> {
    const run = await this.owned(taskRunId, userId);
    if (run.status === TASK_RUN_STATUS.RUNNING) {
      throw new ConflictException('任务正在执行中');
    }

    const steps = await this.materialize(run);
    if (steps.length === 0) {
      throw new BadRequestException('这个任务没有可执行的步骤');
    }

    if (fromStepKey) {
      const target = steps.find((step) => step.stepKey === fromStepKey);
      if (!target) throw new NotFoundException('Step not found');
      await this.resetFrom(steps, fromStepKey, taskRunId);
    } else {
      // 不指定起点时只重置失败与暂停的步骤，已完成的产出保留 ——
      // 「继续执行」不该把前面跑好的步骤再跑一遍。
      const revivable = steps.filter((step) => REVIVABLE_STEP_STATUSES.includes(step.status));
      if (revivable.length > 0) {
        await this.prisma.taskRunStep.updateMany({
          where: { id: { in: revivable.map((step) => step.id) } },
          data: { status: TASK_STEP_STATUS.QUEUED, error: null, startedAt: null, completedAt: null, durationMs: null },
        });
      }
    }

    const startedAt = run.startedAt ?? new Date();
    const updated = await this.prisma.taskRun.update({
      where: { id: taskRunId },
      data: {
        status: TASK_RUN_STATUS.RUNNING,
        startedAt,
        completedAt: null,
        stopRequestedAt: null,
        heartbeatAt: new Date(),
        claimedBy: null,
        deliverable: null,
        deliverableGeneratedAt: null,
        deliverableDegraded: false,
      },
    });

    this.bus.publish(taskRunId, {
      type: 'run_status',
      status: 'running',
      startedAt: startedAt.toISOString(),
      completedAt: null,
    });
    await this.events.record({
      taskRunId,
      type: TASK_EVENT_TYPE.RUN_STARTED,
      message: fromStepKey ? `从「${fromStepKey}」重新开始执行` : '开始执行',
    });

    await this.queue.enqueue(taskRunId);

    const fresh = await this.prisma.taskRunStep.findMany({ where: { taskRunId }, orderBy: { order: 'asc' } });
    return serializeSnapshot(updated, fresh);
  }

  /**
   * 请求停止。只写标志位，由 worker 在步骤边界响应。
   *
   * 不硬杀正在跑的模型调用：那会留下「扣了费但没有产出」的黑洞。等当前步骤
   * 自然结束再停，用户多等几十秒，但账和产出都是完整的。
   */
  async stop(taskRunId: string, userId: string): Promise<TaskExecutionSnapshot> {
    const run = await this.owned(taskRunId, userId);
    if (run.status !== TASK_RUN_STATUS.RUNNING) {
      const steps = await this.prisma.taskRunStep.findMany({ where: { taskRunId }, orderBy: { order: 'asc' } });
      return serializeSnapshot(run, steps);
    }

    const updated = await this.prisma.taskRun.update({
      where: { id: taskRunId },
      data: { stopRequestedAt: new Date() },
    });
    await this.events.record({
      taskRunId,
      type: TASK_EVENT_TYPE.RUN_STOPPED,
      message: '已请求停止，当前步骤结束后收工',
    });

    const steps = await this.prisma.taskRunStep.findMany({ where: { taskRunId }, orderBy: { order: 'asc' } });
    return serializeSnapshot(updated, steps);
  }

  /** 从某一步重跑：该步及其所有下游一起回到排队状态。 */
  async retryStep(taskRunId: string, userId: string, stepKey: string): Promise<TaskExecutionSnapshot> {
    return this.run(taskRunId, userId, stepKey);
  }

  async pauseStep(taskRunId: string, userId: string, stepKey: string): Promise<TaskRunStepView> {
    await this.owned(taskRunId, userId);
    const step = await this.requireStep(taskRunId, stepKey);

    if (step.status !== TASK_STEP_STATUS.QUEUED) {
      // 正在跑的步骤不能暂停：模型调用已经发出去了，"暂停"只能是幻觉。
      // 想停正在跑的那步就是停止整个运行。
      throw new ConflictException('只能暂停还在排队的步骤；正在执行的请用停止');
    }

    const updated = await this.prisma.taskRunStep.update({
      where: { id: step.id },
      data: { status: TASK_STEP_STATUS.PAUSED },
    });
    this.bus.publish(taskRunId, { type: 'step_status', stepKey, status: 'paused' });
    await this.events.record({
      taskRunId,
      type: TASK_EVENT_TYPE.STEP_PAUSED,
      stepId: stepKey,
      stepTitle: step.title,
      employeeName: step.employeeName,
      message: `${step.employeeName} 已停下，等你恢复`,
    });
    return serializeStep(updated);
  }

  async resumeStep(taskRunId: string, userId: string, stepKey: string): Promise<TaskRunStepView> {
    const run = await this.owned(taskRunId, userId);
    const step = await this.requireStep(taskRunId, stepKey);
    if (step.status !== TASK_STEP_STATUS.PAUSED) return serializeStep(step);

    const updated = await this.prisma.taskRunStep.update({
      where: { id: step.id },
      data: { status: TASK_STEP_STATUS.QUEUED },
    });
    this.bus.publish(taskRunId, { type: 'step_status', stepKey, status: 'queued' });
    await this.events.record({
      taskRunId,
      type: TASK_EVENT_TYPE.STEP_RESUMED,
      stepId: stepKey,
      stepTitle: step.title,
      employeeName: step.employeeName,
      message: `${step.employeeName} 继续`,
    });

    // 运行还在 RUNNING 但 worker 已经因为「全在等人」退出了，恢复时要把它叫回来
    if (run.status === TASK_RUN_STATUS.RUNNING) await this.queue.enqueue(taskRunId);
    return serializeStep(updated);
  }

  // ── 内部 ──────────────────────────────────────────────────────────────────

  private async owned(taskRunId: string, userId: string): Promise<TaskRun> {
    const run = await this.prisma.taskRun.findUnique({ where: { id: taskRunId } });
    if (!run || run.userId !== userId) throw new NotFoundException('Task not found');
    return run;
  }

  private async requireStep(taskRunId: string, stepKey: string): Promise<TaskRunStep> {
    const step = await this.prisma.taskRunStep.findUnique({
      where: { taskRunId_stepKey: { taskRunId, stepKey } },
    });
    if (!step) throw new NotFoundException('Step not found');
    return step;
  }

  /**
   * 把 TaskRun.steps 这个 JSON 计划实体化成 TaskRunStep 行。
   *
   * 任务创建仍然走 TaskService.create（写 JSON 快照，前端规划器直接产出那个形状），
   * 第一次需要执行或查看执行视图时才落成行。这样规划阶段的反复编辑不必每次
   * 同步两份数据。
   */
  private async materialize(run: TaskRun): Promise<TaskRunStep[]> {
    const existing = await this.prisma.taskRunStep.findMany({
      where: { taskRunId: run.id },
      orderBy: { order: 'asc' },
    });

    const seeds = seedsFromPlanJson(run.steps);
    if (seeds.length === 0) return existing;

    if (existing.length === 0) {
      await this.prisma.taskRunStep.createMany({
        data: seeds.map((seed) => ({
          taskRunId: run.id,
          stepKey: seed.stepKey,
          order: seed.order,
          title: seed.title,
          description: seed.description,
          employeeId: seed.employeeId,
          employeeName: seed.employeeName,
          employeeAvatar: seed.employeeAvatar,
          capabilityId: seed.capabilityId,
          capabilityName: seed.capabilityName,
          dependsOn: seed.dependsOn,
          rationale: seed.rationale,
          estimatedSeconds: seed.estimatedSeconds,
          status: seed.status,
          output: seed.output,
        })),
        skipDuplicates: true,
      });
      this.logger.log(`Materialized ${seeds.length} step(s) for run ${run.id}`);
      return this.prisma.taskRunStep.findMany({ where: { taskRunId: run.id }, orderBy: { order: 'asc' } });
    }

    // 行已存在但计划被改过（停止后换人、加步骤、删依赖）。行是权威，
    // 但计划才是用户刚刚编辑的东西 —— 不同步的话「改了没生效」，而且界面上
    // 看不出来是没生效还是改错了。
    await this.reconcileWithPlan(run.id, existing, seeds);
    return this.prisma.taskRunStep.findMany({ where: { taskRunId: run.id }, orderBy: { order: 'asc' } });
  }

  /**
   * 让步骤行追上被编辑过的计划。
   *
   * 保留产出的条件很严：stepKey、员工、能力、标题四项全都没变才算「同一步」。
   * 换了人还留着旧产出，就会出现「A 的产出挂在 B 名下」——这种错误在界面上
   * 完全看不出来，是最危险的一类。
   */
  private async reconcileWithPlan(
    taskRunId: string,
    existing: TaskRunStep[],
    seeds: PlanStepSeed[],
  ): Promise<void> {
    const seedByKey = new Map(seeds.map((seed) => [seed.stepKey, seed]));
    const existingByKey = new Map(existing.map((step) => [step.stepKey, step]));

    const removed = existing.filter((step) => !seedByKey.has(step.stepKey));
    if (removed.length > 0) {
      await this.prisma.taskRunStep.deleteMany({ where: { id: { in: removed.map((step) => step.id) } } });
    }

    for (const seed of seeds) {
      const row = existingByKey.get(seed.stepKey);

      if (!row) {
        await this.prisma.taskRunStep.create({
          data: {
            taskRunId,
            stepKey: seed.stepKey,
            order: seed.order,
            title: seed.title,
            description: seed.description,
            employeeId: seed.employeeId,
            employeeName: seed.employeeName,
            employeeAvatar: seed.employeeAvatar,
            capabilityId: seed.capabilityId,
            capabilityName: seed.capabilityName,
            dependsOn: seed.dependsOn,
            rationale: seed.rationale,
            estimatedSeconds: seed.estimatedSeconds,
            status: TASK_STEP_STATUS.QUEUED,
          },
        });
        continue;
      }

      const identityChanged =
        row.employeeId !== seed.employeeId ||
        row.capabilityId !== seed.capabilityId ||
        row.title !== seed.title;

      await this.prisma.taskRunStep.update({
        where: { id: row.id },
        data: {
          order: seed.order,
          title: seed.title,
          description: seed.description,
          employeeId: seed.employeeId,
          employeeName: seed.employeeName,
          employeeAvatar: seed.employeeAvatar,
          capabilityId: seed.capabilityId,
          capabilityName: seed.capabilityName,
          dependsOn: seed.dependsOn,
          rationale: seed.rationale,
          estimatedSeconds: seed.estimatedSeconds,
          ...(identityChanged
            ? {
                status: TASK_STEP_STATUS.QUEUED,
                output: null,
                error: null,
                inputPrompt: null,
                handoff: null,
                sessionId: null,
                startedAt: null,
                completedAt: null,
                durationMs: null,
                attempt: 0,
              }
            : {}),
        },
      });
    }
  }

  private async resetFrom(steps: TaskRunStep[], rootKey: string, taskRunId: string): Promise<void> {
    const affected = collectDownstream(steps, rootKey);
    const ids = steps.filter((step) => affected.has(step.stepKey)).map((step) => step.id);
    if (ids.length === 0) return;

    await this.prisma.taskRunStep.updateMany({
      where: { id: { in: ids } },
      data: {
        status: TASK_STEP_STATUS.QUEUED,
        output: null,
        error: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
      },
    });

    for (const key of affected) {
      this.bus.publish(taskRunId, { type: 'step_status', stepKey: key, status: 'queued' });
    }
  }
}
