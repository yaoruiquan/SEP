import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { subDays, startOfDay } from 'date-fns';
import { CostAnalyticsService } from './cost-analytics.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CostAnalyticsCronService {
  private readonly logger = new Logger(CostAnalyticsCronService.name);

  constructor(
    private readonly costService: CostAnalyticsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 每小时增量刷新当天数据
   */
  @Cron(CronExpression.EVERY_HOUR)
  async rollupToday(): Promise<void> {
    this.logger.log('开始今日成本 Rollup…');
    try {
      await this.costService.runRollup(new Date());
      this.logger.log('今日成本 Rollup 完成');
    } catch (err) {
      this.logger.error('今日成本 Rollup 失败', err);
    }
  }

  /**
   * 每日 00:30 固化前一天数据
   */
  @Cron('30 0 * * *')
  async rollupYesterday(): Promise<void> {
    const yesterday = subDays(startOfDay(new Date()), 1);
    this.logger.log(`开始固化 ${yesterday.toISOString()} 成本 Rollup…`);
    try {
      await this.costService.runRollup(yesterday);
      this.logger.log('昨日成本 Rollup 完成');
    } catch (err) {
      this.logger.error('昨日成本 Rollup 失败', err);
    }
  }

  /**
   * 每小时检查所有企业的预算告警，超阈值写 Notification
   */
  @Cron(CronExpression.EVERY_HOUR)
  async checkBudgetAlerts(): Promise<void> {
    const configs = await this.prisma.enterpriseModelConfig.findMany({
      where: { monthlyBudgetCNY: { not: null } },
      select: { enterpriseId: true, monthlyBudgetCNY: true, alertThreshold: true },
    });

    for (const cfg of configs) {
      try {
        const alerts = await this.costService.getAlerts(cfg.enterpriseId);
        for (const alert of alerts) {
          // 防重：同类型当日已写则跳过
          const today = startOfDay(new Date());
          const notifType = alert.type === 'BUDGET_EXCEEDED' ? 'ERROR' : 'WARNING';
          const existing = await this.prisma.notification.findFirst({
            where: {
              userId: { in: await this.getAdminUserIds(cfg.enterpriseId) },
              type: notifType,
              createdAt: { gte: today },
              message: { contains: alert.type },
            },
          });
          if (existing) continue;

          const adminIds = await this.getAdminUserIds(cfg.enterpriseId);
          await this.prisma.notification.createMany({
            data: adminIds.map((userId) => ({
              userId,
              type: notifType,
              title:
                alert.type === 'BUDGET_EXCEEDED'
                  ? '⛔ 算力预算已耗尽'
                  : '⚠️ 算力预算告警',
              message: `[${alert.type}] ${alert.message}`,
              isRead: false,
            })),
            skipDuplicates: true,
          });
          this.logger.warn(
            `预算告警已通知企业 ${cfg.enterpriseId}: ${alert.message}`,
          );
        }
      } catch (err) {
        this.logger.error(`企业 ${cfg.enterpriseId} 预算告警检查失败`, err);
      }
    }
  }

  private async getAdminUserIds(enterpriseId: string): Promise<string[]> {
    const members = await this.prisma.enterpriseMember.findMany({
      where: { enterpriseId, role: 'ENTERPRISE_ADMIN' },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }
}
