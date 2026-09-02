import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { ComputeCreditService } from './compute-credit.service';
import { MemberAllowanceService } from './member-allowance.service';
import { UsageAnalyticsService } from './usage-analytics.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { MemberAllowanceSetDtoSchema, type MemberAllowanceSetDto } from 'shared';

/**
 * 企业算力（人民币口径）查询接口。
 *
 * 这里只读不写：额度发放由订阅履约负责，扣费由对话链路负责。
 * 所有金额一律返回「元」的字符串（Decimal 序列化），前端只做展示格式化。
 */
@ApiTags('compute-credit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('compute-credit')
export class ComputeCreditController {
  constructor(
    private readonly creditService: ComputeCreditService,
    private readonly memberAllowance: MemberAllowanceService,
    private readonly usageAnalytics: UsageAnalyticsService,
    private readonly enterpriseContext: EnterpriseContextService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: '企业算力总览（钱包余额 + 赠送余额，单位：元）' })
  @ApiResponse({ status: 200, description: '返回人民币口径的余额与消费汇总' })
  async getOverview(@Request() req) {
    const ctx = await this.enterpriseContext.resolve(req.user.id);
    return this.creditService.getOverview(ctx.enterpriseId);
  }

  @Get('subscription-credits')
  @ApiOperation({ summary: '各硅基员工的剩余赠送算力余额（元）' })
  @ApiResponse({ status: 200, description: '按订阅返回赠送额度、已用与剩余金额' })
  async listCredits(@Request() req) {
    const ctx = await this.enterpriseContext.resolve(req.user.id);
    return this.creditService.listSubscriptionCredits(ctx.enterpriseId);
  }

  @Get('usage-records')
  @ApiOperation({ summary: '算力用量账单（人民币金额 + Token 明细）' })
  @ApiResponse({ status: 200, description: '分页返回每次模型调用的成本与扣费来源' })
  async listUsage(
    @Request() req,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('employeeId') employeeId?: string,
    @Query('memberId') memberId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const ctx = await this.enterpriseContext.resolve(req.user.id);
    return this.creditService.listUsageRecords(ctx.enterpriseId, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      employeeId,
      memberId,
      startDate,
      endDate,
    });
  }

  @Get('usage-breakdown')
  @ApiOperation({
    summary: '用量分析：花费在模型 / 部门 / 碳基员工 / 硅基员工间的分布',
    description:
      '一次返回四个维度 + 趋势 + 环比，因为它们读的是同一张表的同一个区间。' +
      '这里没有余额也没有逐笔账单 —— 那两样在「算力余额」页。',
  })
  @ApiResponse({ status: 200, description: '返回区间总额、环比、趋势与四个维度的分布' })
  async getUsageBreakdown(@Request() req, @Query('days') days?: string) {
    const ctx = await this.enterpriseContext.resolve(req.user.id);
    return this.usageAnalytics.getBreakdown(
      ctx.enterpriseId,
      days ? Number(days) : undefined,
    );
  }

  @Get('allowances')
  @ApiOperation({
    summary: '算力分配：全体碳基员工的本月额度与已用金额',
    description:
      '额度是闸门不是钱包 —— 分配不会从企业算力余额里预先划走钱，' +
      '只在成员本月已花到上限时拦下他的下一次对话。未分配 = 不限额。',
  })
  @ApiResponse({ status: 200, description: '按成员返回上限、已用、剩余与重置时间' })
  async listAllowances(@Request() req) {
    const ctx = await this.enterpriseContext.resolve(req.user.id);
    return this.memberAllowance.listAllowances(ctx.enterpriseId);
  }

  @Put('allowances/:userId')
  @ApiOperation({
    summary: '给某位碳基员工分配算力额度（仅企业管理员）',
    description: 'limitCNY 传 null 表示取消额度限制（不限额）。',
  })
  @ApiResponse({ status: 200, description: '返回该成员分配后的额度视图' })
  @ApiResponse({ status: 403, description: '仅企业管理员可分配' })
  @ApiResponse({ status: 404, description: '该成员不属于当前企业' })
  async setAllowance(
    @Request() req,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(MemberAllowanceSetDtoSchema))
    dto: MemberAllowanceSetDto,
  ) {
    const ctx = await this.enterpriseContext.resolve(req.user.id);
    this.enterpriseContext.assertEnterpriseAdmin(ctx);
    return this.memberAllowance.setAllowance(
      ctx.enterpriseId,
      userId,
      dto.limitCNY,
    );
  }

  @Get('subscription-credits/:subscriptionId')
  @ApiOperation({ summary: '单个订阅的剩余赠送算力余额（元）' })
  @ApiResponse({ status: 404, description: '赠送余额不存在或不属于当前企业' })
  async getCredit(
    @Request() req,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    const ctx = await this.enterpriseContext.resolve(req.user.id);
    return this.creditService.getSubscriptionCredit(
      ctx.enterpriseId,
      subscriptionId,
    );
  }
}
