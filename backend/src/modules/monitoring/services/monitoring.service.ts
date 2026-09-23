import { Injectable, Logger } from '@nestjs/common';

interface RequestMetrics {
  total: number;
  success: number;
  error: number;
  clientError: number; // 4xx
  serverError: number; // 5xx
}

interface ResponseTimeMetrics {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  max: number;
}

interface ErrorRecord {
  timestamp: Date;
  path: string;
  method: string;
  statusCode: number;
  message: string;
  userAgent?: string;
}

interface RequestRecord {
  timestamp: Date;
  duration: number;
  statusCode: number;
}

/**
 * 监控服务 - 收集和聚合应用指标
 * 
 * 功能:
 * 1. 请求计数（总数、成功、失败）
 * 2. 响应时间统计（p50, p95, p99）
 * 3. 错误记录（最近 100 条）
 * 4. 滑动窗口计算（最近 1 分钟）
 */
@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  // 最近 1000 个请求记录（滑动窗口）
  private requestRecords: RequestRecord[] = [];
  
  // 最近 100 个错误记录
  private errorRecords: ErrorRecord[] = [];
  
  // 请求计数器
  private requestMetrics: RequestMetrics = {
    total: 0,
    success: 0,
    error: 0,
    clientError: 0,
    serverError: 0,
  };

  // 窗口大小限制
  private readonly MAX_REQUEST_RECORDS = 1000;
  private readonly MAX_ERROR_RECORDS = 100;
  private readonly WINDOW_SIZE_MS = 60000; // 1 分钟

  /**
   * 记录请求指标
   */
  recordRequest(statusCode: number, duration: number, path: string, method: string, error?: string, userAgent?: string) {
    const now = new Date();

    // 更新计数器
    this.requestMetrics.total++;
    
    if (statusCode >= 200 && statusCode < 400) {
      this.requestMetrics.success++;
    } else {
      this.requestMetrics.error++;
      
      if (statusCode >= 400 && statusCode < 500) {
        this.requestMetrics.clientError++;
      } else if (statusCode >= 500) {
        this.requestMetrics.serverError++;
      }
    }

    // 记录请求详情
    this.requestRecords.push({
      timestamp: now,
      duration,
      statusCode,
    });

    // 限制记录数量（FIFO）
    if (this.requestRecords.length > this.MAX_REQUEST_RECORDS) {
      this.requestRecords.shift();
    }

    // 记录错误
    if (statusCode >= 400 && error) {
      this.errorRecords.push({
        timestamp: now,
        path,
        method,
        statusCode,
        message: error,
        userAgent,
      });

      // 限制错误记录数量
      if (this.errorRecords.length > this.MAX_ERROR_RECORDS) {
        this.errorRecords.shift();
      }
    }

    // 慢请求日志（> 5 秒）
    if (duration > 5000) {
      this.logger.warn(`Slow request detected: ${method} ${path} - ${duration}ms`);
    }
  }

  /**
   * 获取请求指标（1 分钟窗口）
   */
  getRequestMetrics(): RequestMetrics & { errorRate: number } {
    const recentRecords = this.getRecentRecords();
    
    const total = recentRecords.length;
    const serverError = recentRecords.filter(r => r.statusCode >= 500).length;
    const clientError = recentRecords.filter(r => r.statusCode >= 400 && r.statusCode < 500).length;
    const success = recentRecords.filter(r => r.statusCode >= 200 && r.statusCode < 400).length;
    const error = serverError + clientError;

    return {
      total,
      success,
      error,
      clientError,
      serverError,
      errorRate: total > 0 ? error / total : 0,
    };
  }

  /**
   * 获取响应时间指标（1 分钟窗口）
   */
  getResponseTimeMetrics(): ResponseTimeMetrics {
    const recentRecords = this.getRecentRecords();
    
    if (recentRecords.length === 0) {
      return { p50: 0, p95: 0, p99: 0, avg: 0, max: 0 };
    }

    const durations = recentRecords.map(r => r.duration).sort((a, b) => a - b);
    const sum = durations.reduce((acc, d) => acc + d, 0);

    return {
      p50: this.percentile(durations, 0.5),
      p95: this.percentile(durations, 0.95),
      p99: this.percentile(durations, 0.99),
      avg: sum / durations.length,
      max: durations[durations.length - 1],
    };
  }

  /**
   * 获取最近的错误记录
   */
  getRecentErrors(limit: number = 100): ErrorRecord[] {
    return this.errorRecords.slice(-limit);
  }

  /**
   * 获取累计指标（自启动以来）
   */
  getCumulativeMetrics(): RequestMetrics {
    return { ...this.requestMetrics };
  }

  /**
   * 计算错误率（1 分钟窗口）
   */
  getErrorRate(): number {
    const metrics = this.getRequestMetrics();
    return metrics.errorRate;
  }

  /**
   * 计算平均响应时间（1 分钟窗口）
   */
  getAverageResponseTime(): number {
    const metrics = this.getResponseTimeMetrics();
    return metrics.avg;
  }

  /**
   * 重置所有指标（仅用于测试）
   */
  reset() {
    this.requestRecords = [];
    this.errorRecords = [];
    this.requestMetrics = {
      total: 0,
      success: 0,
      error: 0,
      clientError: 0,
      serverError: 0,
    };
  }

  /**
   * 获取最近 1 分钟的记录（滑动窗口）
   */
  private getRecentRecords(): RequestRecord[] {
    const now = Date.now();
    const windowStart = now - this.WINDOW_SIZE_MS;
    
    return this.requestRecords.filter(
      r => r.timestamp.getTime() >= windowStart
    );
  }

  /**
   * 计算百分位数
   */
  private percentile(sortedArray: number[], p: number): number {
    if (sortedArray.length === 0) return 0;
    
    const index = Math.ceil(sortedArray.length * p) - 1;
    return sortedArray[Math.max(0, index)];
  }
}
