import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { LogSanitizerService } from './log-sanitizer.service';

/**
 * 日志拦截器
 *
 * 功能：
 * - 记录所有 HTTP 请求和响应
 * - 自动脱敏敏感信息
 * - 记录响应时间
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);
  private readonly sanitizer = new LogSanitizerService();

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, ip, body, query, headers } = request;
    const userAgent = headers['user-agent'] || '';
    const startTime = Date.now();

    // 跳过健康检查和静态资源的日志
    if (url.includes('/health') || url.includes('/favicon.ico')) {
      return next.handle();
    }

    // 请求日志
    const requestLog = {
      method,
      url,
      ip,
      userAgent,
      body: this.sanitizer.sanitize(body),
      query: this.sanitizer.sanitize(query),
    };

    this.logger.log(
      this.sanitizer.formatLog('Incoming Request', 'HTTP', requestLog)
    );

    return next.handle().pipe(
      tap({
        next: (data) => {
          const responseTime = Date.now() - startTime;
          const response = context.switchToHttp().getResponse();
          const statusCode = response.statusCode;

          // 响应日志
          const responseLog = {
            method,
            url,
            statusCode,
            responseTime: `${responseTime}ms`,
            dataPreview: this.getDataPreview(data),
          };

          if (statusCode >= 500) {
            this.logger.error(
              this.sanitizer.formatLog('Response Error', 'HTTP', responseLog)
            );
          } else if (statusCode >= 400) {
            this.logger.warn(
              this.sanitizer.formatLog('Response Warning', 'HTTP', responseLog)
            );
          } else {
            this.logger.log(
              this.sanitizer.formatLog('Response Success', 'HTTP', responseLog)
            );
          }
        },
        error: (error) => {
          const responseTime = Date.now() - startTime;

          const errorLog = {
            method,
            url,
            responseTime: `${responseTime}ms`,
            error: error.message,
          };

          this.logger.error(
            this.sanitizer.formatLog('Response Error', 'HTTP', errorLog)
          );
        },
      })
    );
  }

  /**
   * 获取响应数据预览（避免日志过大）
   */
  private getDataPreview(data: any): string {
    if (!data) {
      return 'null';
    }

    const sanitized = this.sanitizer.sanitize(data);
    const preview = JSON.stringify(sanitized);

    // 限制日志长度
    if (preview.length > 500) {
      return preview.substring(0, 500) + '... [truncated]';
    }

    return preview;
  }
}
