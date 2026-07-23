import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { TestModule } from './modules/test/test.module';
import { UserModule } from './modules/users/user.module';
import { CapabilityModule } from './modules/capability/capability.module';
import { DigitalEmployeeModule } from './modules/digital-employee/digital-employee.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../.env', '.env'],
    }),
    PrismaModule,
    AuthModule,
    UserModule,
    CapabilityModule,
    DigitalEmployeeModule,
    TestModule,
    // TODO: ConversationModule
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
