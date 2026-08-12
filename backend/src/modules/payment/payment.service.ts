import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderService } from './order.service';
import { AlipayProvider } from './alipay.provider';
import { ComputeService } from '../compute/compute.service';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private prisma: PrismaService,
    private orderService: OrderService,
    private alipayProvider: AlipayProvider,
    @Inject(forwardRef(() => ComputeService))
    private computeService: ComputeService,
  ) {}

  /**
   * 初始化支付宝配置（从 SystemSetting 读取）
   */
  async initializeAlipay() {
    const settings = await this.prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            'alipay.appId',
            'alipay.privateKey',
            'alipay.publicKey',
            'alipay.gateway',
          ],
        },
      },
    });

    const config = settings.reduce(
      (acc, item) => {
        if (item.key === 'alipay.appId') acc.appId = item.value;
        if (item.key === 'alipay.privateKey') acc.privateKey = item.value;
        if (item.key === 'alipay.publicKey') acc.alipayPublicKey = item.value;
        if (item.key === 'alipay.gateway') acc.gateway = item.value;
        return acc;
      },
      {} as {
        appId: string;
        privateKey: string;
        alipayPublicKey: string;
        gateway?: string;
      },
    );

    if (!config.appId || !config.privateKey || !config.alipayPublicKey) {
      throw new Error('支付宝配置不完整，请在系统设置中配置支付参数');
    }

    await this.alipayProvider.initialize(config);
  }

  /**
   * 发起支付宝支付（员工订阅订单）
   */
  async createAlipayPayment(orderId: string, returnUrl?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            employee: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    if (order.status !== 'PENDING') {
      throw new BadRequestException(
        `订单状态为 ${order.status}，无法支付`,
      );
    }

    // 确保支付宝 SDK 已初始化
    await this.initializeAlipay();

    // 生成支付表单
    const subject = `硅基员工订阅 - ${order.items.map((i) => i.employeeName).join(', ')}`;
    const body = `订单号: ${order.orderNo}`;

    const paymentForm = await this.alipayProvider.pagePayment({
      outTradeNo: order.orderNo,
      totalAmount: order.totalAmount.toString(),
      subject,
      body,
      returnUrl,
    });

    this.logger.log(`订单 ${order.orderNo} 支付请求已生成`);

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      paymentForm,
    };
  }

  /**
   * 发起支付宝支付（充值订单）
   */
  async createRechargeAlipayPayment(orderNo: string, returnUrl?: string) {
    const order = await this.prisma.rechargeOrder.findUnique({
      where: { orderNo },
    });

    if (!order) {
      throw new NotFoundException('充值订单不存在');
    }

    if (order.status !== 'PENDING') {
      throw new BadRequestException(
        `订单状态为 ${order.status}，无法支付`,
      );
    }

    // 确保支付宝 SDK 已初始化
    await this.initializeAlipay();

    // 生成支付表单
    const subject = '算力充值';
    const body = `充值金额: ¥${order.amount}`;

    const paymentForm = await this.alipayProvider.pagePayment({
      outTradeNo: order.orderNo,
      totalAmount: order.amount.toString(),
      subject,
      body,
      returnUrl,
    });

    this.logger.log(`充值订单 ${order.orderNo} 支付请求已生成`);

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      paymentForm,
    };
  }

  /**
   * 处理支付宝异步通知（幂等）- 支持订单支付和充值支付
   */
  async handleAlipayNotify(postData: Record<string, any>) {
    // 1. 验证签名
    const isValid = this.alipayProvider.verifyNotify(postData);
    if (!isValid) {
      this.logger.warn('支付宝通知签名验证失败', postData);
      return { success: false, message: '签名验证失败' };
    }

    const {
      out_trade_no: outTradeNo,
      trade_no: tradeNo,
      trade_status: tradeStatus,
    } = postData;

    // 2. 幂等检查：插入通知记录（唯一约束防止重复处理）
    try {
      await this.prisma.paymentNotify.create({
        data: {
          channel: 'ALIPAY',
          outTradeNo,
          tradeNo,
          rawBody: JSON.stringify(postData),
          verified: true,
          processed: false,
        },
      });
    } catch (error) {
      // 唯一约束冲突 = 已处理过
      this.logger.warn(
        `支付宝通知 ${tradeNo} 已处理过，跳过`,
      );
      return { success: true, message: '通知已处理' };
    }

    // 3. 仅处理支付成功状态
    if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
      this.logger.log(
        `订单 ${outTradeNo} 状态为 ${tradeStatus}，暂不处理`,
      );
      return { success: true, message: '状态不需要处理' };
    }

    // 4. 根据订单号前缀区分订单类型
    try {
      if (outTradeNo.startsWith('RCH')) {
        // 充值订单
        await this.computeService.fulfillRechargeOrder(outTradeNo, tradeNo, 'ALIPAY');
        this.logger.log(`充值订单 ${outTradeNo} 支付成功，履约完成`);
      } else if (outTradeNo.startsWith('ORD')) {
        // 员工订阅订单
        const order = await this.orderService.findByOrderNo(outTradeNo);
        if (!order) {
          this.logger.error(`订单 ${outTradeNo} 不存在`);
          return { success: false, message: '订单不存在' };
        }
        await this.orderService.fulfill(order.id, tradeNo);
        this.logger.log(`订单 ${outTradeNo} 支付成功，履约完成`);
      } else {
        this.logger.error(`未知订单类型: ${outTradeNo}`);
        return { success: false, message: '未知订单类型' };
      }

      // 标记通知已处理
      await this.prisma.paymentNotify.updateMany({
        where: { channel: 'ALIPAY', tradeNo },
        data: { processed: true },
      });

      return { success: true, message: '处理成功' };
    } catch (error) {
      this.logger.error(`订单 ${outTradeNo} 履约失败`, error);
      return { success: false, message: '履约失败' };
    }
  }

  /**
   * 查询支付状态
   */
  async queryPaymentStatus(orderNo: string) {
    await this.initializeAlipay();

    const result = await this.alipayProvider.queryTrade({ outTradeNo: orderNo });

    return result;
  }
}
