import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { SkillVersionScope, SkillVersionStatus, UserRole } from '@prisma/client';
import {
  AdoptEnterpriseVersionDtoSchema,
  AdminSkillVersionQuerySchema,
  type AdminSkillVersionQuery,
  type AdoptEnterpriseVersionDto,
  type CreatePlatformSkillVersionDto,
  SubmitAdminPlatformReviewDtoSchema,
  PublishPlatformSkillVersionDtoSchema,
  type PublishPlatformSkillVersionDto,
  type SubmitAdminPlatformReviewDto,
  AdoptPersonalVersionsDtoSchema,
  CreateEnterpriseSkillVersionDtoSchema,
  CreatePlatformSkillVersionDtoSchema,
  ReviewSkillVersionDtoSchema,
  SkillVersionStatusSchema,
  SelectSkillVersionDtoSchema,
  SelectPersonalSkillVersionDtoSchema,
  UpdateSkillVersionDtoSchema,
  SubmitPersonalSkillVersionDtoSchema,
  SkillSubmissionKeySchema,
  PersonalSkillReviewQuerySchema,
  PersonalSkillDiffQuerySchema,
  type SubmitPersonalSkillVersionDto,
  type PersonalSkillReviewQuery,
  type PersonalSkillDiffQuery,
  type ReviewSkillVersionDto,
  type SelectPersonalSkillVersionDto,
  type SelectSkillVersionDto,
} from 'shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PersonalSkillSubmissionService } from './personal-skill-submission.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SkillVersionService } from './skill-version.service';

type AuthRequest = { user: { id: string; role: UserRole } };

// 技能页会在进入时并行拉取多个员工的技能。全局默认限流是每个路由/IP
// 每分钟 100 次，客户端在企业员工较多或重试时容易把同一路由打满。
// 这里只放宽只读技能元数据接口，不影响写接口和认证接口的安全阈值。
const SKILL_READ_THROTTLE = { default: { ttl: 60_000, limit: 300 } };

