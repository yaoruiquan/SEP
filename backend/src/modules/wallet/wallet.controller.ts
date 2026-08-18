import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { WalletTransactionType } from '@prisma/client';
import { PaymentService } from '../payment/payment.service';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  private readonly logger = new Logger(WalletController.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly enterpriseContext: EnterpriseContextService,
    private readonly paymentService: PaymentService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('balance')
  @ApiOperation({ summary: '获取钱包余额和统计' })
  @ApiResponse({ status: 200, description: '返回钱包余额和统计信息' })
  async getBalance(@Request() req) {
    const ctx = await this.enterpriseContext.resolve(req.user.userId);
    return this.walletService.getBalance(ctx.enterpriseId);
  }

  @Get('transactions')
  @ApiOperation({ summary: '获取交易记录（分页）' })
  @ApiResponse({ status: 200, description: '返回交易记录列表' })
  async getTransactions(
    @Request() req,
    @Query('type') type?: WalletTransactionType,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const ctx = await this.enterpriseContext.resolve(req.user.userId);
    const result = await this.walletService.getTransactions(ctx.enterpriseId, {
      type,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });

    // 前端期望的格式已经和 service 返回的一致
    return result;
  }

  @Post('recharge')
  @ApiOperation({ summary: '创建充值订单（返回支付 URL）' })
  @ApiResponse({ status: 201, description: '返回订单 ID 和支付 URL' })
  async createRechargeOrder(
    @Request() req,
    @Body() dto: { amount: number },
  ) {
    const ctx = await this.enterpriseContext.resolve(req.user.userId);

    // 1. 创建充值订单
    const account = await this.prisma.computeAccount.findUnique({
      where: { enterpriseId: ctx.enterpriseId },
    });

    if (!account) {
      throw new NotFoundException('算力账户不存在');
    }

    // 生成订单号：RCH + yyyyMMddHHmmss + 6位随机数
    const timestamp = new Date().toISOString().replace(/[-T:\.Z]/g, '').slice(0, 14);
    const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    const orderNo = `RCH${timestamp}${random}`;

    const order = await this.prisma.rechargeOrder.create({
      data: {
        orderNo,
        accountId: account.id,
        amount: dto.amount,
        status: 'PENDING',
      },
    });

    // 2. 调用 PaymentService 创建支付
    try {
      const result = await this.paymentService.createRechargeAlipayPayment(
        order.orderNo,
        `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/recharge/result`,
      );

      return {
        orderId: order.id,
        orderNo: order.orderNo,
        payUrl: result.paymentForm,
      };
    } catch (error) {
      // 支付宝未配置时不要伪造一个不存在的支付页（曾经返回 mock-alipay.com，
      // 浏览器直接「无法访问此网站」，看起来像支付挂了，实际是配置缺失）。
      // 明确抛错，让前端提示「请先在系统设置里配置支付宝」。
      this.logger.error(
        `充值订单 ${order.orderNo} 发起支付失败：${error.message}`,
      );
      throw new ServiceUnavailableException(
        '支付渠道未配置或不可用，请联系管理员在系统设置中配置支付宝参数',
      );
    }
  }

  @Post('adjust')
  @ApiOperation({ summary: '管理员手动调整余额（仅平台运营）' })
  @ApiResponse({ status: 201, description: '调整成功' })
  async adjust(
    @Request() req,
    @Body() dto: { enterpriseId: string; amount: number; reason: string },
  ) {
    // TODO: 检查是否为平台管理员（req.user.role === 'ADMIN'）
    return this.walletService.adjust(
      dto.enterpriseId,
      dto.amount,
      dto.reason,
      req.user.userId,
    );
  }
}
