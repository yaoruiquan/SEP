import { CanActivate, ExecutionContext, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import { GatewayRateLimitService } from './gateway-rate-limit.service';

@Injectable()
export class GatewayRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimit: GatewayRateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { clientEmployment?: ClientEmploymentClaims; requestId?: string }>();
    const claims = request.clientEmployment;
    if (!claims) throw new UnauthorizedException('Missing verified employment identity');
    const { allowed, keyHash: _keyHash, ...rateLimit } = await this.rateLimit.consume(claims, request.requestId);
    const response = http.getResponse<Response>();
    response.setHeader('X-RateLimit-Limit', String(rateLimit.limit));
    response.setHeader('X-RateLimit-Remaining', String(Math.max(0, rateLimit.limit - rateLimit.count)));
    response.setHeader('X-RateLimit-Reset', String(Math.ceil(rateLimit.resetAt / 1000)));
    if (!allowed) {
      response.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
      throw new HttpException({
        error: {
          message: '模型请求过于频繁，请在限流窗口恢复后重试', type: 'rate_limit_error',
          code: 'PLATFORM_RATE_LIMIT_EXCEEDED', source: 'platform', param: null, rateLimit,
        },
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      }, 429);
    }
    return true;
  }
}
