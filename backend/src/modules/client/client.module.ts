import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ClientController } from './client.controller';
import { ClientService } from './client.service';
import { SettingModule } from '../setting/setting.module';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1h' },
      }),
    }),
    SettingModule,
    PrismaModule,
  ],
  controllers: [ClientController],
  providers: [ClientService],
})
export class ClientModule {}
