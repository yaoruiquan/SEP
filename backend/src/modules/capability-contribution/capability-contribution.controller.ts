import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Request,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import {
  ContributionCapabilityCreateDtoSchema,
  ContributionCapabilityUpdateDtoSchema,
  ContributionReviewDecisionSchema,
  ContributionVersionCreateDtoSchema,
  ContributionVersionUpdateDtoSchema,
  type ContributionCapabilityCreateDto,
  type ContributionCapabilityUpdateDto,
  type ContributionReviewDecision,
  type ContributionVersionCreateDto,
  type ContributionVersionUpdateDto,
  type SkillPackageParseResult,
} from 'shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  SKILL_PACKAGE_MAX_BYTES,
  SkillPackageService,
} from '../skill-package/skill-package.service';
import { CapabilityContributionService } from './capability-contribution.service';
import { CapabilityValidatorService } from './capability-validator.service';

type AuthRequest = { user: { id: string } };

/**
 * memoryStorage 而非 diskStorage：包要先过魔数与结构校验才决定是否落盘，
 * 落盘位置还得由内容哈希决定。上限由 fileSize 兜住，不会长期占内存。
 */
const SKILL_PACKAGE_MULTER = {
  storage: memoryStorage(),
  limits: { fileSize: SKILL_PACKAGE_MAX_BYTES, files: 1 },
};

