import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
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
    const status = Object.values(checks).every((value) => value === 'ok') ? 'ok' : 'failed';
    const body = { status, checks };
    if (status !== 'ok') throw new ServiceUnavailableException(body);
    return body;
  }
}
