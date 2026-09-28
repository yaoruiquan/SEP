import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { DefaultDepartmentsService } from '../enterprise/default-departments.service';
import { SessionService } from './session.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { OneTimeTokenService } from './one-time-token.service';
import { MailModule } from '../mail/mail.module';
import { OAuthService } from './oauth.service';
import { OAuthStateService } from './oauth-state.service';
import { WechatOAuthProvider } from './providers/wechat.provider';
import { QqOAuthProvider } from './providers/qq.provider';
import { AuthEventService } from './auth-event.service';
import { AuthRiskService } from './auth-risk.service';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { SettingModule } from '../setting/setting.module';

@Module({
  imports: [
    PrismaModule,
    SettingModule,
    MailModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('ACCESS_JWT_SECRET') ?? config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('ACCESS_TOKEN_EXPIRES_IN') ?? '15m' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, DefaultDepartmentsService, SessionService, OneTimeTokenService, AuthEventService, AuthRiskService, AuthRateLimitService, OAuthService, OAuthStateService, WechatOAuthProvider, QqOAuthProvider],
  exports: [AuthService, SessionService, OAuthService, AuthEventService, AuthRiskService, AuthRateLimitService],
})
export class AuthModule {}
