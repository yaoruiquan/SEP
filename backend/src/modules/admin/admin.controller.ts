import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { z } from 'zod';
import { UserRole } from '@prisma/client';

const CreditAdjustmentSchema = z.object({
  amount: z.number().positive('金额必须大于0'),
  type: z.enum(['RECHARGE', 'DEDUCT'], {
    errorMap: () => ({ message: '类型必须是 RECHARGE 或 DEDUCT' })
  }),
  note: z.string().min(1, '备注不能为空').max(200, '备注不能超过200字符'),
});

const SuspendSchema = z.object({
  reason: z.string().min(1, '原因不能为空').max(500, '原因不能超过500字符'),
});

const ApproveEmployeeSchema = z.object({
  note: z.string().optional(),
});

const RejectEmployeeSchema = z.object({
  reason: z.string().min(1, '拒绝原因不能为空').max(500, '原因不能超过500字符'),
});

const CreateEmployeeSchema = z.object({
  name: z.string().min(1, '员工名称不能为空').max(100, '名称不能超过100字符'),
  description: z.string().optional(),
  industry: z.string().optional(),
  position: z.string().optional(),
  avatar: z.string().url('头像必须是有效的URL').optional(),
  systemPrompt: z.string().optional(),
  modelId: z.string().optional(),
  maxSteps: z.number().int().positive().optional(),
  price: z.number().nonnegative().optional(),
});

const UpdateEmployeeSchema = z.object({
  name: z.string().min(1, '员工名称不能为空').max(100, '名称不能超过100字符').optional(),
  description: z.string().optional(),
  industry: z.string().optional(),
  position: z.string().optional(),
  avatar: z.string().url('头像必须是有效的URL').optional(),
  systemPrompt: z.string().optional(),
  modelId: z.string().optional(),
  maxSteps: z.number().int().positive().optional(),
  price: z.number().nonnegative().optional(),
});

const CreateCapabilitySchema = z.object({
  name: z.string().min(1, '能力名称不能为空').max(100, '名称不能超过100字符'),
  description: z.string().min(1, '描述不能为空'),
  type: z.enum(['AGENT', 'RPA', 'SKILL', 'AI_APP'], {
    errorMap: () => ({ message: '类型必须是 AGENT、RPA、SKILL 或 AI_APP' })
  }),
  industry: z.array(z.string()).default([]),
  position: z.array(z.string()).default([]),
  inputSchema: z.any().optional(),
  outputSchema: z.any().optional(),
  agentConfig: z.object({
    platform: z.enum(['COZE', 'DIFY', 'N8N', 'OPENCODE']),
    region: z.string().optional(),
    runtimeKind: z.string().optional(),
    botId: z.string().optional(),
    workflowId: z.string().optional(),
    apiKey: z.string().optional(),
    workflowUrl: z.string().optional(),
    webUrl: z.string().optional(),
    skillName: z.string().optional(),
  }).optional(),
  // SKILL 类型必填字段
  zipPath: z.string().optional(), // 从 upload-skill 返回的路径
  sha256: z.string().optional(),
  fileCount: z.number().optional(),
  totalSize: z.number().optional(),
});

const UpdateCapabilitySchema = z.object({
  name: z.string().min(1, '能力名称不能为空').max(100, '名称不能超过100字符').optional(),
  description: z.string().optional(),
  type: z.enum(['AGENT', 'RPA', 'SKILL', 'AI_APP']).optional(),
  industry: z.array(z.string()).optional(),
  position: z.array(z.string()).optional(),
  inputSchema: z.any().optional(),
  outputSchema: z.any().optional(),
});

const ApproveCapabilitySchema = z.object({
  note: z.string().optional(),
});

