import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/users/user.module';
import { CapabilityModule } from './modules/capability/capability.module';
import { DigitalEmployeeModule } from './modules/digital-employee/digital-employee.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { ConversationModule } from './modules/conversation/conversation.module';
import { SettingModule } from './modules/setting/setting.module';
import { ModelModule } from './modules/model/model.module';
import { EnterpriseModule } from './modules/enterprise/enterprise.module';
import { ClientModule } from './modules/client/client.module';
import { GatewayModule } from './modules/gateway/gateway.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../.env', '.env'],
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    UserModule,
    CapabilityModule,
    DigitalEmployeeModule,
    SubscriptionModule,
    ConversationModule,
    SettingModule,
    ModelModule,
    EnterpriseModule,
    ClientModule,
    GatewayModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
