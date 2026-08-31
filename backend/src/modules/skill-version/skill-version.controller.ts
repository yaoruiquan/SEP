import {
  Body,
  Controller,
  ForbiddenException,
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

  @Post('skill-versions/:id/submit-review')
  @ApiOperation({ summary: '提交企业内部审核' })
  submitEnterpriseReview(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.service.submitEnterpriseReview(req.user.id, id);
  }

  @Post('skill-versions/:id/review')
  @ApiOperation({ summary: '企业管理员审核企业技能版本' })
  reviewEnterpriseVersion(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.reviewEnterpriseVersion(
      req.user.id,
      id,
      ReviewSkillVersionDtoSchema.parse(body),
    );
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

  @Get('capabilities/:capabilityId/usage')
  @ApiOperation({ summary: '技能使用记录汇总（三层聚合：总览+员工+用户）' })
  async getUsageSummary(
    @Request() req: AuthRequest,
    @Param('capabilityId') capabilityId: string,
  ) {
    const ctx = await this.service['enterpriseContext'].resolve(req.user.id);
    const isAdmin = ctx.role === 'ENTERPRISE_ADMIN';
    return this.service.getUsageSummary(req.user.id, capabilityId, isAdmin);
  }

  @Get('capabilities/:capabilityId/executions')
  @ApiOperation({ summary: '技能执行明细（仅企业管理员）' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  async getExecutionDetails(
    @Request() req: AuthRequest,
    @Param('capabilityId') capabilityId: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
  ) {
    const ctx = await this.service['enterpriseContext'].resolve(req.user.id);
    if (ctx.role !== 'ENTERPRISE_ADMIN') {
      throw new ForbiddenException('执行明细仅企业管理员可见');
    }
    const limit = limitStr ? parseInt(limitStr, 10) : 20;
    return this.service.getExecutionDetails(req.user.id, capabilityId, limit, cursor);
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
