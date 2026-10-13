import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { ClientEmploymentGuard } from '../client/client-employment.guard';
import { GatewayAuthRateLimitService } from '../gateway/gateway-auth-rate-limit.service';
import { MediaGatewayController } from './media-gateway.controller';
import { MediaGatewayMockAdapter } from './media-gateway-mock.adapter';
import { MediaGatewayMockGuard } from './media-gateway-mock.guard';
import { MediaGatewayService } from './media-gateway.service';

@Module({
  imports: [ConfigModule, JwtModule.register({}), PrismaModule, RedisModule, AuthModule],
  controllers: [MediaGatewayController],
  providers: [ClientEmploymentGuard, GatewayAuthRateLimitService, MediaGatewayMockGuard, MediaGatewayMockAdapter, MediaGatewayService],
})
export class MediaGatewayModule {}
