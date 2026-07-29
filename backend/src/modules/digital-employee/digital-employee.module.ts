import { Module } from '@nestjs/common';
import { DigitalEmployeeService } from './digital-employee.service';
import { DigitalEmployeeController } from './digital-employee.controller';
import { MarketController } from './market.controller';
import { DigitalEmployeeRunner } from './digital-employee.runner';
import { PrismaModule } from '../../prisma/prisma.module';
import { CapabilityModule } from '../capability/capability.module';

@Module({
  imports: [PrismaModule, CapabilityModule],
  controllers: [DigitalEmployeeController, MarketController],
  providers: [DigitalEmployeeService, DigitalEmployeeRunner],
  exports: [DigitalEmployeeService, DigitalEmployeeRunner],
})
export class DigitalEmployeeModule {}
