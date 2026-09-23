import { Module } from '@nestjs/common';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { SensitiveDataFilter } from './filters/sensitive-data.filter';
import { CsrfGuard } from './guards/csrf.guard';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 60 秒
        limit: 100, // 默认限流：每分钟 100 次请求
      },
      {
        name: 'auth',
        ttl: 60000, // 60 秒
        limit: 10, // 认证端点：每分钟 10 次（由 @Throttle 装饰器覆盖）
      },
      {
        name: 'chat',
        ttl: 60000, // 60 秒
        limit: 60, // 对话端点：每分钟 60 次
      },
    ]),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
    {
      provide: APP_FILTER,
      useClass: SensitiveDataFilter,
    },
  ],
})
export class SecurityModule {}
