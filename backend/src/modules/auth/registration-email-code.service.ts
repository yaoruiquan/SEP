import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomInt } from 'node:crypto';
import { RedisService } from '../../redis/redis.service';
import { MailService } from '../mail/mail.service';

const CODE_TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;

const CONSUME_CODE_SCRIPT = `
local codeHash = redis.call('HGET', KEYS[1], 'codeHash')
if not codeHash then return 0 end

local attempts = tonumber(redis.call('HGET', KEYS[1], 'attempts') or '0')
if attempts >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return -1
end

if codeHash == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end

attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if attempts >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return -1
end
return 0
`;

@Injectable()
export class RegistrationEmailCodeService {
  private readonly logger = new Logger(RegistrationEmailCodeService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private key(email: string): string {
    const digest = createHash('sha256').update(this.normalizeEmail(email)).digest('hex');
    return `sep:auth:registration-code:${digest}`;
  }

  private hashCode(email: string, code: string): string {
    const secret = this.config.get<string>('ACCESS_JWT_SECRET') ?? this.config.getOrThrow<string>('JWT_SECRET');
    return createHmac('sha256', secret)
      .update(`${this.normalizeEmail(email)}:${code}`)
      .digest('hex');
  }

  async issue(email: string): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const key = this.key(normalizedEmail);

    try {
      const result = await this.redisService.redis
        .multi()
        .hset(key, 'codeHash', this.hashCode(normalizedEmail, code), 'attempts', '0')
        .expire(key, CODE_TTL_SECONDS)
        .exec();
      if (!result || result.some(([error]) => error)) {
        throw new Error('Redis transaction failed');
      }
    } catch (error) {
      this.logger.error('注册验证码存储失败', error instanceof Error ? error.stack : String(error));
      throw new ServiceUnavailableException('验证码服务暂不可用，请稍后重试');
    }

    try {
      await this.mail.sendRegistrationEmailCode({ to: normalizedEmail, code });
    } catch (error) {
      try {
        await this.redisService.redis.del(key);
      } catch (cleanupError) {
        this.logger.warn('注册验证码清理失败', cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
      }
      this.logger.error('注册验证码邮件发送失败', error instanceof Error ? error.stack : String(error));
      throw new InternalServerErrorException('验证码邮件发送失败，请稍后重试');
    }
  }

  async consume(email: string, code: string): Promise<void> {
    if (!/^\d{6}$/.test(code)) {
      throw new BadRequestException('验证码错误或已过期');
    }

    let result: number;
    try {
      result = Number(await this.redisService.redis.eval(
        CONSUME_CODE_SCRIPT,
        1,
        this.key(email),
        this.hashCode(email, code),
        MAX_ATTEMPTS,
      ));
    } catch (error) {
      this.logger.error('注册验证码校验失败', error instanceof Error ? error.stack : String(error));
      throw new ServiceUnavailableException('验证码服务暂不可用，请稍后重试');
    }

    if (result !== 1) {
      throw new BadRequestException('验证码错误或已过期');
    }
  }
}
