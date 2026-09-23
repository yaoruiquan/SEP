import { Injectable, Logger } from '@nestjs/common';

/**
 * 日志脱敏服务
 *
 * 自动过滤敏感信息：密码、token、手机号、身份证、银行卡
 */
@Injectable()
export class LogSanitizerService {
  private readonly logger = new Logger(LogSanitizerService.name);

  // 敏感字段关键词
  private readonly sensitiveKeys = [
    'password',
    'pwd',
    'token',
    'accessToken',
    'refreshToken',
    'secret',
    'apiKey',
    'authorization',
    'auth',
    'credit_card',
    'creditCard',
    'cvv',
    'ssn',
    'idCard',
  ];

  // 手机号正则
  private readonly phoneRegex = /1[3-9]\d{9}/g;

  // 身份证号正则
  private readonly idCardRegex = /[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g;

  // 银行卡号正则
  private readonly bankCardRegex = /\d{16,19}/g;

  // Email 正则（部分脱敏）
  private readonly emailRegex = /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

  /**
   * 脱敏对象中的敏感信息
   */
  sanitize(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'string') {
      return this.sanitizeString(data);
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitize(item));
    }

    if (typeof data === 'object') {
      return this.sanitizeObject(data);
    }

    return data;
  }

  /**
   * 脱敏字符串
   */
  private sanitizeString(str: string): string {
    let sanitized = str;

    // 脱敏手机号：138****5678
    sanitized = sanitized.replace(this.phoneRegex, (match) => {
      return match.substring(0, 3) + '****' + match.substring(7);
    });

    // 脱敏身份证：110***********1234
    sanitized = sanitized.replace(this.idCardRegex, (match) => {
      return match.substring(0, 3) + '***********' + match.substring(14);
    });

    // 脱敏银行卡：6222 **** **** 1234
    sanitized = sanitized.replace(this.bankCardRegex, (match) => {
      if (match.length >= 16) {
        return match.substring(0, 4) + ' **** **** ' + match.substring(match.length - 4);
      }
      return match;
    });

    // 脱敏邮箱：a***@example.com
    sanitized = sanitized.replace(this.emailRegex, (match, username, domain) => {
      if (username.length <= 2) {
        return username.substring(0, 1) + '***@' + domain;
      }
      return username.substring(0, 1) + '***@' + domain;
    });

    return sanitized;
  }

  /**
   * 脱敏对象
   */
  private sanitizeObject(obj: any): any {
    const sanitized: any = {};

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        // 检查是否是敏感字段
        if (this.isSensitiveKey(key)) {
          sanitized[key] = '***REDACTED***';
        } else {
          sanitized[key] = this.sanitize(obj[key]);
        }
      }
    }

    return sanitized;
  }

  /**
   * 判断是否是敏感字段
   */
  private isSensitiveKey(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return this.sensitiveKeys.some((sensitiveKey) =>
      lowerKey.includes(sensitiveKey.toLowerCase())
    );
  }

  /**
   * 格式化日志（供 Logger 使用）
   */
  formatLog(message: string, context?: string, data?: any): string {
    const sanitizedData = data ? this.sanitize(data) : undefined;

    if (sanitizedData) {
      return `[${context || 'Application'}] ${message} ${JSON.stringify(sanitizedData)}`;
    }

    return `[${context || 'Application'}] ${message}`;
  }
}
