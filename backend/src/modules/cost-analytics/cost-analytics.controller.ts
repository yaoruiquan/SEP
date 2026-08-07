import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CostAnalyticsService } from './cost-analytics.service';
import type { CostSummary, CostByDimensionItem, CostTrendPoint } from 'shared';

@ApiTags('Cost Analytics')
@Controller('enterprises/:enterpriseId/cost')
@UseGuards(JwtAuthGuard)
export class CostAnalyticsController {
  constructor(private readonly costService: CostAnalyticsService) {}

  @Get('summary')
  @ApiOperation({ summary: '成本概览' })
  @ApiResponse({ status: 200, description: '总花费、预算使用率、环比' })
  async getSummary(
    @Param('enterpriseId') enterpriseId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<CostSummary> {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    return this.costService.getSummary(enterpriseId, fromDate, toDate);
  }

  @Get('by-department')
  @ApiOperation({ summary: '按部门归因' })
  @ApiResponse({ status: 200, description: '各部门成本占比' })
  async getByDepartment(
    @Param('enterpriseId') enterpriseId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<CostByDimensionItem[]> {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    return this.costService.getByDepartment(enterpriseId, fromDate, toDate);
  }

  @Get('by-employee')
  @ApiOperation({ summary: '按员工归因（Top 20）' })
  @ApiResponse({ status: 200, description: '用量最高的员工' })
  async getByEmployee(
    @Param('enterpriseId') enterpriseId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ): Promise<CostByDimensionItem[]> {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.costService.getByEmployee(
      enterpriseId,
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
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<CostByDimensionItem[]> {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    return this.costService.getByModel(enterpriseId, fromDate, toDate);
  }

  @Get('trend')
  @ApiOperation({ summary: '成本趋势' })
  @ApiResponse({ status: 200, description: '按天/周/月的趋势数据' })
  async getTrend(
    @Param('enterpriseId') enterpriseId: string,
    @Query('granularity') granularity?: 'day' | 'week' | 'month',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<CostTrendPoint[]> {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    return this.costService.getTrend(
      enterpriseId,
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
      enterpriseId,
      fromDate,
      toDate,
    );

    res!.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cost-${enterpriseId}.csv"`,
    });
    res!.send(buffer);
  }

  @Get('alerts')
  @ApiOperation({ summary: '当前告警列表' })
  @ApiResponse({ status: 200, description: '当月超阈值告警' })
  async getAlerts(@Param('enterpriseId') enterpriseId: string) {
    return this.costService.getAlerts(enterpriseId);
  }
}
