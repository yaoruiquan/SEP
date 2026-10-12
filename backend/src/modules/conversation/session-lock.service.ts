import { Injectable, Logger, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RedisService } from '../../redis/redis.service';

const LOCK_TTL_SECONDS = 60; // 60s TTL 防死锁（长对话可能超 30s）
const LOCK_RETRY_INTERVAL_MS = 200;
const LOCK_MAX_WAIT_MS = 30_000; // 最多等 30s
export const SESSION_LOCK_RENEW_INTERVAL_MS = 20_000;

@Injectable()
export class SessionLockService {
  private readonly logger = new Logger(SessionLockService.name);

  constructor(private readonly redisService: RedisService) {}

  /**
   * 获取会话分布式锁，返回 lockValue 用于释放
   * 如果超时则抛出 ConflictException
   */
  async acquireLock(sessionId: string, signal?: AbortSignal): Promise<string> {
    const lockKey = `lock:session:${sessionId}`;
    const lockValue = randomUUID();
    const deadline = Date.now() + LOCK_MAX_WAIT_MS;

    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      let result: string | null;
      try {
        result = await this.redisService.redis.set(
        lockKey,
        lockValue,
        'EX',
        LOCK_TTL_SECONDS,
        'NX',
        );
      } catch {
        throw new ServiceUnavailableException({ code: 'SESSION_LOCK_UNAVAILABLE', message: '会话锁服务暂时不可用' });
      }

      if (result === 'OK') {
        this.logger.debug(`Lock acquired: ${sessionId}`);
        return lockValue;
      }

      await new Promise((r) => setTimeout(r, LOCK_RETRY_INTERVAL_MS));
    }

    throw new ConflictException(
      `Session ${sessionId} is busy. Please wait for the current message to complete.`,
    );
  }

  async renewLock(sessionId: string, lockValue: string): Promise<void> {
    try {
      const renewed = await this.redisService.redis.eval(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], ARGV[2]) else return 0 end',
        1, `lock:session:${sessionId}`, lockValue, LOCK_TTL_SECONDS,
      );
      if (Number(renewed) === 1) return;
    } catch {
      throw new ServiceUnavailableException({ code: 'SESSION_LOCK_LOST', message: '会话锁续租失败，本次处理已停止' });
    }
    throw new ServiceUnavailableException({ code: 'SESSION_LOCK_LOST', message: '会话锁已失效，本次处理已停止' });
  }

  startRenewal(sessionId: string, lockValue: string, onLost: (error: unknown) => void): () => Promise<void> {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: Promise<void> | undefined;
    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(() => {
        pending = this.renewLock(sessionId, lockValue).then(schedule, (error) => {
          if (!stopped) onLost(error);
        });
      }, SESSION_LOCK_RENEW_INTERVAL_MS);
      timer.unref?.();
    };
    schedule();
    return async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await pending;
    };
  }

  /**
   * 释放会话锁（Lua 脚本保证原子性，只删自己的锁）
   */
  async releaseLock(sessionId: string, lockValue: string): Promise<void> {
    const lockKey = `lock:session:${sessionId}`;

    // 原子 CAS 删除：只有 lockValue 匹配时才删
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    await this.redisService.redis.eval(script, 1, lockKey, lockValue);
    this.logger.debug(`Lock released: ${sessionId}`);
  }
}