const RejectCapabilitySchema = z.object({
  reason: z.string().min(1, '拒绝原因不能为空').max(500, '原因不能超过500字符'),
});

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  @ApiOperation({ summary: '获取运营仪表盘统计数据' })
  @ApiResponse({
    status: 200,
    description: '返回 KPI、近 30 天趋势、Top 10 企业与员工排行',
  })
  getStats() {
    return this.adminService.getStats();
  }

  @Get('enterprises')
  @ApiOperation({ summary: '获取企业列表（运营端）' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: '页码，默认1' })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: '每页数量，默认20' })
  @ApiQuery({ name: 'keyword', required: false, type: String, description: '搜索关键词' })
  @ApiResponse({ status: 200, description: '返回企业列表' })
  listEnterprises(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.adminService.listEnterprises({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      keyword,
    });
  }

  @Get('enterprises/:id')
  @ApiOperation({ summary: '获取企业详情（运营端）' })
  @ApiResponse({ status: 200, description: '返回企业详情，包含成员、实例、交易记录' })
  @ApiResponse({ status: 404, description: '企业不存在' })
  getEnterpriseDetail(@Param('id') id: string) {
    return this.adminService.getEnterpriseDetail(id);
  }

  @Post('enterprises/:id/credit')
  @ApiOperation({ summary: '充值或扣减算力' })
  @ApiResponse({ status: 200, description: '操作成功，返回新余额' })
  @ApiResponse({ status: 400, description: '金额无效或余额不足' })
  @ApiResponse({ status: 404, description: '企业不存在' })
  creditAdjustment(
    @Param('id') enterpriseId: string,
    @Body(new ZodValidationPipe(CreditAdjustmentSchema)) dto: z.infer<typeof CreditAdjustmentSchema>,
    @Request() req: any,
  ) {
    return this.adminService.creditAdjustment({
      enterpriseId,
      amount: dto.amount,
      type: dto.type,
      note: dto.note,
      operatorId: req.user.id,
    });
  }

  @Post('enterprises/:id/suspend')
  @ApiOperation({ summary: '冻结企业' })
  @ApiResponse({ status: 200, description: '冻结成功' })
  @ApiResponse({ status: 400, description: '企业已被冻结' })
  @ApiResponse({ status: 404, description: '企业不存在' })
  suspendEnterprise(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SuspendSchema)) dto: z.infer<typeof SuspendSchema>,
    @Request() req: any,
  ) {
    return this.adminService.suspendEnterprise(id, dto.reason, req.user.id);
  }

  @Post('enterprises/:id/resume')
  @ApiOperation({ summary: '解冻企业' })
  @ApiResponse({ status: 200, description: '解冻成功' })
  @ApiResponse({ status: 400, description: '企业未被冻结' })
  @ApiResponse({ status: 404, description: '企业不存在' })
  resumeEnterprise(@Param('id') id: string, @Request() req: any) {
    return this.adminService.resumeEnterprise(id, req.user.id);
  }

  @Get('employees')
  @ApiOperation({ summary: '获取员工列表（运营端）' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'REJECTED', 'DRAFT', 'ARCHIVED'], description: '员工状态' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: '页码，默认1' })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: '每页数量，默认20' })
  @ApiResponse({ status: 200, description: '返回员工列表' })
  listEmployees(
    @Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'DRAFT' | 'ARCHIVED',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.adminService.listEmployees({
      status,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Post('employees/:id/approve')
  @ApiOperation({ summary: '审核通过员工模板' })
  @ApiResponse({ status: 200, description: '审核通过' })
  @ApiResponse({ status: 400, description: '只能审核待审核状态的员工' })
  @ApiResponse({ status: 404, description: '员工模板不存在' })
  approveEmployee(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ApproveEmployeeSchema)) dto: z.infer<typeof ApproveEmployeeSchema>,
    @Request() req: any,
  ) {
    return this.adminService.approveEmployee(id, req.user.id, dto.note);
  }

  @Post('employees/:id/reject')
  @ApiOperation({ summary: '拒绝员工模板' })
  @ApiResponse({ status: 200, description: '拒绝成功' })
  @ApiResponse({ status: 400, description: '只能审核待审核状态的员工' })
  @ApiResponse({ status: 404, description: '员工模板不存在' })
  rejectEmployee(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RejectEmployeeSchema)) dto: z.infer<typeof RejectEmployeeSchema>,
    @Request() req: any,
  ) {
    return this.adminService.rejectEmployee(id, req.user.id, dto.reason);
  }

  @Get('compute/transactions')
  @ApiOperation({ summary: '获取平台级算力交易记录' })
  @ApiQuery({ name: 'type', required: false, enum: ['RECHARGE', 'CONSUME', 'REFUND'], description: '交易类型' })
  @ApiQuery({ name: 'enterpriseId', required: false, type: String, description: '企业ID' })
  @ApiQuery({ name: 'startDate', required: false, type: String, description: '开始日期 (ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: false, type: String, description: '结束日期 (ISO 8601)' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: '页码，默认1' })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: '每页数量，默认20' })
  @ApiResponse({ status: 200, description: '返回交易记录列表' })
  getComputeTransactions(
    @Query('type') type?: 'RECHARGE' | 'CONSUME' | 'REFUND',
    @Query('enterpriseId') enterpriseId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.adminService.getComputeTransactions({
      type,
      enterpriseId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Post('employees')
  @ApiOperation({ summary: '创建员工（运营）' })
  @ApiResponse({ status: 201, description: '员工创建成功' })
  @ApiResponse({ status: 400, description: '输入参数无效' })
  createEmployee(
    @Body(new ZodValidationPipe(CreateEmployeeSchema)) dto: z.infer<typeof CreateEmployeeSchema>,
    @Request() req: any,
  ) {
    return this.adminService.createEmployee({
      name: dto.name,
      description: dto.description,
      industry: dto.industry,
      position: dto.position,
      avatar: dto.avatar,
      systemPrompt: dto.systemPrompt,
      modelId: dto.modelId,
      maxSteps: dto.maxSteps,
      price: dto.price,
      operatorId: req.user.id,
    });
  }

  @Get('employees/avatar-styles')
  @ApiOperation({ summary: '获取所有可用的头像风格列表' })
  @ApiResponse({ status: 200, description: '返回所有 DiceBear 风格及推荐列表' })
  getAvatarStyles() {
    return this.adminService.getAvatarStyles();
  }

  @Get('employees/:id')
  @ApiOperation({ summary: '获取员工详情（运营端）' })
  @ApiResponse({ status: 200, description: '返回员工详情' })
  @ApiResponse({ status: 404, description: '员工不存在' })
  getEmployeeDetail(@Param('id') id: string) {
    return this.adminService.getEmployeeDetail(id);
  }

  @Put('employees/:id')
  @ApiOperation({ summary: '更新员工' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 404, description: '员工不存在' })
  @ApiResponse({ status: 400, description: '输入参数无效' })
  updateEmployee(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateEmployeeSchema)) dto: z.infer<typeof UpdateEmployeeSchema>,
    @Request() req: any,
  ) {
    return this.adminService.updateEmployee(id, dto, req.user.id);
  }

  @Post('employees/:id/submit')
  @ApiOperation({ summary: '提交员工审核' })
  @ApiResponse({ status: 200, description: '提交成功' })
  @ApiResponse({ status: 400, description: '只能提交草稿状态的员工' })
  @ApiResponse({ status: 404, description: '员工不存在' })
  submitEmployeeForReview(@Param('id') id: string, @Request() req: any) {
    return this.adminService.submitEmployeeForReview(id, req.user.id);
  }

  @Post('employees/:id/publish')
  @ApiOperation({ summary: '发布员工（运营直接上架，跳过审核）' })
  @ApiResponse({ status: 200, description: '发布成功' })
  @ApiResponse({ status: 400, description: '只能发布草稿状态的员工' })
  @ApiResponse({ status: 404, description: '员工不存在' })
  publishEmployee(@Param('id') id: string, @Request() req: any) {
    return this.adminService.publishEmployee(id, req.user.id);
  }

  @Post('employees/:id/archive')
  @ApiOperation({ summary: '下架员工' })
  @ApiResponse({ status: 200, description: '下架成功' })
  @ApiResponse({ status: 400, description: '只能下架已发布的员工' })
  @ApiResponse({ status: 404, description: '员工不存在' })
  archiveEmployee(@Param('id') id: string, @Request() req: any) {
    return this.adminService.archiveEmployee(id, req.user.id);
  }

  @Delete('employees/:id')
  @ApiOperation({ summary: '删除员工（仅草稿）' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 400, description: '只能删除草稿状态的员工' })
  @ApiResponse({ status: 404, description: '员工不存在' })
  deleteEmployee(@Param('id') id: string) {
    return this.adminService.deleteEmployee(id);
  }

  @Get('employees/:id/bindings')
  @ApiOperation({ summary: '获取员工的能力绑定' })
  @ApiResponse({ status: 200, description: '返回能力绑定列表' })
  @ApiResponse({ status: 404, description: '员工不存在' })
  getEmployeeBindings(@Param('id') id: string) {
    return this.adminService.getEmployeeBindings(id);
  }

  @Post('employees/:id/bindings')
  @ApiOperation({ summary: '批量绑定能力到员工' })
  @ApiResponse({ status: 200, description: '绑定成功' })
  @ApiResponse({ status: 400, description: '部分能力不存在' })
  @ApiResponse({ status: 404, description: '员工不存在' })
  bindCapabilities(
    @Param('id') employeeId: string,
    @Body(new ZodValidationPipe(z.object({ capabilityIds: z.array(z.string()).min(1, '至少选择一个能力') })))
    dto: { capabilityIds: string[] },
    @Request() req: any,
  ) {
    return this.adminService.bindCapabilities(employeeId, dto.capabilityIds, req.user.id);
  }

  @Patch('bindings/:id')
  @ApiOperation({ summary: '更新绑定配置' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 404, description: '绑定不存在' })
  updateBinding(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({
      priority: z.number().int().min(0).max(100).optional(),
      enabled: z.boolean().optional(),
      config: z.any().optional(),
    })))
    dto: { priority?: number; enabled?: boolean; config?: any },
  ) {
    return this.adminService.updateBinding(id, dto);
  }

  @Delete('bindings/:id')
  @ApiOperation({ summary: '删除绑定' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 404, description: '绑定不存在' })
  removeBinding(@Param('id') id: string) {
    return this.adminService.removeBinding(id);
  }

  @Patch('employees/batch-update-avatar-style')
  @ApiOperation({ summary: '批量更新所有员工的头像风格' })
  @ApiResponse({ status: 200, description: '更新成功，返回更新数量' })
  @ApiResponse({ status: 400, description: '头像风格不存在' })
  batchUpdateAvatarStyle(
    @Body(new ZodValidationPipe(z.object({ styleId: z.string().min(1, '风格ID不能为空') })))
    dto: { styleId: string },
    @Request() req: any,
  ) {
    return this.adminService.batchUpdateAvatarStyle(dto.styleId, req.user.id);
  }

  @Patch('employees/:id/avatar-style')
  @ApiOperation({ summary: '更新单个员工的头像风格' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 400, description: '头像风格不存在' })
  @ApiResponse({ status: 404, description: '员工不存在' })
  updateEmployeeAvatarStyle(
    @Param('id') employeeId: string,
    @Body(new ZodValidationPipe(z.object({ styleId: z.string().min(1, '风格ID不能为空') })))
    dto: { styleId: string },
    @Request() req: any,
  ) {
    return this.adminService.updateEmployeeAvatarStyle(employeeId, dto.styleId, req.user.id);
  }

  @Get('capabilities')
  @ApiOperation({ summary: '获取能力列表（运营端）' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'REJECTED'], description: '能力状态；PENDING 仅返回平台待审投稿和历史平台草稿' })
  @ApiQuery({ name: 'type', required: false, enum: ['AGENT', 'RPA', 'SKILL', 'AI_APP'], description: '能力类型' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: '页码，默认1' })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: '每页数量，默认20' })
  @ApiResponse({ status: 200, description: '返回能力列表' })
  listCapabilitiesAdmin(
    @Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED',
    @Query('type') type?: 'AGENT' | 'RPA' | 'SKILL' | 'AI_APP',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.adminService.listCapabilities({
      status,
      type,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Post('capabilities')
  @ApiOperation({ summary: '创建能力（运营）' })
  @ApiResponse({ status: 201, description: '能力创建成功' })
  @ApiResponse({ status: 400, description: '输入参数无效' })
  createCapabilityAdmin(
    @Body(new ZodValidationPipe(CreateCapabilitySchema)) dto: z.infer<typeof CreateCapabilitySchema>,
    @Request() req: any,
  ) {
    return this.adminService.createCapability({
      name: dto.name,
      description: dto.description,
      type: dto.type,
      industry: dto.industry,
      position: dto.position,
      inputSchema: dto.inputSchema || {},
      outputSchema: dto.outputSchema || {},
      agentConfig: dto.agentConfig as any,
      zipPath: dto.zipPath,
      sha256: dto.sha256,
      fileCount: dto.fileCount,
      totalSize: dto.totalSize,
      operatorId: req.user.id,
    });
  }

  @Get('capabilities/:id')
  @ApiOperation({ summary: '获取能力详情（运营端）' })
  @ApiResponse({ status: 200, description: '返回能力详情' })
  @ApiResponse({ status: 404, description: '能力不存在' })
  getCapabilityDetailAdmin(@Param('id') id: string) {
    return this.adminService.getCapabilityDetail(id);
  }

  @Put('capabilities/:id')
  @ApiOperation({ summary: '更新能力' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 404, description: '能力不存在' })
  @ApiResponse({ status: 400, description: '输入参数无效' })
  updateCapabilityAdmin(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCapabilitySchema)) dto: z.infer<typeof UpdateCapabilitySchema>,
    @Request() req: any,
  ) {
    return this.adminService.updateCapability(id, dto, req.user.id);
  }

  @Post('capabilities/:id/submit')
  @ApiOperation({ summary: '提交能力审核' })
  @ApiResponse({ status: 200, description: '提交成功' })
  @ApiResponse({ status: 400, description: '已审核通过的能力无需重新提交' })
  @ApiResponse({ status: 404, description: '能力不存在' })
  submitCapabilityForReview(@Param('id') id: string, @Request() req: any) {
    return this.adminService.submitCapabilityForReview(id, req.user.id);
  }

  @Post('capabilities/:id/approve')
  @ApiOperation({ summary: '审核通过能力' })
  @ApiResponse({ status: 200, description: '审核通过' })
  @ApiResponse({ status: 400, description: '只能审核待审核状态的能力' })
  @ApiResponse({ status: 404, description: '能力不存在' })
  approveCapabilityAdmin(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ApproveCapabilitySchema)) dto: z.infer<typeof ApproveCapabilitySchema>,
    @Request() req: any,
  ) {
    return this.adminService.approveCapability(id, req.user.id, dto.note);
  }

  @Post('capabilities/:id/reject')
  @ApiOperation({ summary: '拒绝能力' })
  @ApiResponse({ status: 200, description: '拒绝成功' })
  @ApiResponse({ status: 400, description: '只能审核待审核状态的能力' })
  @ApiResponse({ status: 404, description: '能力不存在' })
  rejectCapabilityAdmin(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RejectCapabilitySchema)) dto: z.infer<typeof RejectCapabilitySchema>,
    @Request() req: any,
  ) {
    return this.adminService.rejectCapability(id, req.user.id, dto.reason);
  }

  @Delete('capabilities/:id')
  @ApiOperation({ summary: '删除能力（仅待审核或已拒绝）' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 400, description: '已审核通过的能力无法删除' })
  @ApiResponse({ status: 404, description: '能力不存在' })
  deleteCapabilityAdmin(@Param('id') id: string) {
    return this.adminService.deleteCapability(id);
  }

  @Get('capabilities/available/list')
  @ApiOperation({ summary: '获取可用能力列表（用于绑定）' })
  @ApiResponse({ status: 200, description: '返回已审核的能力列表' })
  getAvailableCapabilities() {
    return this.adminService.getAvailableCapabilities();
  }
}
