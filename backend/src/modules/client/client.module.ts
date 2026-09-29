import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ClientController } from './client.controller';
import { ClientService } from './client.service';
import { SettingModule } from '../setting/setting.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ComputeCreditModule } from '../compute-credit/compute-credit.module';
import { PersonalWalletModule } from '../personal-wallet/personal-wallet.module';
import { DigitalEmployeeModule } from '../digital-employee/digital-employee.module';
import { SubscriptionRequestModule } from '../subscription-request/subscription-request.module';

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
    PrismaModule,
    AuthModule,
    ComputeCreditModule,
    PersonalWalletModule,
    DigitalEmployeeModule,
    SubscriptionRequestModule,
  ],
  controllers: [ClientController],
  providers: [ClientService],
})
export class ClientModule {}
