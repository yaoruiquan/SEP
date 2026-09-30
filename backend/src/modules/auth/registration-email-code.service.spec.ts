import { BadRequestException, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { RegistrationEmailCodeService } from './registration-email-code.service';

function make() {
  const transaction = {
    hset: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([[null, 1], [null, 1]]),
  };
  const redis = {
    multi: jest.fn().mockReturnValue(transaction),
    eval: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
  };
  const redisService = { get redis() { return redis; } };
  const config = {
    get: jest.fn((key: string) => key === 'ACCESS_JWT_SECRET' ? 'test-secret' : undefined),
    getOrThrow: jest.fn().mockReturnValue('test-secret'),
  };
  const mail = { sendRegistrationEmailCode: jest.fn().mockResolvedValue(undefined) };
  const service = new RegistrationEmailCodeService(redisService as any, config as any, mail as any);
  (service as any).logger = { error: jest.fn(), warn: jest.fn() };
  return { service, redis, transaction, mail };
}

describe('RegistrationEmailCodeService', () => {
  it('以短期摘要保存验证码并通过邮件发送明文', async () => {
    const { service, redis, transaction, mail } = make();

    await service.issue(' New.User@example.com ');

    const fields = transaction.hset.mock.calls[0].slice(1);
    const code = mail.sendRegistrationEmailCode.mock.calls[0][0].code;
    expect(mail.sendRegistrationEmailCode).toHaveBeenCalledWith({ to: 'new.user@example.com', code });
    expect(code).toMatch(/^\d{6}$/);
    expect(fields).toContain('codeHash');
    expect(fields).not.toContain(code);
    expect(transaction.expire).toHaveBeenCalledWith(expect.any(String), 600);
    expect(redis.multi).toHaveBeenCalledTimes(1);
  });

  it('正确验证码通过后原子消费，错误或已过期验证码拒绝', async () => {
    const { service, redis } = make();
    await expect(service.consume('user@example.com', '123456')).resolves.toBeUndefined();
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, expect.any(String), expect.any(String), 5);

    redis.eval.mockResolvedValueOnce(0);
    await expect(service.consume('user@example.com', '000000')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('把验证码错误次数限制在 5 次', async () => {
    const { service, redis } = make();
    redis.eval.mockResolvedValue(0).mockResolvedValueOnce(-1);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(service.consume('user@example.com', '000000')).rejects.toBeInstanceOf(BadRequestException);
    }

    expect(redis.eval).toHaveBeenCalledTimes(5);
    expect(redis.eval.mock.calls.every((call: unknown[]) => call[4] === 5)).toBe(true);
  });

  it('邮件发送失败时删除待验证挑战并返回可行动错误', async () => {
    const { service, redis, mail } = make();
    mail.sendRegistrationEmailCode.mockRejectedValueOnce(new Error('SMTP unavailable'));

    await expect(service.issue('user@example.com')).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(redis.del).toHaveBeenCalledWith(expect.any(String));
  });

  it('Redis 保存或消费失败时失败关闭', async () => {
    const { service, redis, transaction, mail } = make();
    transaction.exec.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(service.issue('user@example.com')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mail.sendRegistrationEmailCode).not.toHaveBeenCalled();

    redis.eval.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(service.consume('user@example.com', '123456')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
