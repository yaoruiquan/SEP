import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  PersonalDepositDtoSchema,
  TransactionQueryDtoSchema,
  type PersonalDepositDto,
  type TransactionQueryDto,
} from 'shared';
import { PersonalWalletService } from './personal-wallet.service';

/**
 * 个人钱包 —— 成员自己的钱，与企业钱包完全隔离。
 *
 * 所有接口都只操作 `req.user.id` 自己的钱包：路径里没有 userId，
 * 也不接受 body 里的 userId。少一个参数就少一条越权路径 ——
 * 「帮别人充值」不是需求，「替别人花钱」更不是。
 */
@ApiTags('personal-wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('personal-wallet')
export class PersonalWalletController {
  constructor(private readonly wallet: PersonalWalletService) {}

  @Get()
  @ApiOperation({ summary: '我的个人钱包余额（元）' })
  @ApiResponse({ status: 200, description: '余额、累计充值、累计消费' })
  async getMine(@Request() req) {
    return this.wallet.getView(req.user.id);
  }

  @Post('deposit')
  @ApiOperation({ summary: '个人充值（演示口径：直接入账，未接支付渠道）' })
  @ApiResponse({ status: 201, description: '返回充值后的余额' })
  async deposit(
    @Request() req,
    @Body(new ZodValidationPipe(PersonalDepositDtoSchema))
    dto: PersonalDepositDto,
  ) {
    return this.wallet.deposit(req.user.id, dto.amountCNY);
  }

  @Get('transactions')
  @ApiOperation({ summary: '我的个人钱包流水' })
  @ApiResponse({ status: 200, description: '分页返回充值与消费记录' })
  async listTransactions(
    @Request() req,
    @Query(new ZodValidationPipe(TransactionQueryDtoSchema))
    query: TransactionQueryDto,
  ) {
    return this.wallet.listTransactions(req.user.id, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }
}
