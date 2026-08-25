import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ContributionPlatformStatus, UserRole } from '@prisma/client';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContributionReviewDecisionSchema } from 'shared';
import { CapabilityContributionService } from './capability-contribution.service';

const PLATFORM_STATUSES = ['PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const;

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
