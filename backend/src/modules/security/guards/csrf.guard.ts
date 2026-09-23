import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

/**
 * CSRF Guard - 防止跨站请求伪造攻击
 *
 * 策略：
 * 1. GET/HEAD/OPTIONS 请求：放行（幂等操作）
 * 2. POST/PUT/DELETE/PATCH 请求：验证 Origin/Referer 头
 * 3. 允许的源从环境变量 CORS_ORIGIN 读取
 * 4. 开发环境（localhost）放宽限制
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private allowedOrigins: Set<string>;
  private isProduction: boolean;

  constructor(private reflector: Reflector) {
    this.isProduction = process.env.NODE_ENV === 'production';
    const origins = (process.env.CORS_ORIGIN ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    // 开发环境添加 localhost
    if (!this.isProduction) {
      origins.push('http://localhost:3000', 'http://localhost:4173');
    }

    this.allowedOrigins = new Set(
      origins.map((origin) => new URL(origin).origin)
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();

    // 幂等方法放行
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return true;
    }

    // 健康检查端点放行
    if (request.path === '/health' || request.path === '/api/health') {
      return true;
    }

    // 验证来源
    const origin = request.headers.origin || request.headers.referer;

    if (!origin) {
      // 生产环境严格要求 Origin/Referer
      if (this.isProduction) {
        throw new ForbiddenException('Missing Origin or Referer header');
      }
      return true; // 开发环境放行
    }

    // URL.origin 规范化主机名大小写、默认端口，并去掉 Referer 路径。
    let originHost: string;
    try {
      originHost = new URL(origin).origin;
    } catch {
      throw new ForbiddenException('Invalid Origin or Referer header');
    }

    if (!this.allowedOrigins.has(originHost)) {
      throw new ForbiddenException(
        `Origin ${originHost} not allowed. CSRF protection.`
      );
    }

    return true;
  }
}