@ApiTags('Enterprise Skill Versions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('enterprise')
export class EnterpriseSkillVersionController {
  constructor(
    private readonly service: SkillVersionService,
    private readonly submissions: PersonalSkillSubmissionService,
  ) {}

  @Post('skill-versions')
  @ApiOperation({ summary: '保存完整个人 SKILL.md 并原子提交企业审核' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: '每次保存生成独立键；重试复用原键，16-128 位字母数字或 _ -' })
  @ApiBody({ schema: { type: 'object', required: ['capabilityId', 'parentVersionId', 'content'], properties: {
    capabilityId: { type: 'string' }, parentVersionId: { type: 'string' },
    content: { type: 'string', maxLength: 500000, description: '保留 frontmatter、换行的完整 Markdown' },
    changeSummary: { type: 'string', maxLength: 2000 },
  } } })
  @ApiResponse({ status: 201, description: '个人版本及 submittedAt；首次为 PENDING_ENTERPRISE_REVIEW，重试返回同一版本当前审核状态' })
  @ApiResponse({ status: 400, description: '请求参数或幂等键无效，来源能力不匹配' })
  @ApiResponse({ status: 404, description: '技能未授权或来源版本不可访问' })
  @ApiResponse({ status: 409, description: '相同幂等键对应不同内容' })
  submitPersonalVersion(
    @Request() req: AuthRequest,
    @Headers('idempotency-key') rawKey: string,
    @Body(new ZodValidationPipe(SubmitPersonalSkillVersionDtoSchema)) dto: SubmitPersonalSkillVersionDto,
  ) {
    const key = new ZodValidationPipe(SkillSubmissionKeySchema).transform(rawKey);
    return this.submissions.submit(req.user.id, key, dto);
  }

  @Get('skill-version-reviews')
  @ApiOperation({ summary: '企业管理员分页查询个人版本审核队列和结果' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING_ENTERPRISE_REVIEW', 'ENTERPRISE_APPROVED', 'ENTERPRISE_REJECTED'] })
  @ApiQuery({ name: 'capabilityId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'items、total、page、limit；本企业Web与客户端个人改动及审核结果' })
  @ApiResponse({ status: 403, description: '仅企业管理员可审核' })
  listPersonalReviews(
    @Request() req: AuthRequest,
    @Query(new ZodValidationPipe(PersonalSkillReviewQuerySchema)) query: PersonalSkillReviewQuery,
  ) { return this.submissions.reviews(req.user.id, query); }

  @Post('skill-versions/:id/review')
  @ApiOperation({ summary: '统一审核个人技能改动，通过后发布企业版本并更新默认' })
  @ApiBody({ schema: { type: 'object', required: ['decision'], properties: {
    decision: { type: 'string', enum: ['APPROVE', 'REJECT'] }, comment: { type: 'string', maxLength: 2000 },
    expectedUpdatedAt: { type: 'string', format: 'date-time', description: '审核Web工作副本必填，传预览时updatedAt' },
  } } })
  @ApiResponse({ status: 201, description: '审核结果及publishedVersionId；通过后自动启用，正式执行忽略历史个人选版' })
  @ApiResponse({ status: 400, description: '驳回必须填写 comment' })
  @ApiResponse({ status: 403, description: '仅企业管理员可审核' })
  @ApiResponse({ status: 404, description: '个人送审版本不存在或跨企业' })
  @ApiResponse({ status: 409, description: '已审核，不能重复处理' })
  reviewPersonalVersion(
    @Request() req: AuthRequest, @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewSkillVersionDtoSchema)) dto: ReviewSkillVersionDto,
  ) { return this.submissions.review(req.user.id, id, dto); }

  @Get('employees/:employeeId/skills')
  @SkipThrottle({ auth: true, chat: true })
  @Throttle(SKILL_READ_THROTTLE)
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
  @SkipThrottle({ auth: true, chat: true })
  @Throttle(SKILL_READ_THROTTLE)
  @ApiOperation({ summary: '获取当前企业创建的技能版本' })
  @ApiQuery({ name: 'status', required: false, enum: SkillVersionStatus })
  @ApiQuery({ name: 'capabilityId', required: false, description: '提供时返回该能力的已发布版本与本人全部个人版本；不传保持原企业列表契约' })
  @ApiResponse({ status: 200, description: '版本列表，含 submittedAt、enterpriseReviewedAt、rejectionReason' })
  listEnterpriseVersions(
    @Request() req: AuthRequest,
    @Query('status') rawStatus?: string,
    @Query('capabilityId') capabilityId?: string,
  ) {
    const status = rawStatus ? new ZodValidationPipe(SkillVersionStatusSchema).transform(rawStatus) : undefined;
    if (capabilityId !== undefined) {
      const query = new ZodValidationPipe(PersonalSkillReviewQuerySchema).transform({ capabilityId });
      return this.submissions.list(req.user.id, query.capabilityId, status);
    }
    return this.service.listEnterpriseVersions(req.user.id, status);
  }

  @Get('skill-versions/:id/preview')
  @ApiOperation({ summary: '预览本企业可见技能版本的 Markdown 正文；可见性不授予执行权限' })
  @ApiResponse({ status: 200, description: '仅返回正文和安全版本元数据' })
  @ApiResponse({ status: 403, description: '无权查看该版本' })
  preview(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.service.previewEnterpriseVersion(req.user.id, id);
  }

  @Post('subscriptions/:subscriptionId/skill-versions')
  @ApiOperation({ summary: '已停用：Web 创建企业技能草稿' })
  @ApiResponse({ status: 403, description: '请通过客户端修改并上传技能' })
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
  @ApiOperation({ summary: '已停用：Web 编辑企业技能正文' })
  @ApiResponse({ status: 403, description: '请通过客户端修改并上传技能' })
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
    summary: '已停用：Web 草稿直接发布',
  })
  @ApiResponse({ status: 403, description: '客户端提交须经企业审核通过，不能直接发布 Web 草稿' })
  publishEnterpriseVersion(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.service.publishEnterpriseVersion(req.user.id, id);
  }

  @Post('capabilities/:capabilityId/default-version')
  @ApiOperation({ summary: '企业管理员启用技能版本，包括历史已通过版本' })
  @ApiBody({ schema: { type: 'object', required: ['versionId'], properties: { versionId: { type: 'string' } } } })
  @ApiResponse({ status: 201, description: '企业默认已更新，正式执行统一跟随企业启用版本' })
  @ApiResponse({ status: 400, description: '版本未发布或与技能不匹配' })
  @ApiResponse({ status: 403, description: '仅企业管理员可以设置默认' })
  @ApiResponse({ status: 404, description: '本企业技能不存在' })
  setEnterpriseDefault(
    @Request() req: AuthRequest,
    @Param('capabilityId') capabilityId: string,
    @Body(new ZodValidationPipe(SelectSkillVersionDtoSchema)) dto: SelectSkillVersionDto,
  ) {
    return this.service.setEnterpriseDefault(req.user.id, capabilityId, dto.versionId);
  }

  @Post('subscriptions/:subscriptionId/skills/:capabilityId/select-version')
  @ApiOperation({ summary: '兼容旧接口：设置企业全局技能默认版本' })
  @ApiResponse({ status: 201, description: '企业默认及有效订阅默认已更新，正式执行统一跟随企业启用版本' })
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

  @Post('subscriptions/:subscriptionId/skills/:capabilityId/select-personal-version')
  @ApiOperation({ summary: '旧个人选版接口已停用，正式执行统一跟随企业启用' })
  @ApiBody({ schema: { type: 'object', required: ['versionId'], properties: {
    versionId: { type: 'string', nullable: true, minLength: 1 },
  } } })
  @ApiResponse({ status: 403, description: '个人选版已停用，不修改历史偏好记录' })
  selectPersonalVersion(
    @Request() req: AuthRequest,
    @Param('subscriptionId') subscriptionId: string,
    @Param('capabilityId') capabilityId: string,
    @Body(new ZodValidationPipe(SelectPersonalSkillVersionDtoSchema)) dto: SelectPersonalSkillVersionDto,
  ) {
    return this.service.selectPersonalVersion(req.user.id, subscriptionId, capabilityId, dto.versionId);
  }

  @Post('skill-versions/:id/submit-platform-review')
  @ApiOperation({ summary: '已停用：企业主动投稿平台' })
  @ApiResponse({ status: 403, description: '平台运营自主选择来源审核' })
  submitPlatformReview(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.service.submitPlatformReview(req.user.id, id);
  }

  @Get('capabilities')
  @ApiOperation({ summary: '技能库列表：本企业可见技能及企业启用状态' })
  @ApiResponse({ status: 200, description: '能力列表，含使用人数与调用轮次' })
  listIterableCapabilities(@Request() req: AuthRequest) {
    return this.service.listIterableCapabilities(req.user.id);
  }

  @Get('capabilities/:capabilityId/versions')
  @SkipThrottle({ auth: true, chat: true })
  @Throttle(SKILL_READ_THROTTLE)
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

  // 历史个人副本只读与统一审核

  @Post('capabilities/:capabilityId/personal-version')
  @ApiOperation({
    summary: '已停用：Web 创建个人技能副本',
  })
  @ApiResponse({ status: 403, description: '请通过客户端修改并上传技能' })
  createPersonalVersion(
    @Request() req: AuthRequest,
    @Param('capabilityId') capabilityId: string,
  ) {
    return this.service.createPersonalVersion(req.user.id, capabilityId);
  }

  @Patch('personal-versions/:id')
  @ApiOperation({ summary: '已停用：Web 保存个人技能工作副本' })
  @ApiResponse({ status: 403, description: '历史副本只读，请通过客户端提交新的修改' })
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
    summary: '已停用：Web 弃用个人技能副本',
  })
  @ApiResponse({ status: 403, description: '历史副本保留为只读审计记录' })
  discardPersonalVersion(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.service.discardPersonalVersion(req.user.id, id);
  }

  @Get('capabilities/:capabilityId/personal-diffs')
  @ApiOperation({
    summary: '大家的改动',
    description: '管理员看本企业全部成员的个人副本；普通成员只看自己的。含与企业生效版本的对比基线。',
  })
  @ApiResponse({ status: 200, description: '个人副本列表 + 对比基线' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING_ENTERPRISE_REVIEW', 'ENTERPRISE_APPROVED', 'ENTERPRISE_REJECTED'] })
  listPersonalDiffs(
    @Request() req: AuthRequest,
    @Param('capabilityId') capabilityId: string,
    @Query(new ZodValidationPipe(PersonalSkillDiffQuerySchema)) query: PersonalSkillDiffQuery,
  ) {
    return this.service.listPersonalDiffs(req.user.id, capabilityId, query.page, query.limit, query.status);
  }

  @Post('capabilities/:capabilityId/adopt')
  @ApiOperation({
    summary: '审核成员改动（旧Web兼容入口）',
    description:
      '仅允许单条原文审核；历史工作副本须提交预览修订时间；多来源或正文覆盖返回400。',
  })
  @ApiResponse({ status: 201, description: '新企业版本 + 审核条数（兼容adoptedCount字段）+ 影响的雇佣关系数' })
  @ApiResponse({ status: 403, description: '仅企业管理员可审核' })
  @ApiResponse({ status: 400, description: '不支持多来源合并或正文覆盖' })
  @ApiResponse({ status: 409, description: '已审核或预览修订已变化' })
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
  @ApiOperation({ summary: '分页监控个人、企业和平台全部技能版本' })
  @ApiQuery({ name: 'status', required: false, enum: SkillVersionStatus })
  @ApiQuery({ name: 'scope', required: false, enum: SkillVersionScope })
  @ApiQuery({ name: 'enterpriseId', required: false, type: String })
  @ApiQuery({ name: 'ownerId', required: false, type: String })
  @ApiQuery({ name: 'capabilityId', required: false, type: String })
  @ApiQuery({ name: 'enterpriseStatus', required: false, enum: SkillVersionStatus })
  @ApiQuery({ name: 'enterpriseReviewStatus', required: false, enum: ['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'] })
  @ApiQuery({ name: 'platformProcessingStatus', required: false, enum: ['NOT_SUBMITTED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'] })
  @ApiQuery({ name: 'platformStatus', required: false, enum: ['NOT_SELECTED', 'DRAFT', 'PENDING_PLATFORM_REVIEW', 'PLATFORM_APPROVED', 'PLATFORM_REJECTED', 'ARCHIVED'] })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'generationType', required: false, enum: ['CLIENT_SUBMISSION', 'LEGACY_WORKING_COPY', 'REVIEW_SNAPSHOT', 'ENTERPRISE_VERSION', 'PLATFORM_CREATED', 'PLATFORM_SELECTED'] })
  @ApiQuery({ name: 'createdFrom', required: false, type: String, description: '含时区 ISO 8601 创建时间下界（含）' })
  @ApiQuery({ name: 'createdTo', required: false, type: String, description: '含时区 ISO 8601 创建时间上界（含）' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: '稳定排序的分页记录，含归属、来源及平台处理历史' })
  @ApiResponse({ status: 400, description: '筛选或分页参数无效' })
  @ApiResponse({ status: 403, description: '仅平台管理员可访问' })
  list(@Query(new ZodValidationPipe(AdminSkillVersionQuerySchema)) filters: AdminSkillVersionQuery) {
    return this.service.listAdminVersions(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取技能版本正文、包、来源和审核历史' })
  @ApiResponse({ status: 200, description: '管理员版本详情' })
  @ApiResponse({ status: 404, description: '技能版本不存在' })
  getOne(@Param('id') id: string) { return this.service.getAdminVersion(id); }

  @Post('capabilities/:capabilityId')
  @ApiOperation({ summary: '首次创建平台技能正文并进入待审，禁止已有正文改写' })
  @ApiResponse({ status: 201, description: '平台待审版本' })
  @ApiResponse({ status: 400, description: '正文或能力类型无效' })
  @ApiResponse({ status: 404, description: '技能不存在' })
  @ApiResponse({ status: 409, description: '已有版本不能通过 Web 修改正文' })
  createPlatformVersion(@Request() req: AuthRequest, @Param('capabilityId') capabilityId: string,
    @Body(new ZodValidationPipe(CreatePlatformSkillVersionDtoSchema)) body: CreatePlatformSkillVersionDto) {
    return this.service.createPlatformVersion(req.user.id, capabilityId, body);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: '预览确认后一步发布精确来源为平台版本' })
  @ApiBody({ schema: { type: 'object', required: ['expectedUpdatedAt', 'expectedPlatformVersionId'],
    properties: { expectedUpdatedAt: { type: 'string', format: 'date-time' },
      expectedPlatformVersionId: { type: 'string', nullable: true }, changeSummary: { type: 'string', maxLength: 2000 } } } })
  @ApiResponse({ status: 201, description: '已发布平台版本，重复请求返回已有发布结果' })
  @ApiResponse({ status: 400, description: '正文或技能包校验失败，或版本不可发布' })
  @ApiResponse({ status: 403, description: '仅平台管理员可以发布' })
  @ApiResponse({ status: 404, description: '来源技能版本不存在' })
  @ApiResponse({ status: 409, description: '来源或当前平台版本已变化，请重新预览' })
  publish(@Request() req: AuthRequest, @Param('id') id: string,
    @Body(new ZodValidationPipe(PublishPlatformSkillVersionDtoSchema)) body: PublishPlatformSkillVersionDto) {
    return this.service.publishPlatformVersion(req.user.id, id, body);
  }

  @Post(':id/submit-review')
  @ApiOperation({ summary: '重用平台草稿或驳回记录并再次提交审核' })
  @ApiResponse({ status: 201, description: '平台待审版本，不修改历史审核记录' })
  @ApiResponse({ status: 400, description: '正文或技能包未通过校验' })
  @ApiResponse({ status: 404, description: '技能版本不存在' })
  @ApiBody({ schema: { type: 'object', properties: { expectedUpdatedAt: { type: 'string', format: 'date-time' } } } })
  @ApiResponse({ status: 409, description: '当前版本状态不能送审或预览已过期' })
  submitReview(@Param('id') id: string,
    @Body(new ZodValidationPipe(SubmitAdminPlatformReviewDtoSchema)) body: SubmitAdminPlatformReviewDto) {
    return this.service.submitAdminPlatformReview(id, body);
  }

  @Post(':id/adopt')
  @ApiOperation({ summary: '选定个人或企业来源，复制为平台待审版本',
    description: '接受个人、待审、驳回及历史来源。mode 仅允许 DRAFT（默认），所有市场发布必须平台审核。私有能力复制为独立平台能力；重复选择返回已有处理记录。' })
  @ApiResponse({ status: 201, description: '平台待审版本或已存在的平台处理记录（含正文）' })
  @ApiResponse({ status: 400, description: '不能绕过审核，或所选正文／包无效' })
  @ApiResponse({ status: 404, description: '来源技能版本不存在' })
  @ApiResponse({ status: 409, description: '预览已过期，请重新预览来源' })
  adopt(@Request() req: AuthRequest, @Param('id') id: string,
    @Body(new ZodValidationPipe(AdoptEnterpriseVersionDtoSchema)) body: AdoptEnterpriseVersionDto) {
    return this.service.adoptEnterpriseVersion(req.user.id, id, body);
  }

  @Post(':id/review')
  @ApiOperation({ summary: '审核精确选定的平台版本，通过后公开平台技能' })
  @ApiResponse({ status: 201, description: '审核结果，只发布选定版本并推进平台绑定' })
  @ApiResponse({ status: 400, description: '缺少驳回原因或正文／包校验失败' })
  @ApiResponse({ status: 404, description: '技能版本不存在' })
  @ApiResponse({ status: 409, description: '版本已审核或预览过期' })
  review(@Request() req: AuthRequest, @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewSkillVersionDtoSchema)) body: ReviewSkillVersionDto) {
    return this.service.reviewPlatformVersion(req.user.id, id, body);
  }
}
