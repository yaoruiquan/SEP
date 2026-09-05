import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { subDays, startOfDay } from 'date-fns';
import { CostAnalyticsService } from './cost-analytics.service';

@Injectable()
export class CostAnalyticsCronService {
  private readonly logger = new Logger(CostAnalyticsCronService.name);

  constructor(private readonly costService: CostAnalyticsService) {}

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
}
