import { Module, forwardRef } from "@nestjs/common";
import { OrderController } from "./order.controller";
import { PaymentController } from "./payment.controller";
import { PersonalRechargeController } from "./personal-recharge.controller";
import { OrderService } from "./order.service";
import { PaymentService } from "./payment.service";
import { AlipayProvider } from "./alipay.provider";
import { PrismaModule } from "../../prisma/prisma.module";
import { EnterpriseModule } from "../enterprise/enterprise.module";
import { ComputeModule } from "../compute/compute.module";
import { WalletModule } from "../wallet/wallet.module";
import { SubscriptionFulfillmentModule } from "../subscription-fulfillment/subscription-fulfillment.module";
import { PersonalWalletModule } from "../personal-wallet/personal-wallet.module";

@Module({
  imports: [
    PrismaModule,
    EnterpriseModule,
    SubscriptionFulfillmentModule,
    forwardRef(() => ComputeModule),
    forwardRef(() => WalletModule),
    // 单向依赖：PersonalWalletModule 只 import PrismaModule，不会回头依赖这里。
    // 不用 forwardRef —— 加了会掩盖将来真的成环。
    PersonalWalletModule,
  ],
  controllers: [OrderController, PaymentController, PersonalRechargeController],
  providers: [OrderService, PaymentService, AlipayProvider],
  exports: [OrderService, PaymentService],
})
export class PaymentModule {}
