import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';

@Injectable()
export class KnowledgeNoStoreInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store');
    return next.handle();
  }
}
