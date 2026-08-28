import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ComputeCreditModule } from '../compute-credit/compute-credit.module';
import { SubscriptionFulfillmentService } from './subscription-fulfillment.service';

/**
 * 独立成模块（而不是并入 SubscriptionModule）是为了避开依赖环：
 * PaymentModule 需要履约逻辑，而 SubscriptionModule → WalletModule → PaymentModule
 * 已经存在一条 forwardRef 边。本模块只依赖 Prisma 与算力账本，两边都能安全 import。
 */
@Module({
  imports: [PrismaModule, ComputeCreditModule],
  providers: [SubscriptionFulfillmentService],
  exports: [SubscriptionFulfillmentService],
})
export class SubscriptionFulfillmentModule {}
