import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MonitoringService } from './services/monitoring.service';
import { AlertingService } from './services/alerting.service';

/**
 * 监控控制器 - 暴露监控指标和管理端点
 * 
 * 端点:
 * - GET /api/monitoring/metrics - 获取实时指标
 * - GET /api/monitoring/errors - 获取最近错误
 * - POST /api/monitoring/test-alert - 发送测试告警
 */
@ApiTags('Monitoring')
@Controller('monitoring')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MonitoringController {
  constructor(
    private readonly monitoringService: MonitoringService,
    private readonly alertingService: AlertingService,
  ) {}

  @Get('metrics')
  @ApiOperation({ summary: '获取实时监控指标' })
  getMetrics() {
    return {
      requests: this.monitoringService.getRequestMetrics(),
      responseTime: this.monitoringService.getResponseTimeMetrics(),
      cumulative: this.monitoringService.getCumulativeMetrics(),
    };
  }

  @Get('errors')
  @ApiOperation({ summary: '获取最近错误记录' })
  getErrors() {
    return {
      errors: this.monitoringService.getRecentErrors(100),
    };
  }

  @Post('test-alert')
  @ApiOperation({ summary: '发送测试告警（用于验证告警系统）' })
  async sendTestAlert() {
    await this.alertingService.sendTestAlert();
    return {
      message: 'Test alert sent successfully',
    };
  }
}
