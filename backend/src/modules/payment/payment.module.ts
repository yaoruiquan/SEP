import { Module, forwardRef } from "@nestjs/common";
import { OrderController } from "./order.controller";
import { PaymentController } from "./payment.controller";
import { OrderService } from "./order.service";
import { PaymentService } from "./payment.service";
import { AlipayProvider } from "./alipay.provider";
import { PrismaModule } from "../../prisma/prisma.module";
import { EnterpriseModule } from "../enterprise/enterprise.module";
import { ComputeModule } from "../compute/compute.module";
import { WalletModule } from "../wallet/wallet.module";
import { SubscriptionFulfillmentModule } from "../subscription-fulfillment/subscription-fulfillment.module";

@Module({
  imports: [
    PrismaModule,
    EnterpriseModule,
    SubscriptionFulfillmentModule,
    forwardRef(() => ComputeModule),
    forwardRef(() => WalletModule),
  ],
  controllers: [OrderController, PaymentController],
  providers: [OrderService, PaymentService, AlipayProvider],
  exports: [OrderService, PaymentService],
})
export class PaymentModule {}
