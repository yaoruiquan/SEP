import { Controller, Get, Optional, Request, ServiceUnavailableException, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { KnowledgeAuthGuard } from './knowledge-auth.guard';
import { KnowledgeNoStoreInterceptor } from './knowledge-no-store.interceptor';
import { KnowledgeTelemetryService } from './knowledge-telemetry.service';
import { KnowledgeRetentionService } from './knowledge-retention.service';
import { KnowledgeRateLimitService } from './knowledge-rate-limit.service';

@ApiTags('Knowledge Monitoring')
@ApiBearerAuth()
@UseGuards(KnowledgeAuthGuard)
@UseInterceptors(KnowledgeNoStoreInterceptor)
@Controller('admin/knowledge')
export class KnowledgeMonitoringController {
  constructor(private readonly telemetry: KnowledgeTelemetryService,
    @Optional() private readonly retention?: KnowledgeRetentionService,
    @Optional() private readonly limiter?: KnowledgeRateLimitService) {}

  @Get('metrics')
  @ApiOperation({ summary: '平台管理员知识库脱敏指标与告警状态',
    description: '最近一小时最多读取 10000 条审计事件；仅返回统计，不执行模型健康探测，不发送外部通知。' })
  @ApiResponse({ status: 200, description: '抽样检索指标、作业、历史清理、存储与索引汇总及进程内审计诊断' })
  @ApiResponse({ status: 401, description: '需要有效 JWT' })
  @ApiResponse({ status: 403, description: '当前数据库用户角色不是平台 ADMIN' })
  @ApiResponse({ status: 503, description: '指标读取暂不可用' })
  async getMetrics(@Request() request: { user?: { id?: string } }) {
    const metrics = await this.telemetry.getMetrics(request.user?.id);
    // Authorize before invoking either supplementary monitor.
    try {
      return { ...metrics,
        ...(this.retention ? { retention: await this.retention.getStatus() } : {}),
        ...(this.limiter ? { rateLimits: { scope: 'PROCESS_LOCAL', counters: this.limiter.getStats() } } : {}),
      };
    } catch {
      throw new ServiceUnavailableException({ code: 'KNOWLEDGE_METRICS_UNAVAILABLE', message: '知识库监控暂时不可用' });
    }
  }
}
