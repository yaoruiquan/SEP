import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { TestModule } from './modules/test/test.module';
import { UserModule } from './modules/users/user.module';
import { CapabilityModule } from './modules/capability/capability.module';
import { DigitalEmployeeModule } from './modules/digital-employee/digital-employee.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { ConversationModule } from './modules/conversation/conversation.module';
import { SettingModule } from './modules/setting/setting.module';
import { ModelModule } from './modules/model/model.module';
import { EnterpriseModule } from './modules/enterprise/enterprise.module';

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
    TestModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
