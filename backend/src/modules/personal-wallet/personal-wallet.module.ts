import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PersonalWalletService } from './personal-wallet.service';
import { PersonalWalletController } from './personal-wallet.controller';

/**
 * 个人钱包。只依赖 PrismaModule —— 刻意不引入 ComputeCreditModule / WalletModule，
 * 保持依赖单向（ComputeCreditModule → PersonalWalletModule），
 * 不给 wallet/payment/compute 那个模块环再添一条边。
 */
@Module({
  imports: [PrismaModule],
  controllers: [PersonalWalletController],
  providers: [PersonalWalletService],
  exports: [PersonalWalletService],
})
export class PersonalWalletModule {}
