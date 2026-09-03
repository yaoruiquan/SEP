import { Module } from '@nestjs/common';
import { DigitalEmployeeService } from './digital-employee.service';
import { DigitalEmployeeController } from './digital-employee.controller';
import { MarketController } from './market.controller';
import { PackageController } from './package.controller';
import { PackageService } from './package.service';
import { EmployeeTrackRecordService } from './employee-track-record.service';
import { DigitalEmployeeRunner } from './digital-employee.runner';
import { PrismaModule } from '../../prisma/prisma.module';
import { CapabilityModule } from '../capability/capability.module';

@Module({
  imports: [PrismaModule, CapabilityModule],
  controllers: [DigitalEmployeeController, MarketController, PackageController],
  providers: [
    DigitalEmployeeService,
    DigitalEmployeeRunner,
    PackageService,
    EmployeeTrackRecordService,
  ],
  exports: [DigitalEmployeeService, DigitalEmployeeRunner, PackageService],
})
export class DigitalEmployeeModule {}
