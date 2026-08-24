import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
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
  @ApiOperation({ summary: '使用大模型生成任务编排计划（不执行）' })
  @ApiResponse({ status: 201, description: '返回待用户确认的任务计划' })
  @ApiResponse({ status: 400, description: '没有可用员工或任务目标无效' })
  @ApiResponse({ status: 502, description: '规划模型不可用或返回无效计划' })
  preview(
    @Body(new ZodValidationPipe(TaskPlanPreviewDtoSchema)) dto: TaskPlanPreviewDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.service.preview(req.user.id, dto);
  }
}
