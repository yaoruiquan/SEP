import { Controller, Get, Param, Query, Request, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { ComputeCreditService } from './compute-credit.service';

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
