import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkillVersionScope, SkillVersionStatus, UserRole } from '@prisma/client';
import {
  AdoptPersonalVersionsDtoSchema,
  CreateEnterpriseSkillVersionDtoSchema,
  CreatePlatformSkillVersionDtoSchema,
  ReviewSkillVersionDtoSchema,
  SelectSkillVersionDtoSchema,
  SkillVersionScopeSchema,
  SkillVersionStatusSchema,
  UpdateSkillVersionDtoSchema,
} from 'shared';
import {
  SkillVersionUsageSummaryDtoSchema,
  SkillVersionExecutionListDtoSchema,
} from './skill-version-usage.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SkillVersionService } from './skill-version.service';

type AuthRequest = { user: { id: string; role: UserRole } };

@ApiTags('Enterprise Skill Versions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('enterprise')
export class EnterpriseSkillVersionController {
  constructor(private readonly service: SkillVersionService) {}

  @Get('employees/:employeeId/skills')
  @ApiOperation({ summary: '获取已授权员工的技能及当前版本' })
  @ApiParam({ name: 'employeeId', description: '数字员工 ID' })
  @ApiResponse({ status: 200, description: '技能版本摘要列表' })
  @ApiResponse({ status: 403, description: '未订阅或未获得员工授权' })
  listEmployeeSkills(
    @Request() req: AuthRequest,
    @Param('employeeId') employeeId: string,
  ) {
    return this.service.listEmployeeSkills(req.user.id, employeeId);
  }

  @Get('employees/:employeeId/usage')
  @ApiOperation({
    summary: '硅基员工在本企业的使用情况',
    description: '会议要的员工维度视角：谁在用、多少次会话、多少轮对话、成功率、上次使用时间。',
  })
  @ApiParam({ name: 'employeeId', description: '数字员工 ID' })
  @ApiQuery({ name: 'days', required: false, type: Number, description: '统计窗口，默认 30 天' })
  @ApiResponse({ status: 200, description: '使用情况汇总 + 按成员明细' })
  @ApiResponse({ status: 403, description: '未获得该硅基员工的使用授权' })
  getEmployeeUsage(
    @Request() req: AuthRequest,
    @Param('employeeId') employeeId: string,
    @Query('days') daysStr?: string,
  ) {
    const parsed = daysStr === undefined ? 30 : Number.parseInt(daysStr, 10);
    const days = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 90) : 30;
    return this.service.getEmployeeUsage(req.user.id, employeeId, days);
  }

  @Get('skill-versions')
  @ApiOperation({ summary: '获取当前企业创建的技能版本' })
  @ApiQuery({ name: 'status', required: false, enum: SkillVersionStatus })
  listEnterpriseVersions(
    @Request() req: AuthRequest,
    @Query('status') rawStatus?: string,
  ) {
    const status = rawStatus ? SkillVersionStatusSchema.parse(rawStatus) : undefined;
    return this.service.listEnterpriseVersions(req.user.id, status);
  }

  @Get('skill-versions/:id/preview')
  @ApiOperation({ summary: '预览已授权技能版本的 Markdown 正文' })
  @ApiResponse({ status: 200, description: '仅返回正文和安全版本元数据' })
  @ApiResponse({ status: 403, description: '无员工使用授权' })
  preview(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.service.previewEnterpriseVersion(req.user.id, id);
  }

  @Post('subscriptions/:subscriptionId/skill-versions')
  @ApiOperation({ summary: '基于可用版本创建企业私有技能版本' })
  createEnterpriseVersion(
    @Request() req: AuthRequest,
    @Param('subscriptionId') subscriptionId: string,
    @Body() body: unknown,
  ) {
    return this.service.createEnterpriseVersion(
      req.user.id,
      subscriptionId,
      CreateEnterpriseSkillVersionDtoSchema.parse(body),
    );
  }

  @Patch('skill-versions/:id')
  @ApiOperation({ summary: '编辑企业技能草稿正文' })
  updateEnterpriseVersion(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateEnterpriseVersion(
      req.user.id,
      id,
      UpdateSkillVersionDtoSchema.parse(body),
    );
  }

  @Post('skill-versions/:id/publish')
  @ApiOperation({
    summary: '发布企业版草稿并立即生效',
    description:
      '取代「提交审核 → 自己批准」两步：管理员自建的草稿再走一遍自审是纯仪式。发布后切为所有相关雇佣关系的生效版本并通知成员。',
  })
  @ApiResponse({ status: 201, description: '发布后的版本 + 影响的雇佣关系数' })
  @ApiResponse({ status: 409, description: '只有草稿可以发布' })
  publishEnterpriseVersion(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.service.publishEnterpriseVersion(req.user.id, id);
  }

  @Post('subscriptions/:subscriptionId/skills/:capabilityId/select-version')
  @ApiOperation({ summary: '企业管理员选择员工实际使用的技能版本' })
  selectVersion(
    @Request() req: AuthRequest,
    @Param('subscriptionId') subscriptionId: string,
    @Param('capabilityId') capabilityId: string,
    @Body() body: unknown,
  ) {
    const dto = SelectSkillVersionDtoSchema.parse(body);
    return this.service.selectVersion(
      req.user.id,
      subscriptionId,
      capabilityId,
      dto.versionId,
    );
  }

  @Post('skill-versions/:id/submit-platform-review')
  @ApiOperation({ summary: '将企业审核通过版本提交平台审核' })
  submitPlatformReview(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.service.submitPlatformReview(req.user.id, id);
  }

  @Get('capabilities')
  @ApiOperation({ summary: '「能力迭代」列表：本成员有授权的 SKILL 类能力及其生效版本' })
  @ApiResponse({ status: 200, description: '能力列表，含使用人数与调用轮次' })
  listIterableCapabilities(@Request() req: AuthRequest) {
    return this.service.listIterableCapabilities(req.user.id);
  }

  @Get('capabilities/:capabilityId/versions')
  @ApiOperation({ summary: '版本时间线：平台版与企业版混排，标出当前生效版本' })
  @ApiResponse({ status: 200, description: '版本列表，含审核历史' })
  @ApiResponse({ status: 403, description: '未获得该技能的使用授权' })
  listVersionTimeline(
    @Request() req: AuthRequest,
    @Param('capabilityId') capabilityId: string,
  ) {
    return this.service.listVersionTimeline(req.user.id, capabilityId);
  }

  @Get('capabilities/:capabilityId/usage')
  @ApiOperation({ summary: '技能使用记录汇总（三层聚合：总览+员工+用户）' })
  @ApiResponse({ status: 200, description: '使用统计汇总' })
  getUsageSummary(
    @Request() req: AuthRequest,
    @Param('capabilityId') capabilityId: string,
  ) {
    return this.service.getUsageSummary(req.user.id, capabilityId);
  }

  @Get('capabilities/:capabilityId/executions')
  @ApiOperation({ summary: '技能执行明细（仅企业管理员）' })
  @ApiResponse({ status: 200, description: '执行明细列表' })
  @ApiResponse({ status: 403, description: '仅企业管理员可见' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  async getExecutionDetails(
    @Request() req: AuthRequest,
    @Param('capabilityId') capabilityId: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedLimit = limitStr === undefined ? 20 : Number.parseInt(limitStr, 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20;
    return this.service.getExecutionDetails(req.user.id, capabilityId, limit, cursor);
  }

  // ──────────── 员工个人副本与采纳（会议纪要2 §6.4）────────────

  @Post('capabilities/:capabilityId/personal-version')
  @ApiOperation({
    summary: '创建我的技能副本',
    description: '基于当前生效版本创建个人副本，直接生效，不需要提交审核。已有副本时返回它。',
  })
  @ApiResponse({ status: 201, description: '个人副本（含正文）' })
  @ApiResponse({ status: 403, description: '未获得该技能的使用授权' })
  createPersonalVersion(
    @Request() req: AuthRequest,
    @Param('capabilityId') capabilityId: string,
  ) {
    return this.service.createPersonalVersion(req.user.id, capabilityId);
  }

  @Patch('personal-versions/:id')
  @ApiOperation({ summary: '编辑我的技能副本（改完即生效）' })
  @ApiResponse({ status: 200, description: '更新后的个人副本' })
  @ApiResponse({ status: 404, description: '副本不存在或不属于当前用户' })
  updatePersonalVersion(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.updatePersonalVersion(
      req.user.id,
      id,
      UpdateSkillVersionDtoSchema.parse(body),
    );
  }

  @Delete('personal-versions/:id')
  @ApiOperation({
    summary: '弃用我的技能副本',
    description: '回落到企业版。已被采纳过的副本改为归档而不删除，保留「这一版从哪来」的证据。',
  })
  discardPersonalVersion(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.service.discardPersonalVersion(req.user.id, id);
  }

  @Get('capabilities/:capabilityId/personal-diffs')
  @ApiOperation({
    summary: '大家的改动',
    description: '管理员看本企业全部成员的个人副本；普通成员只看自己的。含与企业生效版本的对比基线。',
  })
  @ApiResponse({ status: 200, description: '个人副本列表 + 对比基线' })
  listPersonalDiffs(
    @Request() req: AuthRequest,
    @Param('capabilityId') capabilityId: string,
  ) {
    return this.service.listPersonalDiffs(req.user.id, capabilityId);
  }

  @Post('capabilities/:capabilityId/adopt')
  @ApiOperation({
    summary: '采纳成员改动',
    description:
      '一个 id 是逐条采纳，多个 id 是一键采纳多人改动。生成新企业版本并切为生效，同时通知企业成员。',
  })
  @ApiResponse({ status: 201, description: '新企业版本 + 采纳条数 + 影响的雇佣关系数' })
  @ApiResponse({ status: 403, description: '仅企业管理员可采纳' })
  adoptPersonalVersions(
    @Request() req: AuthRequest,
    @Param('capabilityId') capabilityId: string,
    @Body() body: unknown,
  ) {
    return this.service.adoptPersonalVersions(
      req.user.id,
      capabilityId,
      AdoptPersonalVersionsDtoSchema.parse(body),
    );
  }
}

@ApiTags('Admin Skill Versions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/skill-versions')
export class AdminSkillVersionController {
  constructor(private readonly service: SkillVersionService) {}

  @Get()
  @ApiOperation({ summary: '分页查询平台和企业提交的技能版本' })
  @ApiQuery({ name: 'status', required: false, enum: SkillVersionStatus })
  @ApiQuery({ name: 'scope', required: false, enum: SkillVersionScope })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  list(
    @Query('status') rawStatus?: string,
    @Query('scope') rawScope?: string,
    @Query('page') rawPage = '1',
    @Query('limit') rawLimit = '20',
  ) {
    const status = rawStatus ? SkillVersionStatusSchema.parse(rawStatus) : undefined;
    const scope = rawScope ? SkillVersionScopeSchema.parse(rawScope) : undefined;
    const page = Math.max(Number.parseInt(rawPage, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(rawLimit, 10) || 20, 1), 100);
    return this.service.listAdminVersions({ status, scope, page, limit });
  }

  @Get(':id')
  @ApiOperation({ summary: '获取技能版本正文、来源和审核历史' })
  getOne(@Param('id') id: string) {
    return this.service.getAdminVersion(id);
  }

  @Post('capabilities/:capabilityId')
  @ApiOperation({ summary: '创建新的平台技能草稿版本' })
  createPlatformVersion(
    @Request() req: AuthRequest,
    @Param('capabilityId') capabilityId: string,
    @Body() body: unknown,
  ) {
    return this.service.createPlatformVersion(
      req.user.id,
      capabilityId,
      CreatePlatformSkillVersionDtoSchema.parse(body),
    );
  }

  @Post(':id/submit-review')
  @ApiOperation({ summary: '提交平台技能草稿审核' })
  submitReview(@Param('id') id: string) {
    return this.service.submitAdminPlatformReview(id);
  }

  @Post(':id/review')
  @ApiOperation({ summary: '平台审核技能版本' })
  review(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.reviewPlatformVersion(
      req.user.id,
      id,
      ReviewSkillVersionDtoSchema.parse(body),
    );
  }
}
