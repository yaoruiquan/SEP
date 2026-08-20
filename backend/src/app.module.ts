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
import { AdminModule } from './modules/admin/admin.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { ComputeModule } from './modules/compute/compute.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { EnterpriseModelConfigModule } from './modules/enterprise-model-config/enterprise-model-config.module';
import { CostAnalyticsModule } from './modules/cost-analytics/cost-analytics.module';
import { EnterpriseSettingsModule } from './modules/enterprise-settings/enterprise-settings.module';
import { CartModule } from './modules/cart/cart.module';
import { PaymentModule } from './modules/payment/payment.module';
import { AnnouncementModule } from './modules/announcement/announcement.module';
import { UploadModule } from './modules/upload/upload.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { SubscriptionRequestModule } from './modules/subscription-request/subscription-request.module';
import { ComputeQuotaModule } from './modules/compute-quota/compute-quota.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SkillVersionModule } from './modules/skill-version/skill-version.module';

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
    AdminModule,
    KnowledgeModule,
    ComputeModule,
    NotificationsModule,
    EnterpriseModelConfigModule,
    CostAnalyticsModule,
    EnterpriseSettingsModule,
    CartModule,
    PaymentModule,
    AnnouncementModule,
    UploadModule,
    WalletModule,
    SubscriptionRequestModule,
    ComputeQuotaModule,
    DashboardModule,
    SkillVersionModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
