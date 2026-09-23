import { Module } from '@nestjs/common';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { SensitiveDataFilter } from './filters/sensitive-data.filter';
import { CsrfGuard } from './guards/csrf.guard';

// E2E 测试环境下放宽限流（通过 E2E_TEST=1 环境变量识别）
const isE2ETesting = process.env.E2E_TEST === '1';
const authLimit = isE2ETesting ? 1000 : 10;
const defaultLimit = isE2ETesting ? 10000 : 100;

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 60 秒
        limit: defaultLimit,
      },
      {
        name: 'auth',
        ttl: 60000, // 60 秒
        limit: authLimit,
      },
      {
        name: 'chat',
        ttl: 60000, // 60 秒
        limit: 60,
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
