import { Module } from '@nestjs/common';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { WalletModule } from '../wallet/wallet.module';
import { SubscriptionFulfillmentModule } from '../subscription-fulfillment/subscription-fulfillment.module';
import { ComputeCreditModule } from '../compute-credit/compute-credit.module';

@Module({
  imports: [WalletModule, SubscriptionFulfillmentModule, ComputeCreditModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
