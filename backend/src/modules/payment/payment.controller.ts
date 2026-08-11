import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
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

    // 验证订单归属
    const order = await this.paymentService['orderService'].findOne(
      dto.orderId,
      enterpriseId,
    );

    return this.paymentService.createAlipayPayment(dto.orderId);
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
}
