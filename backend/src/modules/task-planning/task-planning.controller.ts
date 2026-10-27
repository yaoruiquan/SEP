import { Body, Controller, Post, Request, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request as ExpressRequest, Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { TaskPlanningService } from './task-planning.service';
import { TaskPlanPreviewDtoSchema, type TaskPlanPreviewDto } from './task-planning.types';

@ApiTags('task-planning')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('task-plans')
export class TaskPlanningController {
  constructor(private readonly service: TaskPlanningService) {}

  @Post('preview')
  @Throttle({ chat: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: '使用大模型生成任务编排计划（不执行）' })
  @ApiResponse({ status: 201, description: '返回待用户确认的任务计划' })
  @ApiResponse({ status: 400, description: '没有可用员工或任务目标无效' })
  @ApiResponse({ status: 502, description: '规划模型不可用或返回无效计划' })
  async preview(
    @Body(new ZodValidationPipe(TaskPlanPreviewDtoSchema)) dto: TaskPlanPreviewDto,
    @Request() req: ExpressRequest & { user: { id: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    const abort = new AbortController();
    const onClose = () => { if (!res.writableEnded) abort.abort(); };
    res.once('close', onClose);
    try {
      return await this.service.preview(req.user.id, dto, abort.signal);
    } finally {
      res.off('close', onClose);
    }
  }
}
