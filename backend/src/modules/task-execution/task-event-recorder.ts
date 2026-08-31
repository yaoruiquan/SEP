import { Injectable, Logger } from '@nestjs/common';
import { TASK_EVENT_TYPE, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TaskEventBus } from './task-event-bus';
import { serializeEvent } from './task-step-mapper';

export interface RecordEventInput {
  taskRunId: string;
  type: TASK_EVENT_TYPE;
  stepId?: string | null;
  stepTitle?: string | null;
  employeeName?: string | null;
  message?: string | null;
  payload?: Prisma.InputJsonValue;
}

/**
 * 任务流水的唯一写入点。
 *
 * 落库与推流必须在同一个地方发生。此前 TaskService.eventsFor 只落库，前端靠
 * mutation 回写刷新 —— 于是「流水里有的事件」和「界面上看到的事件」是两套东西，
 * 而会议要求的恰恰是「过程可见」。
 */
@Injectable()
export class TaskEventRecorder {
  private readonly logger = new Logger(TaskEventRecorder.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: TaskEventBus,
  ) {}

  async record(input: RecordEventInput): Promise<void> {
    try {
      const event = await this.prisma.taskRunEvent.create({
        data: {
          taskRunId: input.taskRunId,
          type: input.type,
          stepId: input.stepId ?? null,
          stepTitle: input.stepTitle ?? null,
          employeeName: input.employeeName ?? null,
          message: input.message ?? null,
          payload: input.payload,
        },
      });

      this.bus.publish(input.taskRunId, { type: 'event', event: serializeEvent(event) });
    } catch (error) {
      // 流水是审计与展示用的旁路，写失败不该让任务本身崩掉
      this.logger.error(
        `Failed to record ${input.type} for run ${input.taskRunId}: ${(error as Error).message}`,
      );
    }
  }
}
