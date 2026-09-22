import { Module } from "@nestjs/common";
import { WalletService } from "./wallet.service";
import { PrismaModule } from "../../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  providers: [WalletService],
  exports: [WalletService], // 导出供其他模块使用
})
export class WalletModule {}
