import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

type MailMessage = { to: string; subject: string; text: string; html?: string };

export interface MailDeliveryProvider {
  send(message: MailMessage): Promise<void>;
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of ['token', 'code']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, '***');
    }
    return url.toString();
  } catch {
    return '[redacted-link]';
  }
}

@Injectable()
export class ConsoleMailProvider implements MailDeliveryProvider {
  private readonly logger = new Logger(ConsoleMailProvider.name);
  async send(message: MailMessage): Promise<void> {
    this.logger.log(`邮件已准备（开发模式）：to=${message.to}, subject=${message.subject}`);
    if (message.text) this.logger.debug(message.text.replace(/https?:\/\/\S+/g, redactUrl));
  }
}

@Injectable()
export class SmtpMailProvider implements MailDeliveryProvider {
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;
  constructor(config: ConfigService) {
    const port = Number(config.get<string>('MAIL_PORT') ?? 587);
    const address = config.get<string>('MAIL_FROM') ?? 'no-reply@example.com';
    const fromName = config.get<string>('MAIL_FROM_NAME') ?? '硅基人才平台';
    this.from = `${fromName} <${address}>`;
    this.transporter = nodemailer.createTransport({
      host: config.getOrThrow<string>('MAIL_HOST'),
      port,
      secure: config.get<string>('MAIL_SECURE') === 'true' || port === 465,
      auth: {
        user: config.getOrThrow<string>('MAIL_USER'),
        pass: config.getOrThrow<string>('MAIL_PASSWORD'),
      },
    });
  }
  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly provider: MailDeliveryProvider;
  private readonly enabled: boolean;
  private readonly from: string;
  private readonly fromName: string;

  constructor(private readonly config: ConfigService) {
    this.enabled = config.get<string>('MAIL_ENABLED') === 'true';
    this.from = config.get<string>('MAIL_FROM') ?? 'no-reply@example.com';
    this.fromName = config.get<string>('MAIL_FROM_NAME') ?? '硅基人才平台';
    if (this.enabled) {
      this.provider = new SmtpMailProvider(config);
    } else {
      this.provider = new ConsoleMailProvider();
    }
  }

  async send(input: { to: string; subject: string; text: string; html?: string }): Promise<void> {
    if (!this.enabled && this.config.get<string>('NODE_ENV') === 'test') return;
    await this.provider.send({ ...input, subject: `[${this.fromName}] ${input.subject}` });
  }

  async sendPasswordReset(input: { to: string; resetUrl: string }): Promise<void> {
    return this.send({
      to: input.to,
      subject: '重置密码',
      text: `请在 20 分钟内打开以下链接重置密码：${input.resetUrl}\n如果不是你本人操作，请忽略本邮件。`,
    });
  }

  async sendEmailVerification(input: { to: string; verificationUrl: string }): Promise<void> {
    return this.send({
      to: input.to,
      subject: '验证邮箱地址',
      text: `请打开以下链接完成邮箱验证：${input.verificationUrl}`,
    });
  }

  async sendPasswordChanged(input: { to: string }): Promise<void> {
    return this.send({
      to: input.to,
      subject: '密码已修改',
      text: '你的账号密码已修改。如果不是你本人操作，请立即联系平台管理员。',
    });
  }

  async sendEnterpriseInvitation(input: { to: string; invitationUrl: string; enterpriseName: string }): Promise<void> {
    return this.send({
      to: input.to,
      subject: `加入${input.enterpriseName}`,
      text: `你收到加入「${input.enterpriseName}」的邀请，请打开以下链接：${input.invitationUrl}`,
    });
  }

  async sendNewDeviceLogin(input: { to: string; ipAddress?: string; userAgent?: string; clientType: string }): Promise<void> {
    const location = input.ipAddress ? `IP：${input.ipAddress}` : 'IP：未知';
    const client = input.clientType === 'DESKTOP' ? '桌面客户端' : '浏览器';
    return this.send({
      to: input.to,
      subject: '新设备登录提醒',
      text: `你的账号刚刚通过${client}登录。\n${location}\n设备信息：${input.userAgent ?? '未知'}\n如果不是你本人操作，请立即修改密码并退出全部设备。`,
    });
  }
}
