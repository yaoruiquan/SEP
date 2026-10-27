import { Module } from '@nestjs/common';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { SensitiveDataFilter } from './filters/sensitive-data.filter';
import { CsrfGuard } from './guards/csrf.guard';
import { businessTracker, skipUnselectedRule } from './rate-limit-policy';

// E2E 测试环境下放宽限流（通过 E2E_TEST=1 环境变量识别）
const isE2ETesting = process.env.E2E_TEST === '1';
const authLimit = isE2ETesting ? 1000 : 10;
const defaultLimit = isE2ETesting ? 10000 : 100;

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, JwtModule.register({})],
      inject: [ConfigService, JwtService],
      useFactory: (config: ConfigService, jwt: JwtService) => {
        const getTracker = businessTracker(config, jwt);
        return [
          {
            name: 'default',
            ttl: 60000, // 60 秒
            limit: defaultLimit,
            getTracker,
          },
          {
            name: 'auth',
            ttl: 60000, // 60 秒
            limit: authLimit,
            // Keep IP-based abuse protection on explicitly selected auth handlers.
            skipIf: context => skipUnselectedRule('auth', context),
          },
          {
            name: 'chat',
            ttl: 60000, // 60 秒
            limit: 60,
            getTracker,
            skipIf: context => skipUnselectedRule('chat', context),
          },
        ];
      },
    }),
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
