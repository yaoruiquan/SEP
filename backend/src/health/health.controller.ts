import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { EmbeddingService } from '../modules/knowledge/embedding.service';
import { TaskQueueService } from '../modules/task-execution/task-queue.service';
import { KnowledgeQueueService } from '../modules/knowledge/knowledge-queue.service';

@Controller('health')
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
  liveness() {
    return { status: 'ok' };
  }

  @Get('ready')
  async readiness() {
    const checks: Record<string, string> = {};
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.postgres = 'ok';
    } catch {
      checks.postgres = 'failed';
    }
    try {
      await this.redis.redis.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'failed';
    }
    checks.taskQueue = this.taskQueue.isReady() ? 'ok' : 'failed';
    checks.knowledgeQueue = this.knowledgeQueue.isReady() ? 'ok' : 'failed';
    if (this.config.get('NODE_ENV') === 'production') {
      checks.sub2api = await this.checkHttp(this.config.get<string>('SUB2API_BASE_URL'), true) ? 'ok' : 'failed';
      checks.embedding = await this.embedding.isAvailable() ? 'ok' : 'failed';
    }
    const status = Object.values(checks).every((value) => value === 'ok') ? 'ok' : 'failed';
    const body = { status, checks };
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
}
