import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
const AlipaySdkModule = require('alipay-sdk');
const AlipaySdk = AlipaySdkModule.AlipaySdk || AlipaySdkModule.default || AlipaySdkModule;
const AlipayFormData = AlipaySdkModule.AlipayFormData;

export interface AlipayTradePagePayParams {
  outTradeNo: string;
  totalAmount: string;
  subject: string;
  body?: string;
  returnUrl?: string;
}

export interface AlipayTradeQueryParams {
  outTradeNo?: string;
  tradeNo?: string;
}

@Injectable()
export class AlipayProvider {
  private readonly logger = new Logger(AlipayProvider.name);
  private sdk: any = null;

  constructor(private configService: ConfigService) {}

  /**
   * 初始化支付宝 SDK（从 SystemSetting 读取配置）
   */
  async initialize(config: {
    appId: string;
    privateKey: string;
    alipayPublicKey: string;
    gateway?: string;
  }) {
    this.sdk = new AlipaySdk({
      appId: config.appId,
      privateKey: config.privateKey,
      alipayPublicKey: config.alipayPublicKey,
      gateway: config.gateway || 'https://openapi.alipay.com/gateway.do',
      charset: 'utf-8',
      signType: 'RSA2',
      // 应用私钥为 PKCS#8（Alipay 开放平台标准格式），用 PRIVATE KEY 头包裹；
      // 否则 SDK 默认用 RSA PRIVATE KEY 头，在较严格的 OpenSSL 上会解析失败。
      keyType: 'PKCS8',
    });

    this.logger.log('支付宝 SDK 已初始化');
  }

  /**
   * 电脑网站支付 - 返回支付表单 HTML
   */
  async pagePayment(params: AlipayTradePagePayParams): Promise<string> {
    if (!this.sdk) {
      throw new Error('支付宝 SDK 未初始化，请先配置支付参数');
    }

    const result = await this.sdk.pageExec(
      'alipay.trade.page.pay',
      {
        method: 'GET',
        bizContent: {
          out_trade_no: params.outTradeNo,
          total_amount: params.totalAmount,
          subject: params.subject,
          body: params.body,
          product_code: 'FAST_INSTANT_TRADE_PAY',
        },
        returnUrl: params.returnUrl || this.getReturnUrl(),
        notifyUrl: this.getNotifyUrl(),
      },
    );

    this.logger.log(`支付宝支付请求已生成，订单号 ${params.outTradeNo}`);
    return result as string;
  }

  /**
   * 验证支付宝异步通知签名
   */
  verifyNotify(postData: Record<string, any>): boolean {
    if (!this.sdk) {
      throw new Error('支付宝 SDK 未初始化');
    }

    // 沙箱测试模式：跳过签名验证
    if (process.env.ALIPAY_SANDBOX_MODE === 'true') {
      this.logger.warn('沙箱模式：跳过签名验证');
      return true;
    }

    try {
      return this.sdk.checkNotifySign(postData);
    } catch (error) {
      this.logger.error('签名验证失败', error);
      return false;
    }
  }

  /**
   * 查询订单支付状态
   */
  async queryTrade(params: AlipayTradeQueryParams) {
    if (!this.sdk) {
      throw new Error('支付宝 SDK 未初始化');
    }

    const result = await this.sdk.exec('alipay.trade.query', {
      bizContent: {
        out_trade_no: params.outTradeNo,
        trade_no: params.tradeNo,
      },
    });

    return result;
  }

  /**
   * 获取异步通知回调地址
   */
  private getNotifyUrl(): string {
    const baseUrl = this.configService.get<string>('API_BASE_URL');
    return `${baseUrl}/payment/alipay/notify`;
  }

  /**
   * 获取同步跳转地址
   */
  private getReturnUrl(): string {
    const webUrl = this.configService.get<string>('WEB_BASE_URL');
    // 注意：/payment/result 页面并不存在，实际结果页是 /payment/recharge/result。
    // 调用方（payment.service）应显式传入带 orderNo 的 returnUrl；此处仅作兜底。
    return `${webUrl}/payment/recharge/result`;
  }
}
