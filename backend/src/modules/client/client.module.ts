import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ClientController } from './client.controller';
import { ClientService } from './client.service';
import { SettingModule } from '../setting/setting.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET') || 'sep-jwt-secret-change-in-production',
        signOptions: { expiresIn: '1h' },
      }),
    }),
    SettingModule,
  ],
  controllers: [ClientController],
  providers: [ClientService],
})
export class ClientModule {}
