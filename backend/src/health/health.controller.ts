import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { EmbeddingService } from '../modules/knowledge/embedding.service';
import { TaskQueueService } from '../modules/task-execution/task-queue.service';
import { KnowledgeQueueService } from '../modules/knowledge/knowledge-queue.service';

@Controller('health')
@ApiTags('Health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly embedding: EmbeddingService,
    private readonly taskQueue: TaskQueueService,
    private readonly knowledgeQueue: KnowledgeQueueService,
  ) {}

  @Get()
  @ApiOperation({ summary: '存活检查（Liveness）' })
  liveness() {
    return { 
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'sep-backend',
    };
  }

  @Get('ready')
  @ApiOperation({ summary: '就绪检查（Readiness）- 检查所有依赖服务' })
  async readiness() {
    const checks: Record<string, string> = {};
    
    // 数据库检查
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.postgres = 'ok';
    } catch {
      checks.postgres = 'failed';
    }
    
    // Redis 检查
    try {
      await this.redis.redis.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'failed';
    }
    
    // 队列检查
    checks.taskQueue = this.taskQueue.isReady() ? 'ok' : 'failed';
    checks.knowledgeQueue = this.knowledgeQueue.isReady() ? 'ok' : 'failed';
    
    // 生产环境额外检查
    if (this.config.get('NODE_ENV') === 'production') {
      checks.sub2api = await this.checkHttp(this.config.get<string>('SUB2API_BASE_URL'), true) ? 'ok' : 'failed';
      checks.embedding = await this.embedding.isAvailable() ? 'ok' : 'failed';
      
      // 检查 OpenCode Skills Service
      const opencodeBaseUrl = this.config.get<string>('OPENCODE_API_BASE_URL');
      if (opencodeBaseUrl) {
        checks.opencode = await this.checkOpenCode(opencodeBaseUrl) ? 'ok' : 'failed';
      }
    }
    
    const status = Object.values(checks).every((value) => value === 'ok') ? 'ok' : 'failed';
    const body = { 
      status, 
      checks,
      timestamp: new Date().toISOString(),
    };
    
    if (status !== 'ok') throw new ServiceUnavailableException(body);
    return body;
  }

  private async checkHttp(baseUrl: string | undefined, models: boolean) {
    if (!baseUrl) return false;
    try {
      const url = `${baseUrl.replace(/\/+$/, '')}/${models ? 'models' : ''}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      return response.ok || response.status === 401;
    } catch {
      return false;
    }
  }

  private async checkOpenCode(baseUrl: string): Promise<boolean> {
    try {
      const url = `${baseUrl.replace(/\/+$/, '')}/health`;
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      return response.ok;
    } catch {
      return false;
    }
  }
}
