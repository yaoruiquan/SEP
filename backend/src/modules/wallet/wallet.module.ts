import { Module } from "@nestjs/common";
import { WalletService } from "./wallet.service";
import { WalletController } from "./wallet.controller";
import { PrismaModule } from "../../prisma/prisma.module";
import { PaymentModule } from "../payment/payment.module";
import { forwardRef } from "@nestjs/common";

@Module({
  imports: [PrismaModule, forwardRef(() => PaymentModule)],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService], // 导出供其他模块使用
})
export class WalletModule {}
