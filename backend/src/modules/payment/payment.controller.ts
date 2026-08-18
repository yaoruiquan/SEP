import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { AlipayPaymentDtoSchema } from './dto/order.dto';
import { z } from 'zod';

// 充值支付请求 DTO
const RechargeAlipayPaymentDtoSchema = z.object({
  orderNo: z.string(),
  returnUrl: z.string().url().optional(),
});

type RechargeAlipayPaymentDto = z.infer<typeof RechargeAlipayPaymentDtoSchema>;

// 主动对账请求 DTO
const ReconcileRechargeDtoSchema = z.object({
  orderNo: z.string(),
});

type ReconcileRechargeDto = z.infer<typeof ReconcileRechargeDtoSchema>;

// 订阅订单对账请求 DTO（结果页用 orderId 定位）
const ReconcileOrderDtoSchema = z.object({
  orderId: z.string(),
});

type ReconcileOrderDto = z.infer<typeof ReconcileOrderDtoSchema>;

@ApiTags('payment')
@Controller('payment')
export class PaymentController {
  constructor(
    private paymentService: PaymentService,
    private enterpriseContext: EnterpriseContextService,
  ) {}

  @Post('alipay/create')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '发起支付宝支付' })
  @ApiResponse({ status: 200, description: '支付表单已生成' })
  @ApiResponse({ status: 404, description: '订单不存在' })
  async createAlipayPayment(
    @Request() req,
    @Body(new ZodValidationPipe(AlipayPaymentDtoSchema)) dto,
  ) {
    const { enterpriseId } = await this.enterpriseContext.resolve(req.user.id);

    // 验证订单归属：findOne 查不到会抛 404，故此调用本身即是鉴权
    await this.paymentService['orderService'].findOne(dto.orderId, enterpriseId);

    return this.paymentService.createAlipayPayment(dto.orderId);
  }

  @Post('alipay/recharge/create')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '发起充值支付宝支付' })
  @ApiResponse({ status: 200, description: '支付表单已生成' })
  @ApiResponse({ status: 404, description: '充值订单不存在' })
  async createRechargeAlipayPayment(
    @Request() req,
    @Body(new ZodValidationPipe(RechargeAlipayPaymentDtoSchema))
    dto: RechargeAlipayPaymentDto,
  ) {
    const { enterpriseId } = await this.enterpriseContext.resolve(req.user.id);

    // 验证订单归属
    const order = await this.paymentService['prisma'].rechargeOrder.findUnique({
      where: { orderNo: dto.orderNo },
      include: { account: true },
    });

    if (!order || order.account.enterpriseId !== enterpriseId) {
      throw new NotFoundException('充值订单不存在');
    }

    return this.paymentService.createRechargeAlipayPayment(
      dto.orderNo,
      dto.returnUrl,
    );
  }

  @Post('alipay/notify')
  @HttpCode(200)
  @ApiOperation({ summary: '支付宝异步通知回调（公开接口）' })
  @ApiResponse({ status: 200, description: 'success' })
  async alipayNotify(@Body() postData: Record<string, any>) {
    const result = await this.paymentService.handleAlipayNotify(postData);

    // 支付宝要求返回固定字符串
    return result.success ? 'success' : 'fail';
  }

  @Post('alipay/recharge/reconcile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '主动向支付宝核对充值订单状态（异步通知丢失时的兜底）',
  })
  @ApiResponse({ status: 200, description: '返回最新订单状态' })
  @ApiResponse({ status: 404, description: '充值订单不存在' })
  async reconcileRecharge(
    @Request() req,
    @Body(new ZodValidationPipe(ReconcileRechargeDtoSchema))
    dto: ReconcileRechargeDto,
  ) {
    const { enterpriseId } = await this.enterpriseContext.resolve(req.user.id);

    // 验证订单归属，防止越权查询他人订单
    const order = await this.paymentService['prisma'].rechargeOrder.findUnique({
      where: { orderNo: dto.orderNo },
      include: { account: true },
    });

    if (!order || order.account.enterpriseId !== enterpriseId) {
      throw new NotFoundException('充值订单不存在');
    }

    return this.paymentService.reconcileRechargeOrder(dto.orderNo);
  }

  @Post('alipay/reconcile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '主动向支付宝核对订阅订单状态（异步通知丢失时的兜底）',
  })
  @ApiResponse({ status: 200, description: '返回最新订单状态' })
  @ApiResponse({ status: 404, description: '订单不存在' })
  async reconcileOrder(
    @Request() req,
    @Body(new ZodValidationPipe(ReconcileOrderDtoSchema))
    dto: ReconcileOrderDto,
  ) {
    const { enterpriseId } = await this.enterpriseContext.resolve(req.user.id);

    // 验证订单归属：findOne 查不到会抛 404，故此调用本身即是鉴权
    const order = await this.paymentService['orderService'].findOne(
      dto.orderId,
      enterpriseId,
    );

    return this.paymentService.reconcileOrder(order.orderNo);
  }
}
