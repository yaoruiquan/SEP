import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { MonitoringService } from '../services/monitoring.service';

/**
 * 指标拦截器 - 自动记录所有 HTTP 请求的指标
 * 
 * 记录内容:
 * - 请求路径、方法
 * - 响应状态码
 * - 响应时间
 * - 错误信息（如果有）
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly monitoringService: MonitoringService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, headers } = request;
    const userAgent = headers['user-agent'];
    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        const statusCode = response.statusCode;
        const duration = Date.now() - startTime;

        this.monitoringService.recordRequest(
          statusCode,
          duration,
          url,
          method,
          undefined,
          userAgent,
        );
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        const statusCode = error.status || 500;
        const message = error.message || 'Internal server error';

        this.monitoringService.recordRequest(
          statusCode,
          duration,
          url,
          method,
          message,
          userAgent,
        );

        return throwError(() => error);
      }),
    );
  }
}
