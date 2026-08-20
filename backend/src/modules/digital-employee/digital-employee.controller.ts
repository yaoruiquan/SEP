import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DigitalEmployeeService } from './digital-employee.service';
import { DigitalEmployeeRunner } from './digital-employee.runner';
import {
  DigitalEmployeeCreateDtoSchema,
  DigitalEmployeeUpdateDtoSchema,
  BindCapabilityDtoSchema,
} from 'shared';

@ApiTags('digital-employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('digital-employees')
export class DigitalEmployeeController {
  constructor(
    private readonly service: DigitalEmployeeService,
    private readonly runner: DigitalEmployeeRunner,
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  // CRUD (admin only for write operations)
  // ────────────────────────────────────────────────────────────────────────────

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '创建数字员工（管理员）' })
  @ApiResponse({ status: 201, description: '创建成功' })
  @ApiResponse({ status: 400, description: '参数校验失败或能力未审核' })
  @ApiResponse({ status: 403, description: '无权限' })
  create(@Body() body: unknown) {
    const dto = DigitalEmployeeCreateDtoSchema.parse(body);
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: '获取数字员工列表' })
  @ApiQuery({ name: 'status', required: false, description: 'DRAFT | APPROVED | ARCHIVED' })
  @ApiResponse({ status: 200, description: '数字员工列表' })
  findAll(@Query('status') status?: string) {
    return this.service.findAll(status);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取数字员工详情' })
  @ApiParam({ name: 'id', description: '数字员工 ID' })
  @ApiResponse({ status: 200, description: '数字员工详情' })
  @ApiResponse({ status: 404, description: '不存在' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '更新数字员工（管理员）' })
  @ApiParam({ name: 'id', description: '数字员工 ID' })
  @ApiResponse({ status: 200, description: '更新后的数字员工' })
  @ApiResponse({ status: 403, description: '无权限' })
  @ApiResponse({ status: 404, description: '不存在' })
  update(@Param('id') id: string, @Body() body: unknown) {
    const dto = DigitalEmployeeUpdateDtoSchema.parse(body);
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除数字员工（管理员）' })
  @ApiParam({ name: 'id', description: '数字员工 ID' })
  @ApiResponse({ status: 204, description: '删除成功' })
  @ApiResponse({ status: 403, description: '无权限' })
  @ApiResponse({ status: 404, description: '不存在' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Capability Binding (admin only)
  // ────────────────────────────────────────────────────────────────────────────

  @Post(':id/capabilities')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '绑定已审核能力到数字员工（管理员）' })
  @ApiParam({ name: 'id', description: '数字员工 ID' })
  @ApiResponse({ status: 201, description: '绑定成功' })
  @ApiResponse({ status: 400, description: '能力未审核' })
  @ApiResponse({ status: 409, description: '能力已绑定' })
  bindCapability(@Param('id') id: string, @Body() body: unknown) {
    const dto = BindCapabilityDtoSchema.parse(body);
    return this.service.bindCapability(id, dto);
  }

  @Delete(':id/capabilities/:capabilityId')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '解绑能力（管理员）' })
  @ApiParam({ name: 'id', description: '数字员工 ID' })
  @ApiParam({ name: 'capabilityId', description: '能力 ID' })
  @ApiResponse({ status: 204, description: '解绑成功' })
  @ApiResponse({ status: 404, description: '绑定关系不存在' })
  unbindCapability(
    @Param('id') id: string,
    @Param('capabilityId') capabilityId: string,
  ) {
    return this.service.unbindCapability(id, capabilityId);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Stats / Monitoring
  // ────────────────────────────────────────────────────────────────────────────

  @Get(':id/stats')
  @ApiOperation({ summary: '获取数字员工运行统计数据' })
  @ApiParam({ name: 'id', description: '数字员工 ID' })
  @ApiQuery({ name: 'days', required: false, description: '统计天数（默认 7）', example: 7 })
  @ApiResponse({ status: 200, description: '统计数据' })
  @ApiResponse({ status: 404, description: '数字员工不存在' })
  getStats(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
    @Query('days') days?: string,
  ) {
    const d = Math.min(Math.max(parseInt(days ?? '7', 10) || 7, 1), 90);
    return this.service.getStats(id, d, req.user.id);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Runner (authenticated users — test endpoint for Layer 4)
  // ────────────────────────────────────────────────────────────────────────────

  @Post(':id/run')
  @ApiOperation({ summary: '向数字员工发送消息并获取回复（测试用）' })
  @ApiParam({ name: 'id', description: '数字员工 ID' })
  @ApiResponse({ status: 200, description: 'Agent 回复' })
  runEmployee(
    @Param('id') id: string,
    @Body() body: { message: string; sessionId?: string },
    @Request() req: any,
  ) {
    const sessionId = body.sessionId ?? `test-${Date.now()}`;
    return this.runner.run(id, body.message, sessionId, req.user.id);
  }
}
