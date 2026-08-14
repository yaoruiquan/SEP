import { Module, forwardRef } from '@nestjs/common';
import { ComputeController } from './compute.controller';
import { ComputeService } from './compute.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { EnterpriseModule } from '../enterprise/enterprise.module';
import { PaymentModule } from '../payment/payment.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [
    PrismaModule,
    EnterpriseModule,
    forwardRef(() => WalletModule),
    forwardRef(() => PaymentModule),
  ],
  controllers: [ComputeController],
  providers: [ComputeService],
  exports: [ComputeService],
})
export class ComputeModule {}
