import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ContributionPlatformStatus, UserRole } from '@prisma/client';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContributionReviewDecisionSchema } from 'shared';
import { CapabilityContributionService } from './capability-contribution.service';

const PLATFORM_STATUSES = ['PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const;
const REVIEW_KINDS = ['ALL', 'CAPABILITY', 'SKILL_VERSION'] as const;

type AuthRequest = { user: { id: string } };

@ApiTags('Admin Capability Contributions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/contributions')
export class CapabilityContributionAdminController {
  constructor(private readonly service: CapabilityContributionService) {}

  @Get()
  @ApiOperation({ summary: '平台贡献投稿队列' })
  @ApiQuery({ name: 'status', required: false, enum: PLATFORM_STATUSES, description: '默认 PENDING_REVIEW' })
  list(
    @Query('status') status?: (typeof PLATFORM_STATUSES)[number],
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const parsed = status && z.enum(PLATFORM_STATUSES).safeParse(status);
    const queueStatus = parsed?.success ? parsed.data : 'PENDING_REVIEW';
    return this.service.listPlatformQueue(
      queueStatus as ContributionPlatformStatus,
      page ? Math.max(1, Number(page)) : 1,
      pageSize ? Math.min(100, Math.max(1, Number(pageSize))) : 20,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '平台贡献投稿详情' })
  detail(@Param('id') id: string) {
    return this.service.getPlatformSubmission(id);
  }

  @Post(':id/review')
  @ApiOperation({ summary: '平台审核贡献投稿' })
  review(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.service.reviewPlatform(req.user.id, id, ContributionReviewDecisionSchema.parse(body));
  }
}

@ApiTags('Admin Capability Review')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/capability-review')
export class CapabilityReviewAdminController {
  constructor(private readonly service: CapabilityContributionService) {}

  @Get()
  @ApiOperation({ summary: '统一能力与 Skill 版本审核队列' })
  list(@Query('kind') kind?: 'ALL' | 'CAPABILITY' | 'SKILL_VERSION') {
    const parsed = kind && z.enum(REVIEW_KINDS).safeParse(kind);
    return this.service.listUnifiedReviewQueue(parsed?.success ? parsed.data : 'ALL');
  }

  @Get('versions/:versionId/diff')
  @ApiOperation({ summary: '平台审核人查看 Skill 版本差异与审核历史' })
  versionDiff(@Request() req: AuthRequest, @Param('versionId') versionId: string) {
    return this.service.getVersionDiff(req.user.id, versionId, 'ADMIN');
  }

  @Post('versions/:versionId/review')
  @ApiOperation({ summary: '平台管理员审核 Skill 版本' })
  @ApiResponse({ status: 409, description: '版本当前状态不可审核' })
  reviewVersion(
    @Request() req: AuthRequest,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ) {
    return this.service.reviewPlatformVersion(
      req.user.id,
      versionId,
      ContributionReviewDecisionSchema.parse(body),
    );
  }
}
