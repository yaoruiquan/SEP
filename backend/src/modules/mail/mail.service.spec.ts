import * as nodemailer from 'nodemailer';
import { ConsoleMailProvider, MailService, SmtpMailProvider } from './mail.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

const createTransport = nodemailer.createTransport as jest.Mock;

describe('MailService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createTransport.mockReturnValue({ sendMail: jest.fn().mockResolvedValue(undefined) });
  });

  it('开发模式使用 Console provider，日志脱敏 token/code', async () => {
    const logger = { log: jest.fn(), debug: jest.fn() };
    const provider = new ConsoleMailProvider();
    (provider as any).logger = logger;

    await provider.send({
      to: 'user@example.com',
      subject: '验证',
      text: '请打开 https://example.com/verify?token=secret-token&code=secret-code',
    });

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('user@example.com'));
    expect(logger.debug).toHaveBeenCalledWith(
      expect.not.stringContaining('secret-token'),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.not.stringContaining('secret-code'),
    );
  });

  it('MAIL_ENABLED=false 不创建 SMTP transporter', async () => {
    const config = {
      get: jest.fn((key: string) => ({
        MAIL_ENABLED: 'false',
        NODE_ENV: 'test',
        MAIL_FROM: 'noreply@example.com',
        MAIL_FROM_NAME: '硅基人才平台',
      } as Record<string, string>)[key]),
      getOrThrow: jest.fn(),
    };
    const service = new MailService(config as any);

    await service.sendPasswordChanged({ to: 'user@example.com' });

    expect(createTransport).not.toHaveBeenCalled();
  });

  it('SMTP provider 使用配置的显示名称和发件地址', async () => {
    const transport = { sendMail: jest.fn().mockResolvedValue(undefined) };
    createTransport.mockReturnValue(transport);
    const config = {
      get: jest.fn((key: string) => ({
        MAIL_PORT: '587',
        MAIL_FROM: 'noreply@example.com',
        MAIL_FROM_NAME: '硅基人才平台',
        MAIL_SECURE: 'false',
        MAIL_HOST: 'smtp.example.com',
        MAIL_USER: 'mailer',
        MAIL_PASSWORD: 'password',
      } as Record<string, string>)[key]),
      getOrThrow: jest.fn((key: string) => ({
        MAIL_HOST: 'smtp.example.com',
        MAIL_USER: 'mailer',
        MAIL_PASSWORD: 'password',
      } as Record<string, string>)[key]),
    };

    const provider = new SmtpMailProvider(config as any);
    await provider.send({
      to: 'user@example.com',
      subject: '主题',
      text: '正文',
    });

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'mailer', pass: 'password' },
    });
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: '硅基人才平台 <noreply@example.com>',
      to: 'user@example.com',
      subject: '主题',
      text: '正文',
      html: undefined,
    });
  });

  it('密码修改通知不包含密码或 token', async () => {
    const provider = { send: jest.fn().mockResolvedValue(undefined) };
    const config = {
      get: jest.fn((key: string) => ({
        MAIL_ENABLED: 'true',
        MAIL_FROM: 'noreply@example.com',
        MAIL_FROM_NAME: '硅基人才平台',
      } as Record<string, string>)[key]),
      getOrThrow: jest.fn((key: string) => {
        if (key === 'MAIL_HOST') return 'smtp.example.com';
        if (key === 'MAIL_USER') return 'mailer';
        return 'password';
      }),
    };
    const service = new MailService(config as any);
    (service as any).provider = provider;

    await service.sendPasswordChanged({ to: 'user@example.com' });

    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.not.stringMatching(/password|token/i),
    }));
  });
});
