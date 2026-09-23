import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * 敏感数据过滤器 - 日志脱敏
 *
 * 作用：
 * 1. 拦截所有异常响应
 * 2. 移除敏感字段（密码、token、API key 等）
 * 3. 记录安全审计日志（移除敏感信息后）
 */
@Catch()
export class SensitiveDataFilter implements ExceptionFilter {
  private readonly logger = new Logger(SensitiveDataFilter.name);

  // 敏感字段列表（不区分大小写）
  private readonly sensitiveFields = new Set([
    'password',
    'token',
    'accesstoken',
    'refreshtoken',
    'apikey',
    'secret',
    'authorization',
    'cookie',
    'session',
  ]);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = 500;
    let message = 'Internal server error';
    let errorResponse: any = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        errorResponse = exceptionResponse;
        message = (errorResponse as any).message || message;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // 脱敏响应体
    const sanitizedResponse = this.sanitize(errorResponse);

    // 脱敏日志（移除请求中的敏感信息）
    const sanitizedBody = this.sanitize(request.body);
    const sanitizedHeaders = this.sanitize(request.headers);

    // 记录错误日志（已脱敏）
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} - ${status}`,
        JSON.stringify({
          message,
          body: sanitizedBody,
          headers: sanitizedHeaders,
          stack: exception instanceof Error ? exception.stack : undefined,
        })
      );
    } else if (status >= 400) {
      this.logger.warn(
        `${request.method} ${request.url} - ${status}`,
        JSON.stringify({
          message,
          body: sanitizedBody,
        })
      );
    }

    // 返回脱敏后的响应
    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...sanitizedResponse,
    });
  }

  /**
   * 递归脱敏对象中的敏感字段
   */
  private sanitize(obj: any): any {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitize(item));
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();

      // 敏感字段替换为 [REDACTED]
      if (this.sensitiveFields.has(lowerKey)) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}
