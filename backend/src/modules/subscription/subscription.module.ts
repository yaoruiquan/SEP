import { Module } from '@nestjs/common';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { WalletModule } from '../wallet/wallet.module';
import { ComputeQuotaModule } from '../compute-quota/compute-quota.module';

@Module({
  imports: [WalletModule, ComputeQuotaModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
