import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RechargeCreateDtoSchema, type RechargeCreateDto } from 'shared';
import { ComputeService } from './compute.service';
import { CreateRechargeOrderDtoSchema } from './dto/recharge.dto';
import type { CreateRechargeOrderDto } from './dto/recharge.dto';

type AuthedRequest = { user: { id: string } };

@ApiTags('Compute Account')
@Controller('compute')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ComputeController {
  constructor(private readonly compute: ComputeService) {}

  @Get('account')
  @ApiOperation({ summary: '获取企业算力账户信息' })
  @ApiResponse({ status: 200, description: '账户信息' })
  async getAccount(@Request() req: AuthedRequest) {
    return this.compute.getAccount(req.user.id);
  }

  @Get('stats')
  @ApiOperation({ summary: '获取算力消费统计（今日/本月/趋势）' })
  @ApiResponse({ status: 200, description: '统计数据' })
  async getStats(@Request() req: AuthedRequest) {
    return this.compute.getStats(req.user.id);
  }

  @Get('transactions')
  @ApiOperation({ summary: '获取交易记录列表（支持类型/日期过滤 + 分页）' })
  @ApiResponse({ status: 200, description: '交易记录' })
  async listTransactions(
    @Request() req: AuthedRequest,
    @Query('type') type?: 'RECHARGE' | 'CONSUME' | 'REFUND',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.compute.listTransactions(req.user.id, {
      type,
      startDate,
      endDate,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Post('recharge')
  @ApiOperation({ summary: '充值算力（企业管理员）- 已废弃，请使用 POST /compute/recharge/orders' })
  @ApiResponse({ status: 201, description: '充值成功' })
  async recharge(
    @Request() req: AuthedRequest,
    @Body(new ZodValidationPipe(RechargeCreateDtoSchema))
    dto: RechargeCreateDto,
  ) {
    return this.compute.recharge(req.user.id, dto);
  }

  @Post('recharge/orders')
  @ApiOperation({ summary: '创建充值订单（返回订单信息，由前端发起支付）' })
  @ApiResponse({ status: 201, description: '订单创建成功' })
  async createRechargeOrder(
    @Request() req: AuthedRequest,
    @Body(new ZodValidationPipe(CreateRechargeOrderDtoSchema))
    dto: CreateRechargeOrderDto,
  ) {
    const order = await this.compute.createRechargeOrder(req.user.id, dto.amount);
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      amount: order.amount,
      status: order.status,
    };
  }

  @Get('recharge/orders/:orderNo')
  @ApiOperation({ summary: '查询充值订单状态（前端轮询）' })
  @ApiResponse({ status: 200, description: '订单信息' })
  async getRechargeOrder(
    @Request() req: AuthedRequest,
    @Param('orderNo') orderNo: string,
  ) {
    const order = await this.compute.getRechargeOrder(req.user.id, orderNo);
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      amount: order.amount,
      status: order.status,
      paidAt: order.paidAt,
      createdAt: order.createdAt,
    };
  }
}
