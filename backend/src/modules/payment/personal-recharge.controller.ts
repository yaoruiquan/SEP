import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Request,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  PersonalRechargeCreateDtoSchema,
  type PersonalRechargeCreateDto,
} from 'shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PersonalWalletService } from '../personal-wallet/personal-wallet.service';
import { PaymentService } from './payment.service';

/**
 * 个人充值 —— 成员给自己的个人余额充钱，走真实支付渠道。
 *
 * 路径挂在 `personal-wallet/recharge/*`（概念主场），代码却在 PaymentModule 里：
 * 下单要**立刻**拿到支付宝表单，把它放进 PersonalWalletModule 就得让那个模块
 * 依赖 PaymentModule，而 PaymentModule 已经依赖 PersonalWalletModule ——
 * 立刻成环。放在这一侧，依赖始终单向。
 *
 * 三个接口都以 `req.user.id` 为作用域，路径与 body 里都没有 userId：
 * 「帮别人充值」不是需求，「查别人的订单」更不是。
 *
 * ⚠️ 这里**不加余额**。下单只产生一张 PENDING 订单，余额只由支付宝的
 * 异步通知（`POST /payment/alipay/notify`）或对账补偿写入。曾经有个
 * `POST /personal-wallet/deposit` 直接入账，那等于给每个成员发一台印钞机。
 */
@ApiTags('personal-wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('personal-wallet/recharge')
export class PersonalRechargeController {
  private readonly logger = new Logger(PersonalRechargeController.name);

  constructor(
    private readonly wallet: PersonalWalletService,
    private readonly payment: PaymentService,
  ) {}

  @Post()
  @ApiOperation({ summary: '创建个人充值订单并发起支付宝支付' })
  @ApiResponse({ status: 201, description: '返回订单号与支付跳转地址' })
  @ApiResponse({ status: 503, description: '支付宝未配置或不可用' })
  async create(
    @Request() req,
    @Body(new ZodValidationPipe(PersonalRechargeCreateDtoSchema))
    dto: PersonalRechargeCreateDto,
  ) {
    const order = await this.wallet.createRechargeOrder(
      req.user.id,
      dto.amountCNY,
    );

    try {
      const result = await this.payment.createPersonalRechargeAlipayPayment(
        order.orderNo,
        dto.returnUrl,
      );
      return {
        orderId: order.id,
        orderNo: order.orderNo,
        amountCNY: order.amount.toFixed(2),
        payUrl: result.paymentForm,
      };
    } catch (error) {
      /*
        支付宝没配好时不要伪造一个支付地址 —— 浏览器跳过去只会「无法访问此网站」，
        看起来像支付挂了，实际是配置缺失。订单留在 PENDING 不清理：
        它没扣钱，也不会自己变成余额，留着还能对账查证。
      */
      this.logger.error(
        `个人充值订单 ${order.orderNo} 发起支付失败：${error?.message}`,
      );
      throw new ServiceUnavailableException(
        '支付渠道未配置或不可用，请联系管理员在系统设置中配置支付宝参数',
      );
    }
  }

  @Get(':orderNo')
  @ApiOperation({ summary: '查询我的个人充值订单状态' })
  @ApiResponse({ status: 200, description: '订单状态' })
  @ApiResponse({ status: 404, description: '订单不存在或不属于当前用户' })
  async getOne(@Request() req, @Param('orderNo') orderNo: string) {
    const order = await this.wallet.getRechargeOrder(req.user.id, orderNo);
    return {
      orderNo: order.orderNo,
      amountCNY: order.amount.toFixed(2),
      status: order.status,
      payChannel: order.payChannel,
      paidAt: order.paidAt,
      createdAt: order.createdAt,
    };
  }

  @Post(':orderNo/reconcile')
  // 对账不创建任何东西，POST 的默认 201 会和 Swagger 里写的 200 对不上
  @HttpCode(200)
  @ApiOperation({
    summary: '主动对账（结果页轮询用）',
    description:
      '异步通知可能丢失，用户已付款却看不到余额。这里直接问支付宝要真实状态，' +
      '已收款就补履约。对已履约订单幂等。',
  })
  @ApiResponse({ status: 200, description: '返回最新状态与是否触发了补履约' })
  async reconcile(@Request() req, @Param('orderNo') orderNo: string) {
    // 先按 userId 查一次：不校验归属的话，任何人都能拿别人的订单号触发对账，
    // 顺带问出「这个订单号存在」。查不到与不属于我返回同一个 404。
    await this.wallet.getRechargeOrder(req.user.id, orderNo);
    return this.payment.reconcilePersonalRechargeOrder(orderNo);
  }
}
