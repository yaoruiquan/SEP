import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Req,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request as ExpressRequest, Response } from 'express';
import { RunTaskDtoSchema, type RunTaskDto, type TaskStreamFrame } from 'shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TaskEventBus } from './task-event-bus';
import { TaskExecutionService } from './task-execution.service';

type AuthRequest = { user: { id: string } };

/** SSE 保活间隔。低于常见反向代理的 60s 空闲超时，否则长任务的连接会被中间层掐断。 */
const PING_INTERVAL_MS = 15_000;

@ApiTags('Task Execution')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TaskExecutionController {
  private readonly logger = new Logger(TaskExecutionController.name);

  constructor(
    private readonly service: TaskExecutionService,
    private readonly bus: TaskEventBus,
  ) {}

  @Get(':id/execution')
  @ApiOperation({ summary: '执行视角的任务详情（步骤含输入、交接、产出）' })
  @ApiResponse({ status: 200, description: '执行快照' })
  @ApiResponse({ status: 404, description: '任务不存在' })
  execution(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.service.snapshot(id, req.user.id);
  }

  @Post(':id/run')
  @ApiOperation({ summary: '确认计划并在服务端开始执行' })
  @ApiResponse({ status: 201, description: '已入队，返回执行快照' })
  @ApiResponse({ status: 400, description: '没有可执行的步骤' })
  @ApiResponse({ status: 409, description: '任务正在执行中' })
  run(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RunTaskDtoSchema)) dto: RunTaskDto,
  ) {
    return this.service.run(id, req.user.id, dto.fromStepKey);
  }

  @Post(':id/stop')
  @ApiOperation({ summary: '请求停止（当前步骤结束后收工）' })
  @ApiResponse({ status: 201, description: '已记录停止请求' })
  stop(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.service.stop(id, req.user.id);
  }

  @Post(':id/steps/:stepKey/retry')
  @ApiOperation({ summary: '从该步骤重跑（下游步骤一并重置）' })
  @ApiResponse({ status: 201, description: '已入队' })
  retry(@Request() req: AuthRequest, @Param('id') id: string, @Param('stepKey') stepKey: string) {
    return this.service.retryStep(id, req.user.id, stepKey);
  }

  @Post(':id/steps/:stepKey/pause')
  @ApiOperation({ summary: '暂停排队中的步骤' })
  @ApiResponse({ status: 409, description: '正在执行的步骤不能暂停' })
  pause(@Request() req: AuthRequest, @Param('id') id: string, @Param('stepKey') stepKey: string) {
    return this.service.pauseStep(id, req.user.id, stepKey);
  }

  @Post(':id/steps/:stepKey/resume')
  @ApiOperation({ summary: '恢复已暂停的步骤' })
  resume(@Request() req: AuthRequest, @Param('id') id: string, @Param('stepKey') stepKey: string) {
    return this.service.resumeStep(id, req.user.id, stepKey);
  }

  @Get(':id/steps/:stepKey/messages')
  @ApiOperation({ summary: '该步骤的完整对话记录（输入、工具调用、产出）' })
  stepMessages(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Param('stepKey') stepKey: string,
  ) {
    return this.service.stepMessages(id, req.user.id, stepKey);
  }

  @Get(':id/deliverable')
  @ApiOperation({ summary: '最终交付物' })
  deliverable(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.service.deliverable(id, req.user.id);
  }

  /**
   * 执行事件流。
   *
   * 先推一帧全量快照再转推增量：用户可能是在任务跑到一半时才打开页面（或刷新），
   * 只推增量的话前半程就丢了。快照 + 增量的组合让「什么时候连上」不影响看到的内容。
   *
   * 用裸 @Res 手写帧而不是 Nest 的 @Sse，与既有的对话流保持同一种写法
   * （conversation.controller.ts 也是这么做的）。
   */
  @Get(':id/stream')
  @ApiOperation({ summary: '执行事件流（SSE）' })
  @ApiResponse({ status: 200, description: 'SSE 事件流' })
  async stream(
    @Request() req: AuthRequest,
    @Req() rawReq: ExpressRequest,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    // 先校验归属再设响应头：否则 404 会被裹进一个已经开始的事件流里，
    // 前端看到的是「连上了但什么都没发生」。
    const snapshot = await this.service.snapshot(id, req.user.id);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const write = (frame: TaskStreamFrame) => {
      if (res.writableEnded) return;
      res.write(`event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`);
    };

    write({ type: 'snapshot', snapshot });

    const subscription = this.bus.frames(id).subscribe({
      next: write,
      error: (error: Error) => {
        this.logger.warn(`Task stream ${id} bus error: ${error.message}`);
        res.end();
      },
    });

    const ping = setInterval(() => {
      void this.service
        .snapshot(id, req.user.id)
        .then((fresh) => write({ type: 'ping', heartbeatAt: fresh.heartbeatAt }))
        .catch(() => write({ type: 'ping', heartbeatAt: null }));
    }, PING_INTERVAL_MS);

    const cleanup = () => {
      clearInterval(ping);
      subscription.unsubscribe();
      if (!res.writableEnded) res.end();
    };

    rawReq.on('close', cleanup);
    res.on('close', cleanup);
  }
}
