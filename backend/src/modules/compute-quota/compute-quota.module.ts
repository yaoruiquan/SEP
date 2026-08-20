import { Module } from '@nestjs/common';
import { ComputeQuotaService } from './compute-quota.service';
import { ComputeQuotaController } from './compute-quota.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [PrismaModule, WalletModule],
  controllers: [ComputeQuotaController],
  providers: [ComputeQuotaService],
  exports: [ComputeQuotaService],
})
export class ComputeQuotaModule {}
