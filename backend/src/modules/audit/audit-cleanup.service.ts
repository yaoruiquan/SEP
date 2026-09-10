import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

const RETENTION_DAYS = 90;

@Injectable()
export class AuditCleanupService {
  private readonly logger = new Logger(AuditCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('20 3 * * *')
  async purgeExpired() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    try {
      const result = await this.prisma.auditLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (result.count > 0) this.logger.log(`清理 ${result.count} 条过期审计日志`);
      return result.count;
    } catch (error) {
      this.logger.error(`审计日志清理失败: ${(error as Error).message}`);
      return 0;
    }
  }
}