@ApiTags('Capability Contributions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('contributions')
export class CapabilityContributionController {
  constructor(
    private readonly service: CapabilityContributionService,
    private readonly skillPackage: SkillPackageService,
    private readonly validator: CapabilityValidatorService,
  ) {}

  @Post('skill-package')
  @ApiOperation({
    summary: '上传 SKILL 包（zip，须含 SKILL.md）',
    description:
      '返回 sha256 与解析结果。创建能力时只回传 sha256，正文由服务端按哈希重新解包提取。',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 201, description: '解析成功，返回包元数据与自动校验结论' })
  @ApiResponse({ status: 400, description: '不是 zip、缺少 SKILL.md 或包结构非法' })
  @ApiResponse({ status: 413, description: '包超过大小上限' })
  @UseInterceptors(FileInterceptor('file', SKILL_PACKAGE_MULTER))
  async uploadSkillPackage(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<SkillPackageParseResult> {
    const stored = await this.skillPackage.store(file);
    // 上传即校验：提交审核前就把缺段落、含密钥之类的问题暴露出来，
    // 而不是等第三步走完、点提交才报错。
    const { kind: _kind, ...validation } = this.validator.validateSkill(stored.content);
    return {
      sha256: stored.sha256,
      filename: stored.filename,
      fileCount: stored.fileCount,
      totalBytes: stored.totalBytes,
      content: stored.content,
      suggested: stored.suggested,
      validation,
    };
  }

  @Get('versions/:versionId')
  @ApiOperation({
    summary: '作者查看自己某个版本的正文',
    description:
      '与 /enterprise/skill-versions/:id/preview 不同：那条要求成员持有该能力的订阅授权，'
      + '刚贡献的能力没有任何绑定，作者永远拿不到自己的正文。',
  })
  @ApiResponse({ status: 404, description: '版本不存在或不属于当前作者' })
  version(@Request() req: AuthRequest, @Param('versionId') versionId: string) {
    return this.service.getVersionForAuthor(req.user.id, versionId);
  }

  @Patch('versions/:versionId')
  @ApiOperation({ summary: '编辑草稿版本正文（仅在线编写的版本）' })
  @ApiResponse({ status: 409, description: '版本状态不可编辑，或正文来自上传的包' })
  updateVersion(@Request() req: AuthRequest, @Param('versionId') versionId: string, @Body(new ZodValidationPipe(ContributionVersionUpdateDtoSchema)) dto: ContributionVersionUpdateDto) {
    return this.service.updateVersion(req.user.id, versionId, dto);
  }

  @Post('versions/:versionId/submit')
  @ApiOperation({
    summary: '提交版本审核',
    description: '企业版本先过企业管理员，个人版本直投平台。能力级审核只管首次发布，迭代走这里。',
  })
  @ApiResponse({ status: 400, description: '缺变更说明，或自动校验未通过' })
  submitVersion(@Request() req: AuthRequest, @Param('versionId') versionId: string) {
    return this.service.submitVersion(req.user.id, versionId);
  }

  @Get('versions/:versionId/package')
  @ApiOperation({ summary: '下载某个版本上传的 SKILL 包' })
  @ApiResponse({ status: 200, description: '返回 zip 文件' })
  @ApiResponse({ status: 404, description: '版本不存在、无权访问或该版本没有包' })
  async downloadVersionPackage(
    @Request() req: AuthRequest,
    @Param('versionId') versionId: string,
    @Res() res: Response,
  ) {
    const { key, filename } = await this.service.getVersionPackage(
      req.user.id,
      versionId,
    );
    res.download(this.skillPackage.resolveStoredPath(key), filename);
  }

  @Get('overview')
  @ApiOperation({ summary: '贡献中心概览' })
  overview(@Request() req: AuthRequest) { return this.service.overview(req.user.id); }

  @Get('mine')
  @ApiOperation({ summary: '我的能力列表' })
  mine(@Request() req: AuthRequest) { return this.service.listMine(req.user.id); }

  @Get('rewards')
  @ApiOperation({ summary: '我的奖励事件' })
  rewards(@Request() req: AuthRequest) { return this.service.rewards(req.user.id); }

  @Get(':id/usage')
  @ApiOperation({ summary: '能力使用情况与员工生效版本' })
  usage(@Request() req: AuthRequest, @Param('id') id: string) { return this.service.usage(req.user.id, id); }

  @Get(':id')
  @ApiOperation({ summary: '贡献能力详情' })
  detail(@Request() req: AuthRequest, @Param('id') id: string) { return this.service.getOne(req.user.id, id); }

  @Post()
  @ApiOperation({ summary: '创建企业私有能力草稿' })
  @ApiResponse({ status: 201, description: '能力草稿已创建' })
  create(@Request() req: AuthRequest, @Body(new ZodValidationPipe(ContributionCapabilityCreateDtoSchema)) dto: ContributionCapabilityCreateDto) {
    return this.service.create(req.user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '编辑能力草稿' })
  update(@Request() req: AuthRequest, @Param('id') id: string, @Body(new ZodValidationPipe(ContributionCapabilityUpdateDtoSchema)) dto: ContributionCapabilityUpdateDto) {
    return this.service.update(req.user.id, id, dto);
  }

  @Post(':id/submit-enterprise-review')
  @ApiOperation({ summary: '提交企业审核' })
  submitEnterprise(@Request() req: AuthRequest, @Param('id') id: string) { return this.service.submitEnterpriseReview(req.user.id, id); }

  @Post(':id/enterprise-review')
  @ApiOperation({ summary: '企业管理员审核能力' })
  reviewEnterprise(@Request() req: AuthRequest, @Param('id') id: string, @Body(new ZodValidationPipe(ContributionReviewDecisionSchema)) dto: ContributionReviewDecision) {
    return this.service.reviewEnterprise(req.user.id, id, dto);
  }

  @Post(':id/request-platform-review')
  @ApiOperation({ summary: '申请企业管理员授权平台投稿' })
  requestPlatform(@Request() req: AuthRequest, @Param('id') id: string) { return this.service.requestPlatformReview(req.user.id, id); }

  @Post(':id/authorize-platform-submission')
  @ApiOperation({ summary: '企业管理员授权平台投稿' })
  authorizePlatform(@Request() req: AuthRequest, @Param('id') id: string) { return this.service.authorizePlatformSubmission(req.user.id, id); }

  @Post(':id/platform-review')
  @ApiOperation({ summary: '平台运营审核投稿' })
  reviewPlatform(@Request() req: AuthRequest, @Param('id') id: string, @Body(new ZodValidationPipe(ContributionReviewDecisionSchema)) dto: ContributionReviewDecision) {
    return this.service.reviewPlatform(req.user.id, id, dto);
  }

  @Post(':id/versions')
  @ApiOperation({
    summary: '发布 Skill 新版本草稿',
    description: '正文来源与创建能力同规则：上传包只送 sha256，或直接送在线编写的 content。',
  })
  @ApiResponse({ status: 201, description: '新版本草稿已创建' })
  createVersion(@Request() req: AuthRequest, @Param('id') id: string, @Body(new ZodValidationPipe(ContributionVersionCreateDtoSchema)) dto: ContributionVersionCreateDto) {
    return this.service.createSkillVersion(req.user.id, id, dto);
  }
}
