import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MonitoringService } from './monitoring.service';
import { PrismaService } from '../../../prisma/prisma.service';

interface AlertConfig {
  errorRateThreshold: number;
  responseTimeThreshold: number;
  balanceThreshold: number;
}

/**
 * 告警服务 - 定期检查指标并发送告警
 * 
 * 告警规则:
 * 1. 错误率 > 5%（每分钟检查）
 * 2. 平均响应时间 > 3000ms（每分钟检查）
 * 3. 企业余额 < 100 元（每小时检查）
 */
@Injectable()
export class AlertingService {
  private readonly logger = new Logger(AlertingService.name);
  
  private config: AlertConfig = {
    errorRateThreshold: parseFloat(process.env.ALERT_ERROR_RATE_THRESHOLD || '0.05'),
    responseTimeThreshold: parseFloat(process.env.ALERT_RESPONSE_TIME_THRESHOLD || '3000'),
    balanceThreshold: parseFloat(process.env.ALERT_BALANCE_THRESHOLD || '100'),
  };

  // 告警去重（防止同一告警短时间内重复发送）
  private lastAlertTimes: Map<string, number> = new Map();
  private readonly ALERT_COOLDOWN_MS = 300000; // 5 分钟冷却期

  constructor(
    private readonly monitoringService: MonitoringService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 每分钟检查错误率和响应时间
   */
  @Cron('* * * * *')
  async checkMetrics() {
    try {
      await this.checkErrorRate();
      await this.checkResponseTime();
    } catch (error) {
      this.logger.error('Failed to check metrics', error);
    }
  }

  /**
   * 每小时检查企业余额
   */
  @Cron('0 * * * *')
  async checkBalances() {
    try {
      const lowBalanceEnterprises = await this.findLowBalanceEnterprises();
      
      for (const enterprise of lowBalanceEnterprises) {
        await this.sendAlert(
          'balance',
          `企业余额不足`,
          `企业「${enterprise.name}」余额仅剩 ¥${enterprise.balance.toFixed(2)}，低于阈值 ¥${this.config.balanceThreshold}`,
          'warning',
        );
      }
    } catch (error) {
      this.logger.error('Failed to check balances', error);
    }
  }

  /**
   * 检查错误率
   */
  private async checkErrorRate() {
    const errorRate = this.monitoringService.getErrorRate();
    
    if (errorRate > this.config.errorRateThreshold) {
      const metrics = this.monitoringService.getRequestMetrics();
      
      await this.sendAlert(
        'error_rate',
        `API 错误率过高`,
        `当前错误率: ${(errorRate * 100).toFixed(2)}%\n` +
        `总请求数: ${metrics.total}\n` +
        `失败数: ${metrics.error}（4xx: ${metrics.clientError}, 5xx: ${metrics.serverError}）`,
        'critical',
      );
    }
  }

  /**
   * 检查响应时间
   */
  private async checkResponseTime() {
    const avgResponseTime = this.monitoringService.getAverageResponseTime();
    
    if (avgResponseTime > this.config.responseTimeThreshold) {
      const metrics = this.monitoringService.getResponseTimeMetrics();
      
      await this.sendAlert(
        'response_time',
        `API 响应时间过慢`,
        `平均响应时间: ${avgResponseTime.toFixed(0)}ms\n` +
        `P50: ${metrics.p50.toFixed(0)}ms\n` +
        `P95: ${metrics.p95.toFixed(0)}ms\n` +
        `P99: ${metrics.p99.toFixed(0)}ms\n` +
        `最大: ${metrics.max.toFixed(0)}ms`,
        'warning',
      );
    }
  }

  /**
   * 查找余额不足的企业
   */
  private async findLowBalanceEnterprises() {
    // 注意：根据 deprecated-balance-field-hazard.md，真实余额在 EnterpriseWallet
    const enterprises = await this.prisma.enterprise.findMany({
      where: {
        wallet: {
          balance: {
            lt: this.config.balanceThreshold,
          },
        },
      },
      include: {
        wallet: true,
      },
    });

    return enterprises.map(e => ({
      id: e.id,
      name: e.name,
      balance: e.wallet?.balance || 0,
    }));
  }

  /**
   * 发送告警（带去重）
   */
  private async sendAlert(
    alertKey: string,
    title: string,
    message: string,
    level: 'info' | 'warning' | 'critical',
  ) {
    // 检查冷却期
    const lastAlertTime = this.lastAlertTimes.get(alertKey);
    const now = Date.now();
    
    if (lastAlertTime && now - lastAlertTime < this.ALERT_COOLDOWN_MS) {
      this.logger.debug(`Alert ${alertKey} is in cooldown period, skipping`);
      return;
    }

    // 记录告警时间
    this.lastAlertTimes.set(alertKey, now);

    // 构造告警消息
    const fullMessage = this.formatAlertMessage(title, message, level);

    // 发送到企业微信
    await this.sendWeChatAlert(fullMessage);

    // 记录到日志
    this.logger.warn(`[ALERT] ${title}: ${message}`);
  }

  /**
   * 格式化告警消息
   */
  private formatAlertMessage(title: string, message: string, level: string): string {
    const emoji = {
      info: 'ℹ️',
      warning: '⚠️',
      critical: '🚨',
    }[level] || 'ℹ️';

    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    return `${emoji} 【${level.toUpperCase()}】${title}\n\n${message}\n\n⏰ ${timestamp}`;
  }

  /**
   * 发送企业微信告警
   */
  private async sendWeChatAlert(message: string): Promise<void> {
    const webhookUrl = process.env.WECHAT_WEBHOOK_URL;
    
    if (!webhookUrl) {
      this.logger.warn('WECHAT_WEBHOOK_URL not configured, skipping WeChat alert');
      return;
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'text',
          text: {
            content: message,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`WeChat webhook returned ${response.status}`);
      }

      this.logger.log('Alert sent to WeChat successfully');
    } catch (error) {
      this.logger.error('Failed to send WeChat alert', error);
    }
  }

  /**
   * 手动触发告警（用于测试）
   */
  async sendTestAlert() {
    await this.sendAlert(
      'test',
      '测试告警',
      '这是一条测试告警消息，用于验证告警系统是否正常工作。',
      'info',
    );
  }
}
