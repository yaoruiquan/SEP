import { Module } from '@nestjs/common';
import { ComputeQuotaService } from './compute-quota.service';
import { ComputeQuotaController } from './compute-quota.controller';
import { PrismaModule } from '../../prisma/prisma.module';

/** 旧 Token 配额的只读模块。不再依赖 WalletModule —— 它已无任何写入路径。 */
@Module({
  imports: [PrismaModule],
  controllers: [ComputeQuotaController],
  providers: [ComputeQuotaService],
  exports: [ComputeQuotaService],
})
export class ComputeQuotaModule {}
