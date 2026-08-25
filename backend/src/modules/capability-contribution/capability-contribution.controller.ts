import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ContributionCapabilityCreateDtoSchema,
  ContributionCapabilityUpdateDtoSchema,
  ContributionReviewDecisionSchema,
  ContributionVersionCreateDtoSchema,
} from 'shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CapabilityContributionService } from './capability-contribution.service';

type AuthRequest = { user: { id: string } };

@ApiTags('Capability Contributions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('contributions')
export class CapabilityContributionController {
  constructor(private readonly service: CapabilityContributionService) {}

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
  create(@Request() req: AuthRequest, @Body() body: unknown) {
    return this.service.create(req.user.id, ContributionCapabilityCreateDtoSchema.parse(body));
  }

  @Patch(':id')
  @ApiOperation({ summary: '编辑能力草稿' })
  update(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.service.update(req.user.id, id, ContributionCapabilityUpdateDtoSchema.parse(body));
  }

  @Post(':id/submit-enterprise-review')
  @ApiOperation({ summary: '提交企业审核' })
  submitEnterprise(@Request() req: AuthRequest, @Param('id') id: string) { return this.service.submitEnterpriseReview(req.user.id, id); }

  @Post(':id/enterprise-review')
  @ApiOperation({ summary: '企业管理员审核能力' })
  reviewEnterprise(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.service.reviewEnterprise(req.user.id, id, ContributionReviewDecisionSchema.parse(body));
  }

  @Post(':id/request-platform-review')
  @ApiOperation({ summary: '申请企业管理员授权平台投稿' })
  requestPlatform(@Request() req: AuthRequest, @Param('id') id: string) { return this.service.requestPlatformReview(req.user.id, id); }

  @Post(':id/authorize-platform-submission')
  @ApiOperation({ summary: '企业管理员授权平台投稿' })
  authorizePlatform(@Request() req: AuthRequest, @Param('id') id: string) { return this.service.authorizePlatformSubmission(req.user.id, id); }

  @Post(':id/platform-review')
  @ApiOperation({ summary: '平台运营审核投稿' })
  reviewPlatform(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.service.reviewPlatform(req.user.id, id, ContributionReviewDecisionSchema.parse(body));
  }

  @Post(':id/versions')
  @ApiOperation({ summary: '创建 Skill 新版本草稿' })
  createVersion(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.service.createSkillVersion(req.user.id, id, ContributionVersionCreateDtoSchema.parse(body));
  }
}
