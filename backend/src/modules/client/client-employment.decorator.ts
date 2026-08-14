import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { ClientEmploymentClaims } from './client-employment.guard';

/**
 * 取出 ClientEmploymentGuard 解出的雇佣关系令牌声明。
 *
 * 读 `req.clientEmployment` 而非 `req.user` —— 这类路由不走 JwtAuthGuard，
 * 没有 passport 填充的 `req.user`，取错属性会静默拿到 undefined。
 */
export const ClientEmployment = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ClientEmploymentClaims => {
    const request = ctx.switchToHttp().getRequest();
    return request.clientEmployment;
  },
);
