import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LogSanitizerService } from './log-sanitizer.service';

/**
 * 全局异常过滤器
 *
 * 功能：
 * - 统一错误响应格式
 * - 自动记录错误日志（脱敏）
 * - 隐藏生产环境的详细错误信息
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);
  private readonly sanitizer = new LogSanitizerService();

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'InternalServerError';

    // 处理 HTTP 异常
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as any;
        message = responseObj.message || message;
        error = responseObj.error || error;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.name;
    }

    // 构建错误响应
    const errorResponse = {
      success: false,
      statusCode: status,
      error,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // 记录错误日志（脱敏）
    const logData = {
      method: request.method,
      url: request.url,
      ip: request.ip,
      userAgent: request.get('user-agent'),
      body: this.sanitizer.sanitize(request.body),
      query: this.sanitizer.sanitize(request.query),
      error: {
        status,
        message,
        error,
        stack: exception instanceof Error ? exception.stack : undefined,
      },
    };

    if (status >= 500) {
      this.logger.error(
        this.sanitizer.formatLog('Server Error', 'GlobalExceptionFilter', logData)
      );
    } else if (status >= 400) {
      this.logger.warn(
        this.sanitizer.formatLog('Client Error', 'GlobalExceptionFilter', logData)
      );
    }

    // 生产环境隐藏堆栈信息
    if (process.env.NODE_ENV === 'production') {
      // 不返回详细错误信息给客户端
      delete (errorResponse as any).stack;
    } else {
      // 开发环境返回堆栈
      (errorResponse as any).stack = exception instanceof Error ? exception.stack : undefined;
    }

    response.status(status).json(errorResponse);
  }
}
