import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Request,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KnowledgeTestService } from './knowledge-test.service';
import { KnowledgeAnalyticsService } from './knowledge-analytics.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import {
  TestSearchDtoSchema,
  BatchReprocessDtoSchema,
  type TestSearchDto,
  type BatchReprocessDto,
} from 'shared';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';

type AuthedRequest = { user: { id: string; userId?: string } };

/** 从 JWT payload 中取出 userId（兼容两种字段名） */
function userId(req: AuthedRequest): string {
  // req.user is the result of JwtStrategy.validate() which returns the full user object
  // The id field is the userId
  return req.user.id;
}

@ApiTags('Knowledge - Test & Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('knowledge-bases')
export class KnowledgeTestController {
  constructor(
    private readonly testService: KnowledgeTestService,
    private readonly analyticsService: KnowledgeAnalyticsService,
    private readonly prisma: PrismaService,
    private readonly enterpriseContext: EnterpriseContextService,
  ) {}

  // ── 帮助方法：从 userId 解析 enterpriseId ────────────────────────────────

  private async getEnterpriseId(uid: string): Promise<string> {
    const member = await this.prisma.enterpriseMember.findFirst({
      where: { userId: uid },
      select: { enterpriseId: true },
    });
    if (!member) {
      throw new NotFoundException('用户不属于任何企业');
    }
    return member.enterpriseId;
  }

  // ── 检索测试 ──────────────────────────────────────────────────────────────

  @Post(':id/test-search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '测试检索效果',
    description: '在指定知识库内进行检索测试，返回带分数的文本块结果，并记录检索日志（isTest=true）',
  })
  @ApiResponse({ status: 200, description: '检索结果（含分数、耗时、策略）' })
  @ApiResponse({ status: 404, description: '知识库不存在或无权访问' })
  async testSearch(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TestSearchDtoSchema)) dto: TestSearchDto,
  ) {
    const context = await this.enterpriseContext.resolve(userId(req));
    this.enterpriseContext.assertEnterpriseAdmin(context);
    const enterpriseId = context.enterpriseId;
    return this.testService.testSearch(id, enterpriseId, dto);
  }

  // ── 文档状态 ──────────────────────────────────────────────────────────────

  @Get(':id/documents/status')
  @ApiOperation({
    summary: '获取文档处理状态汇总',
    description: '返回知识库内各文档的处理状态，包含 PENDING/PROCESSING/READY/FAILED 计数及详情',
  })
  @ApiResponse({ status: 200, description: '文档状态汇总' })
  @ApiResponse({ status: 404, description: '知识库不存在或无权访问' })
  async getDocumentStatus(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
  ) {
    const enterpriseId = await this.getEnterpriseId(userId(req));
    return this.testService.getDocumentStatus(id, enterpriseId);
  }

  // ── 批量重处理 ────────────────────────────────────────────────────────────

  @Post(':id/documents/batch-reprocess')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '批量重新处理文档',
    description: '将指定状态（默认 FAILED）的文档重新入队解析+向量化',
  })
  @ApiResponse({ status: 200, description: '排队成功，返回文档 ID 列表' })
  @ApiResponse({ status: 404, description: '知识库不存在或无权访问' })
  async batchReprocess(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(BatchReprocessDtoSchema)) dto: BatchReprocessDto,
  ) {
    const context = await this.enterpriseContext.resolve(userId(req));
    this.enterpriseContext.assertEnterpriseAdmin(context);
    const enterpriseId = context.enterpriseId;
    return this.testService.batchReprocess(id, enterpriseId, dto);
  }

  // ── 分析 ──────────────────────────────────────────────────────────────────

  @Get(':id/analytics')
  @ApiOperation({
    summary: '检索分析数据',
    description: '返回指定天数内的检索次数、命中率、零命中查询、从未命中文档等分析数据',
  })
  @ApiQuery({ name: 'days', required: false, type: Number, description: '统计天数（默认 30）' })
  @ApiResponse({ status: 200, description: '分析报告' })
  @ApiResponse({ status: 404, description: '知识库不存在或无权访问' })
  async getAnalytics(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Query('days') days?: string,
  ) {
    const enterpriseId = await this.getEnterpriseId(userId(req));
    return this.analyticsService.getAnalytics(
      id,
      enterpriseId,
      days ? parseInt(days, 10) : 30,
    );
  }
}
