import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ClientController } from './client.controller';
import { ClientService } from './client.service';
import { SkillVersionModule } from '../skill-version/skill-version.module';
import { SettingModule } from '../setting/setting.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ComputeCreditModule } from '../compute-credit/compute-credit.module';
import { PersonalWalletModule } from '../personal-wallet/personal-wallet.module';
import { DigitalEmployeeModule } from '../digital-employee/digital-employee.module';
import { SubscriptionRequestModule } from '../subscription-request/subscription-request.module';
import { EnterpriseModelConfigModule } from '../enterprise-model-config/enterprise-model-config.module';
import { GatewayModelPolicyService } from '../gateway/gateway-model-policy.service';
import { MediaConfigModule } from '../media-config/media-config.module';
import { SkillPackageModule } from '../skill-package/skill-package.module';
import { ClientSkillArtifactService } from './client-skill-artifact.service';
import { ClientSkillArtifactController } from './client-skill-artifact.controller';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('ACCESS_JWT_SECRET') ?? config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1h' },
      }),
    }),
    SettingModule,
    SkillVersionModule,
    PrismaModule,
    AuthModule,
    ComputeCreditModule,
    PersonalWalletModule,
    DigitalEmployeeModule,
    SubscriptionRequestModule,
    EnterpriseModelConfigModule,
    MediaConfigModule,
    SkillPackageModule,
  ],
  controllers: [ClientController, ClientSkillArtifactController],
  providers: [ClientService, GatewayModelPolicyService, ClientSkillArtifactService],
})
export class ClientModule {}
