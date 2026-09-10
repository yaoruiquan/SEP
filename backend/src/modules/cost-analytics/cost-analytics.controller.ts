import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Res,
  BadRequestException,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CostAnalyticsService } from './cost-analytics.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import type { CostSummary, CostByDimensionItem, CostTrendPoint } from 'shared';

@ApiTags('Cost Analytics')
@Controller('enterprises/:enterpriseId/cost')
@UseGuards(JwtAuthGuard)
export class CostAnalyticsController {
  constructor(
    private readonly costService: CostAnalyticsService,
    private readonly enterpriseContext: EnterpriseContextService,
  ) {}

  private async authorizedEnterpriseId(userId: string, requestedId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    if (ctx.enterpriseId !== requestedId) {
      throw new BadRequestException('企业上下文与请求不匹配');
    }
    return ctx.enterpriseId;
  }

  @Get('summary')
  @ApiOperation({ summary: '成本概览' })
  @ApiResponse({ status: 200, description: '总花费、预算使用率、环比' })
  async getSummary(
    @Param('enterpriseId') enterpriseId: string,
    @Request() req: { user: { id: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<CostSummary> {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    return this.costService.getSummary(await this.authorizedEnterpriseId(req.user.id, enterpriseId), fromDate, toDate);
  }

  @Get('by-department')
  @ApiOperation({ summary: '按部门归因' })
  @ApiResponse({ status: 200, description: '各部门成本占比' })
  async getByDepartment(
    @Param('enterpriseId') enterpriseId: string,
    @Request() req: { user: { id: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<CostByDimensionItem[]> {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    return this.costService.getByDepartment(await this.authorizedEnterpriseId(req.user.id, enterpriseId), fromDate, toDate);
  }

  @Get('by-employee')
  @ApiOperation({ summary: '按员工归因（Top 20）' })
  @ApiResponse({ status: 200, description: '用量最高的员工' })
  async getByEmployee(
    @Param('enterpriseId') enterpriseId: string,
    @Request() req: { user: { id: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ): Promise<CostByDimensionItem[]> {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.costService.getByEmployee(
      await this.authorizedEnterpriseId(req.user.id, enterpriseId),
      fromDate,
      toDate,
      limitNum,
    );
  }

  @Get('by-model')
  @ApiOperation({ summary: '按模型归因' })
  @ApiResponse({ status: 200, description: '各模型成本占比' })
  async getByModel(
    @Param('enterpriseId') enterpriseId: string,
    @Request() req: { user: { id: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<CostByDimensionItem[]> {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    return this.costService.getByModel(await this.authorizedEnterpriseId(req.user.id, enterpriseId), fromDate, toDate);
  }

  @Get('trend')
  @ApiOperation({ summary: '成本趋势' })
  @ApiResponse({ status: 200, description: '按天/周/月的趋势数据' })
  async getTrend(
    @Param('enterpriseId') enterpriseId: string,
    @Request() req: { user: { id: string } },
    @Query('granularity') granularity?: 'day' | 'week' | 'month',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<CostTrendPoint[]> {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    return this.costService.getTrend(
      await this.authorizedEnterpriseId(req.user.id, enterpriseId),
      granularity ?? 'day',
      fromDate,
      toDate,
    );
  }

  @Get('export')
  @ApiOperation({ summary: '导出成本数据' })
  @ApiResponse({ status: 200, description: 'CSV 文件下载' })
  async exportData(
    @Param('enterpriseId') enterpriseId: string,
    @Request() req: { user: { id: string } },
    @Query('format') format: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Res() res?: Response,
  ): Promise<void> {
    if (format !== 'csv') {
      throw new BadRequestException('仅支持 format=csv');
    }

    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const buffer = await this.costService.exportCsv(
      await this.authorizedEnterpriseId(req.user.id, enterpriseId),
      fromDate,
      toDate,
    );

    res!.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cost-${enterpriseId}.csv"`,
    });
    res!.send(buffer);
  }
}
