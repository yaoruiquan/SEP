import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CreateTaskDtoSchema,
  CreateTemplateDtoSchema,
  StepPatchDtoSchema,
  TaskQuerySchema,
  UpdateTaskDtoSchema,
} from 'shared';
import { TaskService } from './task.service';

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TaskController {
  constructor(private readonly service: TaskService) {}

  @Get()
  @ApiOperation({ summary: '任务列表' })
  @ApiResponse({ status: 200, description: '任务列表' })
  @ApiResponse({ status: 400, description: '查询参数无效' })
  @ApiResponse({ status: 403, description: '企业管理员权限不足' })
  list(@Request() req: any, @Query(new ZodValidationPipe(TaskQuerySchema)) q: any) {
    return this.service.list(req.user.id, q);
  }

  @Post()
  @ApiOperation({ summary: '创建任务' })
  @ApiResponse({ status: 201, description: '任务创建成功' })
  @ApiResponse({ status: 400, description: '输入参数无效' })
  create(@Request() req: any, @Body(new ZodValidationPipe(CreateTaskDtoSchema)) b: any) {
    return this.service.create(req.user.id, b);
  }

  @Get('templates')
  @ApiOperation({ summary: '模板列表' })
  @ApiResponse({ status: 200, description: '模板列表' })
  templates(@Request() req: any) {
    return this.service.templates(req.user.id);
  }

  @Post('templates')
  @ApiOperation({ summary: '创建模板' })
  @ApiResponse({ status: 201, description: '模板创建成功' })
  @ApiResponse({ status: 400, description: '输入参数无效' })
  createTemplate(@Request() req: any, @Body(new ZodValidationPipe(CreateTemplateDtoSchema)) b: any) {
    return this.service.createTemplate(req.user.id, b);
  }

  @Get(':id/events')
  @ApiOperation({ summary: '任务事件流水' })
  @ApiResponse({ status: 200, description: '事件列表' })
  @ApiResponse({ status: 404, description: '任务不存在' })
  events(@Request() req: any, @Param('id') id: string) {
    return this.service.events(id, req.user.id);
  }

  @Patch(':id/steps/:stepId')
  @ApiOperation({ summary: '更新任务步骤' })
  @ApiResponse({ status: 200, description: '步骤更新成功' })
  @ApiResponse({ status: 400, description: '输入参数无效' })
  @ApiResponse({ status: 404, description: '任务或步骤不存在' })
  @ApiResponse({ status: 409, description: '任务已被更新' })
  patchStep(
    @Request() req: any,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body(new ZodValidationPipe(StepPatchDtoSchema)) b: any,
  ) {
    return this.service.patchStep(id, req.user.id, stepId, b);
  }

  @Post(':id/reconcile')
  @ApiOperation({ summary: '回收孤儿运行' })
  @ApiResponse({ status: 200, description: '回收结果' })
  @ApiResponse({ status: 404, description: '任务不存在' })
  reconcile(@Request() req: any, @Param('id') id: string) {
    return this.service.reconcile(id, req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '任务详情' })
  @ApiResponse({ status: 200, description: '任务详情' })
  @ApiResponse({ status: 404, description: '任务不存在' })
  get(@Request() req: any, @Param('id') id: string) {
    return this.service.get(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新任务' })
  @ApiResponse({ status: 200, description: '任务更新成功' })
  @ApiResponse({ status: 400, description: '输入参数无效' })
  @ApiResponse({ status: 404, description: '任务不存在' })
  @ApiResponse({ status: 409, description: '任务已被更新' })
  update(@Request() req: any, @Param('id') id: string, @Body(new ZodValidationPipe(UpdateTaskDtoSchema)) b: any) {
    return this.service.update(id, req.user.id, b);
  }

  @Delete('templates/:id')
  @ApiOperation({ summary: '删除模板' })
  @ApiResponse({ status: 200, description: '模板删除成功' })
  @ApiResponse({ status: 404, description: '模板不存在' })
  removeTemplate(@Request() req: any, @Param('id') id: string) {
    return this.service.removeTemplate(id, req.user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除任务' })
  @ApiResponse({ status: 200, description: '任务删除成功' })
  @ApiResponse({ status: 404, description: '任务不存在' })
  @ApiResponse({ status: 409, description: '请先停止运行中的任务' })
  remove(@Request() req: any, @Param('id') id: string) {
    return this.service.remove(id, req.user.id);
  }
}
